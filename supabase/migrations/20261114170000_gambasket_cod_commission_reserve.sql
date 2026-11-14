-- GamBasket prepaid COD commission reserve
-- COD commission is held when the seller accepts the order, captured after OTP + 24h, or released on cancellation.
ALTER TABLE public.seller_wallet_ledger_batches
  DROP CONSTRAINT IF EXISTS seller_wallet_ledger_batches_source_type_check;
ALTER TABLE public.seller_wallet_ledger_batches
  ADD CONSTRAINT seller_wallet_ledger_batches_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'payment','delivery_release','payout_request','payout_success','payout_failure',
    'refund','admin_adjustment','cod_reserve_fund','cod_reserve_deposit',
    'cod_order_reserve','cod_order_release','cod_commission_capture'
  ]::text[]));

ALTER TABLE public.seller_wallet_ledger_entries
  DROP CONSTRAINT IF EXISTS seller_wallet_ledger_entries_account_code_check;
ALTER TABLE public.seller_wallet_ledger_entries
  ADD CONSTRAINT seller_wallet_ledger_entries_account_code_check
  CHECK (account_code = ANY (ARRAY[
    'gateway_clearing','seller_pending','seller_available','seller_payout_in_transit',
    'seller_reserve','seller_cod_commission_reserved','platform_commission','delivery_payable'
  ]::text[]));

ALTER TABLE public.seller_wallet_ledger_entries
  DROP CONSTRAINT IF EXISTS seller_wallet_ledger_entries_check1;
ALTER TABLE public.seller_wallet_ledger_entries
  ADD CONSTRAINT seller_wallet_ledger_entries_check1
  CHECK (
    (account_code = ANY (ARRAY[
      'seller_pending','seller_available','seller_payout_in_transit',
      'seller_reserve','seller_cod_commission_reserved'
    ]::text[]) AND account_owner_id IS NOT NULL)
    OR
    (account_code = ANY (ARRAY[
      'gateway_clearing','platform_commission','delivery_payable'
    ]::text[]) AND account_owner_id IS NULL)
  );

