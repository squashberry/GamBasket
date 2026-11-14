-- GamBasket financial journal and ModemPay transaction records.
-- This foundation is intentionally separate from checkout activation and live transfers.
BEGIN;

CREATE TABLE public.gambasket_finance_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  commission_rate numeric(5,2) NOT NULL DEFAULT 5.00 CHECK (commission_rate BETWEEN 0 AND 100),
  seller_release_window_hours integer NOT NULL DEFAULT 24 CHECK (seller_release_window_hours BETWEEN 1 AND 168),
  refund_provider_window_hours integer NOT NULL DEFAULT 48 CHECK (refund_provider_window_hours BETWEEN 1 AND 720),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gambasket_finance_settings(id, commission_rate, seller_release_window_hours, refund_provider_window_hours)
VALUES (1, 5.00, 24, 48) ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.gambasket_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'modempay' CHECK (provider = 'modempay'),
  provider_intent_id text,
  provider_reference text UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','pending','succeeded','failed','cancelled','partially_refunded','refunded')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz,
  UNIQUE(provider, provider_intent_id)
);

CREATE INDEX gambasket_payments_order_idx ON public.gambasket_payments(order_id, created_at DESC);
CREATE INDEX gambasket_payments_buyer_idx ON public.gambasket_payments(buyer_id, created_at DESC);

CREATE TABLE public.gambasket_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'modempay' CHECK (provider = 'modempay'),
  provider_event_id text NOT NULL,
  payment_id uuid REFERENCES public.gambasket_payments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored','failed')),
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE public.seller_wallet_ledger_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  source_type text NOT NULL
    CHECK (source_type IN ('payment','delivery_release','payout_request','payout_success','payout_failure','refund','admin_adjustment')),
  source_id uuid,
  description text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.seller_wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.seller_wallet_ledger_batches(id) ON DELETE RESTRICT,
  account_code text NOT NULL CHECK (account_code IN (
    'gateway_clearing','seller_pending','seller_available','seller_payout_in_transit',
    'seller_reserve','platform_commission','delivery_payable'
  )),
  account_owner_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency text NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
  order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.gambasket_payments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  CHECK (
    (account_code IN ('seller_pending','seller_available','seller_payout_in_transit','seller_reserve') AND account_owner_id IS NOT NULL)
    OR (account_code IN ('gateway_clearing','platform_commission','delivery_payable') AND account_owner_id IS NULL)
  )
);

CREATE INDEX seller_wallet_ledger_owner_idx
  ON public.seller_wallet_ledger_entries(account_owner_id, account_code, created_at DESC);
CREATE INDEX seller_wallet_ledger_batch_idx
  ON public.seller_wallet_ledger_entries(batch_id);

COMMENT ON TABLE public.seller_wallet_ledger_batches IS
  'Immutable idempotent journal batches; each batch must balance before commit.';
COMMENT ON TABLE public.seller_wallet_ledger_entries IS
  'Append-only double-entry journal. Seller liability balances are credits minus debits.';

CREATE FUNCTION public.assert_gambasket_ledger_batch_balanced()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_batch_id uuid;
  v_count integer;
  v_debits numeric(16,2);
  v_credits numeric(16,2);
BEGIN
  IF TG_TABLE_NAME = 'seller_wallet_ledger_batches' THEN
    v_batch_id := NEW.id;
  ELSE
    v_batch_id := NEW.batch_id;
  END IF;
  SELECT count(*), coalesce(sum(debit),0), coalesce(sum(credit),0)
  INTO v_count, v_debits, v_credits
  FROM public.seller_wallet_ledger_entries WHERE batch_id = v_batch_id;
  IF v_count < 2 OR v_debits <> v_credits THEN
    RAISE EXCEPTION 'Unbalanced GamBasket ledger batch %', v_batch_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE CONSTRAINT TRIGGER seller_wallet_batch_balanced
AFTER INSERT ON public.seller_wallet_ledger_batches
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.assert_gambasket_ledger_batch_balanced();

CREATE CONSTRAINT TRIGGER seller_wallet_entries_balanced
AFTER INSERT ON public.seller_wallet_ledger_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.assert_gambasket_ledger_batch_balanced();

CREATE FUNCTION public.reject_gambasket_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'GamBasket financial ledger records are immutable';
END;
$fn$;

CREATE TRIGGER seller_wallet_batches_immutable
BEFORE UPDATE OR DELETE ON public.seller_wallet_ledger_batches
FOR EACH ROW EXECUTE FUNCTION public.reject_gambasket_ledger_mutation();

CREATE TRIGGER seller_wallet_entries_immutable
BEFORE UPDATE OR DELETE ON public.seller_wallet_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.reject_gambasket_ledger_mutation();

ALTER TABLE public.gambasket_finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gambasket_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gambasket_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_wallet_ledger_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_wallet_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY gambasket_finance_settings_read
ON public.gambasket_finance_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY gambasket_payments_party_read
ON public.gambasket_payments FOR SELECT TO authenticated
USING (
  buyer_id = (SELECT auth.uid())
  OR public.is_gambasket_admin()
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = gambasket_payments.order_id AND o.seller_id = (SELECT auth.uid())
  )
);

CREATE POLICY gambasket_payment_events_admin_read
ON public.gambasket_payment_events FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

CREATE POLICY seller_wallet_batches_admin_read
ON public.seller_wallet_ledger_batches FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

CREATE POLICY seller_wallet_entries_owner_read
ON public.seller_wallet_ledger_entries FOR SELECT TO authenticated
USING (account_owner_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

REVOKE ALL ON TABLE public.gambasket_finance_settings, public.gambasket_payments,
  public.gambasket_payment_events, public.seller_wallet_ledger_batches,
  public.seller_wallet_ledger_entries FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.gambasket_finance_settings, public.gambasket_payments,
  public.gambasket_payment_events, public.seller_wallet_ledger_batches,
  public.seller_wallet_ledger_entries TO authenticated;

REVOKE ALL ON FUNCTION public.assert_gambasket_ledger_batch_balanced() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_gambasket_ledger_mutation() FROM PUBLIC, anon, authenticated;

COMMIT;