CREATE TABLE IF NOT EXISTS public.seller_cod_commission_settings (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  cod_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_cod_reserve_deposit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  network text NOT NULL CHECK (network IN ('wave','qmoney','afrimoney')),
  payer_phone text NOT NULL CHECK (length(payer_phone) BETWEEN 6 AND 30),
  provider_reference text NOT NULL CHECK (length(trim(provider_reference)) BETWEEN 3 AND 120),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected')),
  review_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  ledger_batch_id uuid REFERENCES public.seller_wallet_ledger_batches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_cod_reserve_deposit_reference_unique
  ON public.seller_cod_reserve_deposit_requests(network, lower(provider_reference));
CREATE INDEX IF NOT EXISTS seller_cod_reserve_deposits_pending_idx
  ON public.seller_cod_reserve_deposit_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seller_cod_commission_reservations (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  merchandise_amount numeric(14,2) NOT NULL CHECK (merchandise_amount >= 0),
  commission_rate numeric(5,2) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
  commission_amount numeric(14,2) NOT NULL CHECK (commission_amount >= 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','captured','released')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz,
  released_at timestamptz,
  reserve_batch_id uuid REFERENCES public.seller_wallet_ledger_batches(id) ON DELETE RESTRICT,
  settlement_batch_id uuid REFERENCES public.seller_wallet_ledger_batches(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS seller_cod_commission_reservations_seller_status_idx
  ON public.seller_cod_commission_reservations(seller_id,status,reserved_at DESC);

ALTER TABLE public.seller_cod_commission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_cod_reserve_deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_cod_commission_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_cod_commission_settings_read ON public.seller_cod_commission_settings;
CREATE POLICY seller_cod_commission_settings_read ON public.seller_cod_commission_settings
  FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

DROP POLICY IF EXISTS seller_cod_reserve_deposits_read ON public.seller_cod_reserve_deposit_requests;
CREATE POLICY seller_cod_reserve_deposits_read ON public.seller_cod_reserve_deposit_requests
  FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

REVOKE ALL ON public.seller_cod_commission_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_cod_reserve_deposit_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_cod_commission_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_cod_commission_settings TO authenticated;
GRANT SELECT ON public.seller_cod_reserve_deposit_requests TO authenticated;

-- A trusted create_order wrapper sets a transaction-local flag for first insertion of
-- an online payment method. The browser cannot set this flag through PostgREST.
ALTER FUNCTION public.create_order(
  jsonb, character varying, text, character varying, character varying,
  character varying, text, character varying, character varying
) RENAME TO gambasket_create_order_internal;

CREATE OR REPLACE FUNCTION public.create_order(
  p_items jsonb,
  p_fulfillment_type character varying,
  p_delivery_address text DEFAULT NULL::text,
  p_delivery_region character varying DEFAULT NULL::character varying,
  p_delivery_area character varying DEFAULT NULL::character varying,
  p_delivery_phone character varying DEFAULT NULL::character varying,
  p_delivery_instructions text DEFAULT NULL::text,
  p_payment_method character varying DEFAULT 'cash_on_delivery'::character varying,
  p_coupon_code character varying DEFAULT NULL::character varying
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order jsonb;
  v_method text:=COALESCE(NULLIF(trim(p_payment_method),''),'cash_on_delivery');
  v_seller_id uuid;
  v_merchandise numeric(14,2);
  v_eligibility jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF v_method NOT IN ('cash_on_delivery','wave','qmoney','afrimoney') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
  END IF;
  -- The original checkout routine creates the order and reserves inventory as one
  -- atomic operation. Start internally as COD, then move online selections to a
  -- non-COD placeholder before the transaction commits.
  PERFORM set_config('app.gambasket_order_creation','on',true);
  v_order:=public.gambasket_create_order_internal(
    p_items,p_fulfillment_type,p_delivery_address,p_delivery_region,p_delivery_area,
    p_delivery_phone,p_delivery_instructions,'cash_on_delivery',p_coupon_code
  );
  IF v_method='cash_on_delivery' THEN
    SELECT o.seller_id,GREATEST(o.subtotal-o.discount_amount,0)
    INTO v_seller_id,v_merchandise
    FROM public.orders o
    WHERE o.id=(v_order->>'id')::uuid AND o.buyer_id=auth.uid();
    IF NOT FOUND THEN RAISE EXCEPTION 'COD_ORDER_NOT_FOUND'; END IF;
    v_eligibility:=public.gambasket_cod_checkout_eligibility(v_seller_id,v_merchandise);
    IF NOT COALESCE((v_eligibility->>'eligible')::boolean,false) THEN
      RAISE EXCEPTION 'SELLER_COD_NOT_ELIGIBLE: This seller has not enabled COD or does not have enough prepaid commission reserve';
    END IF;
  ELSE
    UPDATE public.orders
    SET payment_method='pending_online',updated_at=now()
    WHERE id=(v_order->>'id')::uuid AND buyer_id=auth.uid()
      AND order_status='pending' AND payment_status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'ONLINE_ORDER_SETUP_FAILED'; END IF;
  END IF;
  RETURN v_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.gambasket_create_order_internal(
  jsonb, character varying, text, character varying, character varying,
  character varying, text, character varying, character varying
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_order(
  jsonb, character varying, text, character varying, character varying,
  character varying, text, character varying, character varying
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(
  jsonb, character varying, text, character varying, character varying,
  character varying, text, character varying, character varying
) TO authenticated;

CREATE OR REPLACE FUNCTION public.gambasket_guard_order_payment_method()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='INSERT'
     AND current_setting('app.gambasket_order_creation',true)='on'
     AND NEW.payment_status='pending'
     AND NEW.payment_method='cash_on_delivery' THEN
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE'
     AND current_setting('app.gambasket_order_creation',true)='on'
     AND OLD.payment_method='cash_on_delivery'
     AND NEW.payment_method='pending_online'
     AND NEW.payment_status='pending'
     AND OLD.order_status='pending'
     AND NEW.order_status='pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method IS NULL THEN RETURN NEW; END IF;

  IF NEW.payment_method='cash_on_delivery' THEN
    IF TG_OP='INSERT' OR OLD.payment_method IS DISTINCT FROM NEW.payment_method THEN
      RAISE EXCEPTION 'COD orders must be created through the trusted checkout flow';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.payment_method NOT IN ('pending_online','wave','qmoney','afrimoney') THEN
    RAISE EXCEPTION 'Unsupported checkout payment method';
  END IF;

  IF NEW.payment_method='pending_online' THEN
    RAISE EXCEPTION 'Pending-online is reserved for the trusted checkout transaction';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gambasket_payments p
    WHERE p.order_id=NEW.id AND p.buyer_id=NEW.buyer_id
      AND p.currency='GMD' AND p.amount=NEW.total
      AND p.status IN ('pending','succeeded')
      AND p.metadata->>'payment_method'=NEW.payment_method
  ) THEN
    RAISE EXCEPTION 'A matching ModemPay payment intent is required for online checkout';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gambasket_require_paid_online_order_before_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.order_status IS DISTINCT FROM NEW.order_status
     AND NEW.order_status='confirmed'
     AND NEW.payment_method IS DISTINCT FROM 'cash_on_delivery'
     AND NEW.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'ONLINE_PAYMENT_REQUIRED: The buyer must complete ModemPay checkout before this order can be accepted';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_require_paid_online_before_acceptance ON public.orders;
CREATE TRIGGER orders_require_paid_online_before_acceptance
BEFORE UPDATE OF order_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.gambasket_require_paid_online_order_before_acceptance();

REVOKE ALL ON FUNCTION public.gambasket_require_paid_online_order_before_acceptance() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gambasket_cod_checkout_eligibility(
  p_seller_id uuid,
  p_merchandise_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_enabled boolean:=false;
  v_rate numeric(5,2):=5.00;
  v_required numeric(14,2):=0;
  v_available numeric(14,2):=0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_seller_id IS NULL OR COALESCE(p_merchandise_amount,-1)<0 THEN
    RAISE EXCEPTION 'Invalid COD eligibility request';
  END IF;
  SELECT COALESCE(s.cod_enabled,false) INTO v_enabled
  FROM public.seller_cod_commission_settings s WHERE s.seller_id=p_seller_id;
  SELECT commission_rate INTO v_rate FROM public.gambasket_finance_settings WHERE id=1;
  v_rate:=COALESCE(v_rate,5.00);
  v_required:=round(p_merchandise_amount*v_rate/100,2);
  SELECT COALESCE(sum(e.credit-e.debit),0)::numeric(14,2) INTO v_available
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id=p_seller_id AND e.account_code='seller_reserve';
  RETURN jsonb_build_object(
    'eligible',v_enabled AND v_available>=v_required AND v_required>0,
    'reason',CASE WHEN NOT v_enabled THEN 'seller_cod_disabled'
      WHEN v_required<=0 THEN 'invalid_merchandise_amount'
      WHEN v_available<v_required THEN 'insufficient_cod_reserve'
      ELSE 'eligible' END,
    'required_reserve',v_required,
    'commission_rate',v_rate
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.seller_get_cod_reserve_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_seller uuid:=auth.uid();
  v_enabled boolean:=false;
  v_available numeric(14,2):=0;
  v_committed numeric(14,2):=0;
  v_rate numeric(5,2):=5.00;
  v_pending integer:=0;
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller,'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  INSERT INTO public.seller_cod_commission_settings(seller_id)
  VALUES(v_seller) ON CONFLICT(seller_id) DO NOTHING;
  SELECT cod_enabled INTO v_enabled FROM public.seller_cod_commission_settings WHERE seller_id=v_seller;
  SELECT commission_rate INTO v_rate FROM public.gambasket_finance_settings WHERE id=1;
  SELECT COALESCE(sum(e.credit-e.debit),0)::numeric(14,2) INTO v_available
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id=v_seller AND e.account_code='seller_reserve';
  SELECT COALESCE(sum(e.credit-e.debit),0)::numeric(14,2) INTO v_committed
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id=v_seller AND e.account_code='seller_cod_commission_reserved';
  SELECT count(*)::integer INTO v_pending
  FROM public.seller_cod_reserve_deposit_requests d
  WHERE d.seller_id=v_seller AND d.status='requested';
  RETURN jsonb_build_object(
    'cod_enabled',COALESCE(v_enabled,false),
    'reserve_available',v_available,
    'reserve_committed',v_committed,
    'commission_rate',COALESCE(v_rate,5.00),
    'pending_deposits_count',v_pending
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.seller_set_cod_checkout_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_seller uuid:=auth.uid();
  v_available numeric(14,2):=0;
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller,'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_seller::text,0));
  IF p_enabled THEN
    SELECT COALESCE(sum(e.credit-e.debit),0)::numeric(14,2) INTO v_available
    FROM public.seller_wallet_ledger_entries e
    WHERE e.account_owner_id=v_seller AND e.account_code='seller_reserve';
    IF v_available<=0 THEN RAISE EXCEPTION 'Fund your COD commission reserve before enabling Cash on Delivery'; END IF;
  END IF;
  INSERT INTO public.seller_cod_commission_settings(seller_id,cod_enabled,updated_at)
  VALUES(v_seller,p_enabled,now())
  ON CONFLICT(seller_id) DO UPDATE SET cod_enabled=EXCLUDED.cod_enabled,updated_at=now();
  RETURN jsonb_build_object('success',true,'cod_enabled',p_enabled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.seller_fund_cod_commission_reserve(
  p_amount numeric,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_seller uuid:=auth.uid();
  v_available numeric(14,2):=0;
  v_batch uuid;
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller,'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
     OR length(trim(COALESCE(p_idempotency_key,''))) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'Invalid COD reserve funding request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_seller::text,0));
  SELECT id INTO v_batch FROM public.seller_wallet_ledger_batches
  WHERE idempotency_key='cod-reserve-fund:'||p_idempotency_key;
  IF v_batch IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'idempotent_replay',true,'batch_id',v_batch);
  END IF;
  SELECT COALESCE(sum(e.credit-e.debit),0)::numeric(14,2) INTO v_available
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id=v_seller AND e.account_code='seller_available';
  IF v_available<p_amount THEN RAISE EXCEPTION 'Insufficient available wallet balance'; END IF;

  INSERT INTO public.seller_wallet_ledger_batches(idempotency_key,source_type,description,created_by)
  VALUES('cod-reserve-fund:'||p_idempotency_key,'cod_reserve_fund',
    'Seller moved available wallet funds into COD commission reserve',v_seller)
  RETURNING id INTO v_batch;
  INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency)
  VALUES(v_batch,'seller_available',v_seller,p_amount,'GMD');
  INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency)
  VALUES(v_batch,'seller_reserve',v_seller,p_amount,'GMD');
  RETURN jsonb_build_object('success',true,'batch_id',v_batch,'amount',p_amount);
END;
$function$;

CREATE OR REPLACE FUNCTION public.seller_request_cod_reserve_deposit(
  p_amount numeric,
  p_network text,
  p_payer_phone text,
  p_provider_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_seller uuid:=auth.uid();
  v_id uuid;
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller,'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
     OR p_network NOT IN ('wave','qmoney','afrimoney')
     OR length(trim(COALESCE(p_payer_phone,''))) NOT BETWEEN 6 AND 30
     OR length(trim(COALESCE(p_provider_reference,''))) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'Invalid mobile-money deposit details';
  END IF;
  INSERT INTO public.seller_cod_reserve_deposit_requests(
    seller_id,amount,network,payer_phone,provider_reference
  ) VALUES(v_seller,p_amount,p_network,trim(p_payer_phone),trim(p_provider_reference))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'deposit_id',v_id,'status','requested',
    'message','Deposit submitted for verification. Your reserve will update only after approval.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_seller_cod_reserve_deposit(
  p_deposit_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_deposit public.seller_cod_reserve_deposit_requests%ROWTYPE;
  v_batch uuid;
BEGIN
  IF NOT public.is_gambasket_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid deposit decision'; END IF;
  SELECT * INTO v_deposit FROM public.seller_cod_reserve_deposit_requests
  WHERE id=p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD reserve deposit not found'; END IF;
  IF v_deposit.status<>'requested' THEN
    RAISE EXCEPTION 'This COD reserve deposit has already been reviewed';
  END IF;
  IF p_decision='approved' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_deposit.seller_id::text,0));
    INSERT INTO public.seller_wallet_ledger_batches(
      idempotency_key,source_type,source_id,description,created_by
    ) VALUES(
      'cod-reserve-deposit:'||v_deposit.id::text,'cod_reserve_deposit',v_deposit.id,
      'Admin-verified external COD commission reserve deposit',auth.uid()
    ) RETURNING id INTO v_batch;
    INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency)
    VALUES(v_batch,'gateway_clearing',NULL,v_deposit.amount,'GMD');
    INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency)
    VALUES(v_batch,'seller_reserve',v_deposit.seller_id,v_deposit.amount,'GMD');
  END IF;
  UPDATE public.seller_cod_reserve_deposit_requests
  SET status=p_decision,review_note=NULLIF(trim(COALESCE(p_note,'')),''),
      reviewed_by=auth.uid(),reviewed_at=now(),ledger_batch_id=v_batch
  WHERE id=p_deposit_id;
  RETURN jsonb_build_object('success',true,'deposit_id',p_deposit_id,
    'status',p_decision,'credited',p_decision='approved');
END;
$function$;

CREATE OR REPLACE FUNCTION public.gambasket_reserve_cod_commission_for_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_enabled boolean:=false;
  v_rate numeric(5,2):=5.00;
  v_merchandise numeric(14,2):=0;
  v_fee numeric(14,2):=0;
  v_available numeric(14,2):=0;
  v_batch uuid;
BEGIN
  IF NEW.payment_method IS DISTINCT FROM 'cash_on_delivery' OR NEW.order_status IS DISTINCT FROM 'confirmed' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.seller_id::text,0));
  SELECT COALESCE(cod_enabled,false) INTO v_enabled
  FROM public.seller_cod_commission_settings WHERE seller_id=NEW.seller_id FOR UPDATE;
  IF NOT COALESCE(v_enabled,false) THEN
    RAISE EXCEPTION 'SELLER_COD_DISABLED: This seller has not enabled Cash on Delivery';
  END IF;
  SELECT commission_rate INTO v_rate FROM public.gambasket_finance_settings WHERE id=1;
  v_rate:=COALESCE(v_rate,5.00);
  v_merchandise:=GREATEST(COALESCE(NEW.subtotal,0)-COALESCE(NEW.discount_amount,0),0);
  v_fee:=round(v_merchandise*v_rate/100,2);
  IF v_fee<=0 THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(sum(e.credit-e.debit),0)::numeric(14,2) INTO v_available
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id=NEW.seller_id AND e.account_code='seller_reserve';
  IF v_available<v_fee THEN
    RAISE EXCEPTION 'COD_RESERVE_INSUFFICIENT: Add D % to your COD reserve to accept this payment method',round(v_fee-v_available,2);
  END IF;
  INSERT INTO public.seller_wallet_ledger_batches(
    idempotency_key,source_type,source_id,description,created_by
  ) VALUES(
    'cod-order-reserve:'||NEW.id::text,'cod_order_reserve',NEW.id,
    '5% COD commission reserve held for order '||COALESCE(NEW.order_number,NEW.id::text),auth.uid()
  ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
  IF v_batch IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,order_id)
  VALUES(v_batch,'seller_reserve',NEW.seller_id,v_fee,'GMD',NEW.id);
  INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,order_id)
  VALUES(v_batch,'seller_cod_commission_reserved',NEW.seller_id,v_fee,'GMD',NEW.id);
  INSERT INTO public.seller_cod_commission_reservations(
    order_id,seller_id,merchandise_amount,commission_rate,commission_amount,status,reserve_batch_id
  ) VALUES(NEW.id,NEW.seller_id,v_merchandise,v_rate,v_fee,'reserved',v_batch);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_reserve_cod_commission ON public.orders;
CREATE TRIGGER orders_reserve_cod_commission
AFTER UPDATE OF order_status ON public.orders
FOR EACH ROW
WHEN (OLD.order_status IS DISTINCT FROM NEW.order_status
  AND NEW.order_status='confirmed' AND NEW.payment_method='cash_on_delivery')
EXECUTE FUNCTION public.gambasket_reserve_cod_commission_for_order();

CREATE OR REPLACE FUNCTION public.gambasket_release_cod_commission_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_reservation public.seller_cod_commission_reservations%ROWTYPE;
  v_batch uuid;
BEGIN
  SELECT * INTO v_reservation FROM public.seller_cod_commission_reservations
  WHERE order_id=NEW.id AND status='reserved' FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_reservation.seller_id::text,0));
  INSERT INTO public.seller_wallet_ledger_batches(
    idempotency_key,source_type,source_id,description,created_by
  ) VALUES(
    'cod-order-release:'||NEW.id::text,'cod_order_release',NEW.id,
    'Release COD commission reserve because the order was cancelled',auth.uid()
  ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
  IF v_batch IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,order_id)
  VALUES(v_batch,'seller_cod_commission_reserved',v_reservation.seller_id,v_reservation.commission_amount,'GMD',NEW.id);
  INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,order_id)
  VALUES(v_batch,'seller_reserve',v_reservation.seller_id,v_reservation.commission_amount,'GMD',NEW.id);
  UPDATE public.seller_cod_commission_reservations
  SET status='released',released_at=now(),settlement_batch_id=v_batch
  WHERE order_id=NEW.id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_release_cod_commission_on_cancel ON public.orders;
CREATE TRIGGER orders_release_cod_commission_on_cancel
AFTER UPDATE OF order_status ON public.orders
FOR EACH ROW
WHEN (OLD.order_status IS DISTINCT FROM NEW.order_status AND NEW.order_status='cancelled')
EXECUTE FUNCTION public.gambasket_release_cod_commission_on_cancel();

-- Keep the existing ModemPay release processor and extend it with COD settlement.
ALTER FUNCTION public.gambasket_release_due_seller_funds() RENAME TO gambasket_release_due_seller_funds_legacy;

CREATE OR REPLACE FUNCTION public.gambasket_release_due_seller_funds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer:=0;
  v_cod record;
  v_batch uuid;
BEGIN
  v_count:=public.gambasket_release_due_seller_funds_legacy();

  FOR v_cod IN
    SELECT r.order_id,r.seller_id,r.commission_amount,d.id AS proof_id,o.order_number
    FROM public.seller_cod_commission_reservations r
    JOIN public.orders o ON o.id=r.order_id
    JOIN public.delivery_otp_confirmations d ON d.order_id=o.id
    WHERE r.status='reserved'
      AND o.payment_method='cash_on_delivery'
      AND d.courier_marked_delivered_at IS NOT NULL
      AND d.buyer_confirmed_at IS NOT NULL
      AND d.dispute_until<=now()
      AND d.released_at IS NULL
      AND ((o.fulfillment_type='delivery' AND o.order_status='delivered')
        OR (o.fulfillment_type='pickup' AND o.order_status='completed'))
      AND NOT EXISTS (
        SELECT 1 FROM public.order_refund_cases f
        WHERE f.order_id=o.id
          AND f.status IN ('requested','under_review','approved','provider_pending')
      )
    ORDER BY d.dispute_until
    FOR UPDATE OF r,d SKIP LOCKED
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_cod.seller_id::text,0));
    INSERT INTO public.seller_wallet_ledger_batches(
      idempotency_key,source_type,source_id,description,created_by
    ) VALUES(
      'cod-commission-capture:'||v_cod.order_id::text,'cod_commission_capture',v_cod.order_id,
      'Capture COD marketplace commission after buyer OTP and 24-hour dispute window',NULL
    ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
    IF v_batch IS NOT NULL THEN
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,order_id)
      VALUES(v_batch,'seller_cod_commission_reserved',v_cod.seller_id,v_cod.commission_amount,'GMD',v_cod.order_id);
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,order_id)
      VALUES(v_batch,'platform_commission',NULL,v_cod.commission_amount,'GMD',v_cod.order_id);
      UPDATE public.seller_cod_commission_reservations
      SET status='captured',captured_at=now(),settlement_batch_id=v_batch
      WHERE order_id=v_cod.order_id AND status='reserved';
      UPDATE public.delivery_otp_confirmations
      SET released_at=now(),updated_at=now()
      WHERE id=v_cod.proof_id AND released_at IS NULL;
      v_count:=v_count+1;
    END IF;
  END LOOP;

  -- A COD refund prevents commission capture and releases the held amount after the
  -- same proof/dispute gate. The seller handles the cash refund with the buyer.
  FOR v_cod IN
    SELECT r.order_id,r.seller_id,r.commission_amount,d.id AS proof_id
    FROM public.seller_cod_commission_reservations r
    JOIN public.orders o ON o.id=r.order_id
    JOIN public.delivery_otp_confirmations d ON d.order_id=o.id
    WHERE r.status='reserved'
      AND o.payment_method='cash_on_delivery'
      AND d.courier_marked_delivered_at IS NOT NULL
      AND d.buyer_confirmed_at IS NOT NULL
      AND d.dispute_until<=now()
      AND d.released_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.order_refund_cases f
        WHERE f.order_id=o.id AND f.status='refunded'
      )
    ORDER BY d.dispute_until
    FOR UPDATE OF r,d SKIP LOCKED
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_cod.seller_id::text,0));
    INSERT INTO public.seller_wallet_ledger_batches(
      idempotency_key,source_type,source_id,description,created_by
    ) VALUES(
      'cod-refund-release:'||v_cod.order_id::text,'cod_order_release',v_cod.order_id,
      'Release COD commission reserve after refund',NULL
    ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
    IF v_batch IS NOT NULL THEN
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,order_id)
      VALUES(v_batch,'seller_cod_commission_reserved',v_cod.seller_id,v_cod.commission_amount,'GMD',v_cod.order_id);
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,order_id)
      VALUES(v_batch,'seller_reserve',v_cod.seller_id,v_cod.commission_amount,'GMD',v_cod.order_id);
      UPDATE public.seller_cod_commission_reservations
      SET status='released',released_at=now(),settlement_batch_id=v_batch
      WHERE order_id=v_cod.order_id AND status='reserved';
      UPDATE public.delivery_otp_confirmations
      SET released_at=now(),updated_at=now()
      WHERE id=v_cod.proof_id AND released_at IS NULL;
      v_count:=v_count+1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.gambasket_cod_checkout_eligibility(uuid,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_get_cod_reserve_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_set_cod_checkout_enabled(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_fund_cod_commission_reserve(numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_request_cod_reserve_deposit(numeric,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_seller_cod_reserve_deposit(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gambasket_cod_checkout_eligibility(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_get_cod_reserve_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_set_cod_checkout_enabled(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_fund_cod_commission_reserve(numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_request_cod_reserve_deposit(numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_seller_cod_reserve_deposit(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.gambasket_reserve_cod_commission_for_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gambasket_release_cod_commission_on_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gambasket_release_due_seller_funds_legacy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gambasket_release_due_seller_funds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gambasket_release_due_seller_funds() TO service_role;

COMMENT ON TABLE public.seller_cod_commission_reservations IS
  'COD commission holds created when a seller accepts the order; captured only after verified delivery and the 24-hour dispute window, or released on cancellation/refund.';
COMMENT ON TABLE public.seller_cod_reserve_deposit_requests IS
  'Seller-submitted external mobile-money reserve deposits. No funds are credited until an administrator verifies and approves the transaction.';
