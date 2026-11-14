-- GamBasket server-controlled ModemPay lifecycle.
-- Online checkout is enabled only when the provider intent exists; payment is confirmed only by signed webhook.
-- Seller proceeds remain pending until courier + buyer OTP proof and the 24-hour dispute window pass.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS gambasket_one_open_payment_per_order_idx
ON public.gambasket_payments(order_id)
WHERE status IN ('created','pending');

CREATE OR REPLACE FUNCTION public.gambasket_guard_order_payment_method()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.payment_method IS NULL OR NEW.payment_method='cash_on_delivery' THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_method NOT IN ('wave','qmoney','afrimoney') THEN
    RAISE EXCEPTION 'Unsupported checkout payment method';
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
$fn$;

DROP TRIGGER IF EXISTS orders_guard_online_payment_method ON public.orders;
CREATE TRIGGER orders_guard_online_payment_method
BEFORE INSERT OR UPDATE OF payment_method ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.gambasket_guard_order_payment_method();

CREATE OR REPLACE FUNCTION public.gambasket_prevent_unverified_delivery()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.status='delivered'
     AND COALESCE(current_setting('app.gambasket_delivery_verified',true),'')<>'on' THEN
    RAISE EXCEPTION 'Courier delivery requires buyer OTP confirmation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS delivery_requests_require_buyer_otp ON public.delivery_requests;
CREATE TRIGGER delivery_requests_require_buyer_otp
BEFORE UPDATE OF status ON public.delivery_requests
FOR EACH ROW EXECUTE FUNCTION public.gambasket_prevent_unverified_delivery();

CREATE OR REPLACE FUNCTION public.gambasket_prevent_unverified_order_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.order_status IN ('delivered','completed')
     AND OLD.order_status IS DISTINCT FROM NEW.order_status
     AND COALESCE(current_setting('app.gambasket_delivery_verified',true),'')<>'on' THEN
    RAISE EXCEPTION 'Order completion requires courier and buyer confirmation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS orders_require_buyer_delivery_proof ON public.orders;
CREATE TRIGGER orders_require_buyer_delivery_proof
BEFORE UPDATE OF order_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.gambasket_prevent_unverified_order_completion();

CREATE OR REPLACE FUNCTION public.gambasket_issue_delivery_otp(p_order_id uuid,p_otp_hash bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_delivery public.delivery_requests%ROWTYPE;
  v_courier uuid;
  v_delivery_id uuid;
  v_expiry timestamptz:=now()+interval '20 minutes';
BEGIN
  IF auth.uid() IS NULL OR p_otp_hash IS NULL OR octet_length(p_otp_hash)<>32 THEN
    RAISE EXCEPTION 'Authenticated buyer and valid delivery code required';
  END IF;
  SELECT * INTO v_order FROM public.orders
  WHERE id=p_order_id AND buyer_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF v_order.fulfillment_type='delivery' THEN
    SELECT * INTO v_delivery FROM public.delivery_requests
    WHERE order_id=p_order_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR v_delivery.status NOT IN ('picked_up','out_for_delivery')
       OR v_delivery.assigned_worker_id IS NULL THEN
      RAISE EXCEPTION 'The courier must collect the order before a delivery code is issued';
    END IF;
    v_courier:=v_delivery.assigned_worker_id;
    v_delivery_id:=v_delivery.id;
  ELSIF v_order.fulfillment_type='pickup' THEN
    IF v_order.order_status<>'ready_for_pickup' THEN
      RAISE EXCEPTION 'The seller must mark the order ready for pickup first';
    END IF;
    v_courier:=v_order.seller_id;
  ELSE
    RAISE EXCEPTION 'Unsupported fulfillment type';
  END IF;

  INSERT INTO public.delivery_otp_confirmations(
    order_id,delivery_request_id,buyer_id,courier_id,otp_hash,issued_at,expires_at,
    failed_attempts,courier_marked_delivered_at,buyer_confirmed_at,dispute_until,released_at,invalidated_at,updated_at
  ) VALUES (
    p_order_id,v_delivery_id,v_order.buyer_id,v_courier,p_otp_hash,now(),v_expiry,
    0,NULL,NULL,NULL,NULL,NULL,now()
  )
  ON CONFLICT(order_id) DO UPDATE SET
    delivery_request_id=EXCLUDED.delivery_request_id,
    buyer_id=EXCLUDED.buyer_id,courier_id=EXCLUDED.courier_id,otp_hash=EXCLUDED.otp_hash,
    issued_at=EXCLUDED.issued_at,expires_at=EXCLUDED.expires_at,failed_attempts=0,
    courier_marked_delivered_at=NULL,buyer_confirmed_at=NULL,dispute_until=NULL,
    released_at=NULL,invalidated_at=NULL,updated_at=now()
  WHERE public.delivery_otp_confirmations.buyer_confirmed_at IS NULL
    AND public.delivery_otp_confirmations.released_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery has already been confirmed'; END IF;
  RETURN jsonb_build_object('success',true,'expires_at',v_expiry);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_confirm_delivery_with_otp(p_order_id uuid,p_otp_hash bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_delivery public.delivery_requests%ROWTYPE;
  v_proof public.delivery_otp_confirmations%ROWTYPE;
  v_now timestamptz:=now();
  v_until timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_otp_hash IS NULL OR octet_length(p_otp_hash)<>32 THEN
    RAISE EXCEPTION 'Authenticated courier or seller and valid code required';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  SELECT * INTO v_proof FROM public.delivery_otp_confirmations
  WHERE order_id=p_order_id FOR UPDATE;

  IF NOT FOUND OR v_proof.buyer_id<>v_order.buyer_id
     OR v_proof.courier_id IS DISTINCT FROM auth.uid()
     OR v_proof.invalidated_at IS NOT NULL OR v_proof.expires_at<=v_now
     OR v_proof.failed_attempts>=10 OR v_proof.buyer_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success',false,'error','DELIVERY_CODE_EXPIRED_OR_INVALID');
  END IF;
  IF v_proof.otp_hash<>p_otp_hash THEN
    UPDATE public.delivery_otp_confirmations
    SET failed_attempts=LEAST(failed_attempts+1,10),updated_at=v_now WHERE id=v_proof.id;
    RETURN jsonb_build_object('success',false,'error','INCORRECT_DELIVERY_CODE',
      'attempts_remaining',GREATEST(0,9-v_proof.failed_attempts));
  END IF;

  IF v_order.fulfillment_type='delivery' THEN
    SELECT * INTO v_delivery FROM public.delivery_requests
    WHERE id=v_proof.delivery_request_id AND order_id=p_order_id
      AND assigned_worker_id=auth.uid() FOR UPDATE;
    IF NOT FOUND OR v_delivery.status<>'out_for_delivery' THEN
      RETURN jsonb_build_object('success',false,'error','DELIVERY_NOT_OUT_FOR_DELIVERY');
    END IF;
  ELSIF v_order.fulfillment_type='pickup' THEN
    IF v_order.seller_id<>auth.uid() OR v_order.order_status<>'ready_for_pickup' THEN
      RETURN jsonb_build_object('success',false,'error','PICKUP_NOT_READY');
    END IF;
  ELSE
    RETURN jsonb_build_object('success',false,'error','UNSUPPORTED_FULFILLMENT');
  END IF;

  v_until:=v_now+interval '24 hours';
  PERFORM set_config('app.gambasket_delivery_verified','on',true);
  UPDATE public.delivery_otp_confirmations
  SET courier_marked_delivered_at=v_now,buyer_confirmed_at=v_now,
      dispute_until=v_until,invalidated_at=v_now,updated_at=v_now
  WHERE id=v_proof.id;

  IF v_order.fulfillment_type='delivery' THEN
    UPDATE public.delivery_requests SET status='delivered',delivered_at=v_now,updated_at=v_now
    WHERE id=v_delivery.id;
    UPDATE public.orders SET order_status='delivered',updated_at=v_now WHERE id=p_order_id;
    INSERT INTO public.delivery_status_history(delivery_request_id,status,updated_by,notes)
    VALUES(v_delivery.id,'delivered',auth.uid(),'Buyer OTP verified at handoff');
    INSERT INTO public.earning_transactions(user_id,role_name,action_type,reference_id,amount,currency,status,description)
    SELECT auth.uid(),'delivery_worker','delivery_completed',v_delivery.id::text,
      GREATEST(COALESCE(v_delivery.estimated_fee,0),0),'GMD','available',
      'Completed delivery '||COALESCE(v_order.order_number,v_delivery.id::text)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.earning_transactions et
      WHERE et.user_id=auth.uid() AND et.role_name='delivery_worker'
        AND et.action_type='delivery_completed' AND et.reference_id=v_delivery.id::text
    );
    UPDATE public.delivery_profiles SET status='available',
      total_completed_deliveries=COALESCE(total_completed_deliveries,0)+1,updated_at=now()
    WHERE user_id=auth.uid();
  ELSE
    UPDATE public.orders SET order_status='completed',updated_at=v_now WHERE id=p_order_id;
  END IF;

  INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,notes)
  VALUES(p_order_id,v_order.order_status,
    CASE WHEN v_order.fulfillment_type='delivery' THEN 'delivered' ELSE 'completed' END,
    auth.uid(),'Courier/seller submitted buyer delivery OTP; handoff confirmed');
  IF v_order.buyer_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,type,title,message,data)
    VALUES(v_order.buyer_id,'delivery','Delivery confirmed',
      'Your delivery was confirmed with your one-time code.',
      jsonb_build_object('order_id',p_order_id,'dispute_until',v_until));
  END IF;
  RETURN jsonb_build_object('success',true,'order_id',p_order_id,'dispute_until',v_until,
    'seller_funds_release_after',v_until);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_process_modempay_charge(p_event_id text,p_event_type text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_eid text:=left(trim(COALESCE(p_event_id,'')),240);
  v_type text:=lower(trim(COALESCE(p_event_type,'')));
  v_local text:=p_payload->'metadata'->>'gambasket_payment_id';
  v_intent text:=NULLIF(p_payload->>'payment_intent_id','');
  v_ref text:=NULLIF(p_payload->>'transaction_reference','');
  v_payment public.gambasket_payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_event uuid;
  v_amount numeric(14,2);
  v_merchandise numeric(14,2);
  v_rate numeric(5,2);
  v_commission numeric(14,2);
  v_seller_net numeric(14,2);
  v_delivery numeric(14,2);
  v_batch uuid;
  v_status text:=lower(COALESCE(p_payload->>'status',''));
BEGIN
  IF v_eid='' OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid ModemPay event'; END IF;
  INSERT INTO public.gambasket_payment_events(provider,provider_event_id,event_type,signature_verified,payload,processing_status)
  VALUES('modempay',v_eid,v_type,true,p_payload,'received')
  ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id INTO v_event;
  IF v_event IS NULL THEN RETURN jsonb_build_object('success',true,'duplicate',true); END IF;

  SELECT * INTO v_payment FROM public.gambasket_payments p
  WHERE (v_local ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND p.id=v_local::uuid)
     OR (v_intent IS NOT NULL AND p.provider_intent_id=v_intent)
     OR (v_ref IS NOT NULL AND p.provider_reference=v_ref)
  ORDER BY p.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.gambasket_payment_events SET processing_status='ignored',processed_at=now(),
      processing_error='No matching local payment' WHERE id=v_event;
    RETURN jsonb_build_object('success',true,'ignored',true);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=v_payment.order_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.gambasket_payment_events SET processing_status='failed',processed_at=now(),
      processing_error='Order not found' WHERE id=v_event;
    RETURN jsonb_build_object('success',false,'error','ORDER_NOT_FOUND');
  END IF;

  v_amount:=NULLIF(p_payload->>'amount','')::numeric;
  IF v_amount IS NULL OR round(v_amount,2)<>v_payment.amount
     OR upper(COALESCE(p_payload->>'currency',''))<>'GMD'
     OR v_payment.currency<>'GMD'
     OR (p_payload->>'payment_method' IS NOT NULL AND
         lower(p_payload->>'payment_method')<>lower(v_payment.metadata->>'payment_method')) THEN
    UPDATE public.gambasket_payment_events SET processing_status='failed',processed_at=now(),
      processing_error='Amount, currency or payment method mismatch' WHERE id=v_event;
    RETURN jsonb_build_object('success',false,'error','PAYMENT_MISMATCH');
  END IF;
  UPDATE public.gambasket_payment_events SET payment_id=v_payment.id WHERE id=v_event;

  IF v_type IN ('charge.succeeded','payment.succeeded') OR v_status IN ('completed','succeeded') THEN
    IF v_payment.status='succeeded' THEN
      UPDATE public.gambasket_payment_events SET processing_status='processed',processed_at=now() WHERE id=v_event;
      RETURN jsonb_build_object('success',true,'already_succeeded',true);
    END IF;
    IF v_payment.status IN ('cancelled','refunded','failed') THEN
      UPDATE public.gambasket_payment_events SET processing_status='failed',processed_at=now(),
        processing_error='Charge received for a closed payment' WHERE id=v_event;
      RETURN jsonb_build_object('success',false,'error','PAYMENT_ALREADY_CLOSED');
    END IF;

    SELECT commission_rate INTO v_rate FROM public.gambasket_finance_settings WHERE id=1;
    v_rate:=COALESCE(v_rate,5.00);
    v_merchandise:=GREATEST(v_order.subtotal-v_order.discount_amount,0);
    v_commission:=round(v_merchandise*v_rate/100,2);
    v_seller_net:=v_merchandise-v_commission;
    v_delivery:=v_order.delivery_fee;

    INSERT INTO public.seller_wallet_ledger_batches(idempotency_key,source_type,source_id,description,created_by)
    VALUES('modempay-charge:'||v_payment.id::text,'payment',v_payment.id,
      'ModemPay verified payment for order '||v_order.order_number,NULL)
    ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
    IF v_batch IS NOT NULL THEN
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,debit,currency,order_id,payment_id)
      VALUES(v_batch,'gateway_clearing',v_payment.amount,'GMD',v_order.id,v_payment.id);
      IF v_seller_net>0 THEN
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,order_id,payment_id)
        VALUES(v_batch,'seller_pending',v_order.seller_id,v_seller_net,'GMD',v_order.id,v_payment.id);
      END IF;
      IF v_commission>0 THEN
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,credit,currency,order_id,payment_id)
        VALUES(v_batch,'platform_commission',v_commission,'GMD',v_order.id,v_payment.id);
      END IF;
      IF v_delivery>0 THEN
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,credit,currency,order_id,payment_id)
        VALUES(v_batch,'delivery_payable',v_delivery,'GMD',v_order.id,v_payment.id);
      END IF;
    END IF;

    UPDATE public.gambasket_payments SET status='succeeded',
      provider_reference=COALESCE(v_ref,provider_reference),
      provider_intent_id=COALESCE(v_intent,provider_intent_id),
      provider_payload=jsonb_build_object('last_event',v_type,'provider_status',v_status,'transaction_reference',v_ref),
      succeeded_at=COALESCE(succeeded_at,now()),updated_at=now()
    WHERE id=v_payment.id;
    UPDATE public.orders SET payment_status='paid',updated_at=now() WHERE id=v_order.id;

    IF v_order.order_status='cancelled' THEN
      INSERT INTO public.order_refund_cases(order_id,payment_id,buyer_id,seller_id,requested_amount,reason,description,status)
      VALUES(v_order.id,v_payment.id,v_order.buyer_id,v_order.seller_id,v_payment.amount,
        'Order cancelled before payment confirmation',
        'Payment was completed after cancellation; administrator refund review is required.','requested');
    END IF;

    UPDATE public.gambasket_payment_events SET processing_status='processed',processed_at=now() WHERE id=v_event;
    RETURN jsonb_build_object('success',true,'payment_id',v_payment.id,'order_id',v_order.id,
      'seller_pending',v_seller_net,'commission',v_commission);
  ELSIF v_type IN ('charge.failed','charge.cancelled','payment_intent.cancelled')
     OR v_status IN ('failed','cancelled','canceled') THEN
    UPDATE public.gambasket_payments SET
      status=CASE WHEN v_type LIKE '%cancel%' OR v_status IN ('cancelled','canceled') THEN 'cancelled' ELSE 'failed' END,
      provider_reference=COALESCE(v_ref,provider_reference),provider_intent_id=COALESCE(v_intent,provider_intent_id),
      provider_payload=jsonb_build_object('last_event',v_type,'provider_status',v_status),updated_at=now()
    WHERE id=v_payment.id AND status IN ('created','pending');
    UPDATE public.orders SET payment_status='failed',updated_at=now()
    WHERE id=v_order.id AND payment_status='pending';
    UPDATE public.gambasket_payment_events SET processing_status='processed',processed_at=now() WHERE id=v_event;
    RETURN jsonb_build_object('success',true,'payment_id',v_payment.id,'status','failed');
  END IF;
  UPDATE public.gambasket_payment_events SET processing_status='ignored',processed_at=now() WHERE id=v_event;
  RETURN jsonb_build_object('success',true,'ignored_event',v_type);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_process_modempay_transfer_event(p_event_id text,p_event_type text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_eid text:=left(trim(COALESCE(p_event_id,'')),240);
  v_type text:=lower(trim(COALESCE(p_event_type,'')));
  v_local text:=p_payload->'metadata'->>'gambasket_payout_id';
  v_provider text:=COALESCE(NULLIF(p_payload->>'id',''),NULLIF(p_payload->>'transfer_id',''));
  v_payout public.seller_payout_requests%ROWTYPE;
  v_batch uuid;
  v_status text;
BEGIN
  IF v_eid='' OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid transfer event'; END IF;
  SELECT * INTO v_payout FROM public.seller_payout_requests p
  WHERE (v_local ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND p.id=v_local::uuid)
     OR (v_provider IS NOT NULL AND p.provider_reference=v_provider)
  ORDER BY p.requested_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'ignored',true); END IF;

  INSERT INTO public.seller_payout_events(payout_request_id,provider,provider_event_id,event_type,payload)
  VALUES(v_payout.id,'modempay',v_eid,v_type,p_payload)
  ON CONFLICT(provider,provider_event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'duplicate',true); END IF;

  IF v_type IN ('transfer.succeeded','payout.succeeded') OR lower(COALESCE(p_payload->>'status',''))='succeeded' THEN
    IF v_payout.status<>'succeeded' THEN
      INSERT INTO public.seller_wallet_ledger_batches(idempotency_key,source_type,source_id,description,created_by)
      VALUES('modempay-payout-success:'||v_payout.id::text,'payout_success',v_payout.id,
        'ModemPay confirmed seller payout',NULL)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
      IF v_batch IS NOT NULL THEN
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,payout_request_id)
        VALUES(v_batch,'seller_payout_in_transit',v_payout.seller_id,v_payout.amount,'GMD',v_payout.id);
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,credit,currency,payout_request_id)
        VALUES(v_batch,'gateway_clearing',v_payout.amount,'GMD',v_payout.id);
      END IF;
    END IF;
    v_status:='succeeded';
  ELSIF v_type IN ('transfer.failed','transfer.reversed','payout.failed','payout.reversed')
      OR lower(COALESCE(p_payload->>'status','')) IN ('failed','reversed') THEN
    IF v_payout.status='succeeded' OR v_type IN ('transfer.reversed','payout.reversed') THEN
      INSERT INTO public.seller_wallet_ledger_batches(idempotency_key,source_type,source_id,description,created_by)
      VALUES('modempay-payout-reversal:'||v_payout.id::text,'payout_failure',v_payout.id,
        'ModemPay reversed a completed seller payout',NULL)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
      IF v_batch IS NOT NULL THEN
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,debit,currency,payout_request_id)
        VALUES(v_batch,'gateway_clearing',v_payout.amount,'GMD',v_payout.id);
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,payout_request_id)
        VALUES(v_batch,'seller_available',v_payout.seller_id,v_payout.amount,'GMD',v_payout.id);
      END IF;
      v_status:='reversed';
    ELSE
      INSERT INTO public.seller_wallet_ledger_batches(idempotency_key,source_type,source_id,description,created_by)
      VALUES('modempay-payout-failure:'||v_payout.id::text,'payout_failure',v_payout.id,
        'ModemPay rejected payout; reserved seller funds returned',NULL)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
      IF v_batch IS NOT NULL THEN
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,payout_request_id)
        VALUES(v_batch,'seller_payout_in_transit',v_payout.seller_id,v_payout.amount,'GMD',v_payout.id);
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,payout_request_id)
        VALUES(v_batch,'seller_available',v_payout.seller_id,v_payout.amount,'GMD',v_payout.id);
      END IF;
      v_status:='failed';
    END IF;
  ELSIF v_type IN ('transfer.flagged','payout.flagged') OR lower(COALESCE(p_payload->>'status',''))='flagged' THEN
    v_status:='processing';
  ELSE
    UPDATE public.seller_payout_events SET processed_at=now()
    WHERE provider='modempay' AND provider_event_id=v_eid;
    RETURN jsonb_build_object('success',true,'ignored_event',v_type);
  END IF;

  UPDATE public.seller_payout_requests SET status=v_status,
    provider_reference=COALESCE(v_provider,provider_reference),
    failure_reason=CASE WHEN v_status IN ('failed','reversed')
      THEN COALESCE(p_payload->>'message',p_payload->>'reason','Provider reported payout failure') ELSE NULL END,
    processed_at=CASE WHEN v_status IN ('succeeded','failed','reversed') THEN now() ELSE processed_at END,
    updated_at=now() WHERE id=v_payout.id;
  UPDATE public.seller_payout_events SET processed_at=now()
  WHERE provider='modempay' AND provider_event_id=v_eid;
  RETURN jsonb_build_object('success',true,'payout_id',v_payout.id,'status',v_status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_queue_automatic_payouts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_pref record;
  v_balance numeric(14,2);
  v_payout uuid;
  v_batch uuid;
  v_key text;
  v_count integer:=0;
BEGIN
  FOR v_pref IN
    SELECT pref.seller_id,pref.auto_payout_threshold,pref.payout_method_id
    FROM public.seller_wallet_preferences pref
    JOIN public.seller_payout_methods m ON m.id=pref.payout_method_id
      AND m.seller_id=pref.seller_id AND m.verification_status='active'
    WHERE pref.auto_payout_enabled AND pref.auto_payout_threshold>0
    ORDER BY pref.updated_at FOR UPDATE OF pref SKIP LOCKED
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_pref.seller_id::text,0));
    SELECT COALESCE(SUM(e.credit-e.debit),0)::numeric(14,2) INTO v_balance
    FROM public.seller_wallet_ledger_entries e
    WHERE e.account_owner_id=v_pref.seller_id AND e.account_code='seller_available';
    IF v_balance<v_pref.auto_payout_threshold OR v_balance<=0 THEN CONTINUE; END IF;
    v_key:='automatic:'||v_pref.seller_id::text||':'||to_char(now() AT TIME ZONE 'UTC','YYYYMMDD');
    IF EXISTS(SELECT 1 FROM public.seller_payout_requests WHERE seller_id=v_pref.seller_id AND idempotency_key=v_key) THEN CONTINUE; END IF;
    INSERT INTO public.seller_payout_requests(seller_id,payout_method_id,amount,request_source,status,idempotency_key)
    VALUES(v_pref.seller_id,v_pref.payout_method_id,v_balance,'automatic','requested',v_key)
    RETURNING id INTO v_payout;
    INSERT INTO public.seller_wallet_ledger_batches(idempotency_key,source_type,source_id,description,created_by)
    VALUES('payout-reservation:'||v_key,'payout_request',v_payout,'Automatic threshold payout reservation',NULL)
    RETURNING id INTO v_batch;
    INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,payout_request_id)
    VALUES(v_batch,'seller_available',v_pref.seller_id,v_balance,'GMD',v_payout);
    INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,payout_request_id)
    VALUES(v_batch,'seller_payout_in_transit',v_pref.seller_id,v_balance,'GMD',v_payout);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_release_due_seller_funds()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_order record;
  v_rate numeric(5,2);
  v_pending numeric(14,2);
  v_batch uuid;
  v_count integer:=0;
BEGIN
  SELECT commission_rate INTO v_rate FROM public.gambasket_finance_settings WHERE id=1;
  v_rate:=COALESCE(v_rate,5.00);
  FOR v_order IN
    SELECT d.id proof_id,d.order_id,o.seller_id,o.order_number,o.fulfillment_type
    FROM public.delivery_otp_confirmations d
    JOIN public.orders o ON o.id=d.order_id
    WHERE d.courier_marked_delivered_at IS NOT NULL AND d.buyer_confirmed_at IS NOT NULL
      AND d.dispute_until<=now() AND d.released_at IS NULL AND o.payment_status='paid'
      AND ((o.fulfillment_type='delivery' AND o.order_status='delivered')
        OR (o.fulfillment_type='pickup' AND o.order_status='completed'))
      AND NOT EXISTS (
        SELECT 1 FROM public.order_refund_cases r
        WHERE r.order_id=o.id AND r.status IN ('requested','under_review','approved','provider_pending','failed')
      )
    ORDER BY d.dispute_until FOR UPDATE OF d SKIP LOCKED
  LOOP
    SELECT GREATEST(COALESCE(SUM(e.credit-e.debit),0),0)::numeric(14,2)
    INTO v_pending FROM public.seller_wallet_ledger_entries e
    WHERE e.account_owner_id=v_order.seller_id AND e.account_code='seller_pending'
      AND e.order_id=v_order.order_id;
    IF v_pending>0 THEN
      INSERT INTO public.seller_wallet_ledger_batches(idempotency_key,source_type,source_id,description,created_by)
      VALUES('delivery-release:'||v_order.order_id::text,'delivery_release',v_order.order_id,
        'Release seller proceeds after verified handoff and dispute window',NULL)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
      IF v_batch IS NOT NULL THEN
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,order_id)
        VALUES(v_batch,'seller_pending',v_order.seller_id,v_pending,'GMD',v_order.order_id);
        INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,credit,currency,order_id)
        VALUES(v_batch,'seller_available',v_order.seller_id,v_pending,'GMD',v_order.order_id);
      END IF;
    END IF;
    UPDATE public.delivery_otp_confirmations SET released_at=now(),updated_at=now()
    WHERE id=v_order.proof_id;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_request_order_refund(
  p_order_id uuid,p_amount numeric,p_reason text,p_description text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_payment public.gambasket_payments%ROWTYPE;
  v_case uuid;
  v_reserved numeric(14,2);
  v_amount numeric(14,2):=round(COALESCE(p_amount,0),2);
  v_reason text:=trim(COALESCE(p_reason,''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_amount<=0 OR length(v_reason) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'Valid refund amount and reason required'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND buyer_id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_order.payment_status<>'paid' THEN RAISE EXCEPTION 'Only your paid order can be refunded'; END IF;
  SELECT * INTO v_payment FROM public.gambasket_payments
  WHERE order_id=p_order_id AND status IN ('succeeded','partially_refunded')
  ORDER BY succeeded_at DESC NULLS LAST LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No completed ModemPay payment found'; END IF;
  SELECT COALESCE(SUM(requested_amount),0)::numeric(14,2) INTO v_reserved
  FROM public.order_refund_cases
  WHERE payment_id=v_payment.id AND status IN ('requested','under_review','approved','provider_pending','succeeded');
  IF v_reserved+v_amount>v_payment.amount THEN RAISE EXCEPTION 'Refund amount exceeds remaining payment amount'; END IF;
  INSERT INTO public.order_refund_cases(order_id,payment_id,buyer_id,seller_id,requested_amount,reason,description,status)
  VALUES(p_order_id,v_payment.id,auth.uid(),v_order.seller_id,v_amount,v_reason,
    NULLIF(trim(COALESCE(p_description,'')),''),'requested')
  RETURNING id INTO v_case;
  RETURN v_case;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_review_gambasket_refund_case(p_case_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_status text:=lower(trim(COALESCE(p_status,'')));
  v_case public.order_refund_cases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_gambasket_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF v_status NOT IN ('approved','rejected','under_review','withdrawn') THEN RAISE EXCEPTION 'Invalid refund review status'; END IF;
  SELECT * INTO v_case FROM public.order_refund_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund case not found'; END IF;
  IF v_case.status IN ('succeeded','provider_pending') THEN RAISE EXCEPTION 'Refund case is already being processed or complete'; END IF;
  UPDATE public.order_refund_cases SET status=v_status,updated_at=now(),
    resolved_at=CASE WHEN v_status IN ('approved','rejected','withdrawn') THEN now() ELSE NULL END
  WHERE id=p_case_id;
  RETURN jsonb_build_object('success',true,'refund_case_id',p_case_id,'status',v_status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_validate_refund_case(p_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_case public.order_refund_cases%ROWTYPE;
  v_payment public.gambasket_payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_rate numeric(5,2);
  v_merchandise numeric(14,2);
  v_commission numeric(14,2);
  v_seller_share numeric(14,2);
  v_ratio numeric(14,8);
  v_seller_refund numeric(14,2);
  v_commission_refund numeric(14,2);
  v_delivery_refund numeric(14,2);
  v_pending numeric(14,2);
  v_available numeric(14,2);
  v_commission_balance numeric(14,2);
  v_delivery_balance numeric(14,2);
  v_reserved numeric(14,2);
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gambasket-refund-ledger',0));
  SELECT * INTO v_case FROM public.order_refund_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND OR v_case.status NOT IN ('approved','provider_pending') THEN
    RAISE EXCEPTION 'Refund must be approved by an administrator first';
  END IF;
  SELECT * INTO v_payment FROM public.gambasket_payments WHERE id=v_case.payment_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id=v_case.order_id FOR UPDATE;
  IF v_payment.status NOT IN ('succeeded','partially_refunded') OR v_payment.provider_reference IS NULL THEN
    RAISE EXCEPTION 'Completed provider transaction reference is missing';
  END IF;
  IF v_payment.succeeded_at IS NULL OR now()>v_payment.succeeded_at+interval '48 hours' THEN
    RAISE EXCEPTION 'MODEMPAY_REFUND_WINDOW_EXPIRED';
  END IF;
  SELECT COALESCE(SUM(requested_amount),0)::numeric(14,2) INTO v_reserved
  FROM public.order_refund_cases
  WHERE payment_id=v_payment.id AND id<>p_case_id
    AND status IN ('requested','under_review','approved','provider_pending','succeeded');
  IF v_reserved+v_case.requested_amount>v_payment.amount THEN RAISE EXCEPTION 'Refund exceeds remaining payment balance'; END IF;

  SELECT commission_rate INTO v_rate FROM public.gambasket_finance_settings WHERE id=1;
  v_rate:=COALESCE(v_rate,5.00);
  v_merchandise:=GREATEST(v_order.subtotal-v_order.discount_amount,0);
  v_commission:=round(v_merchandise*v_rate/100,2);
  v_seller_share:=v_merchandise-v_commission;
  v_ratio:=v_case.requested_amount/v_payment.amount;
  v_seller_refund:=round(v_seller_share*v_ratio,2);
  v_commission_refund:=round(v_commission*v_ratio,2);
  v_delivery_refund:=v_case.requested_amount-v_seller_refund-v_commission_refund;

  SELECT COALESCE(SUM(e.credit-e.debit) FILTER(WHERE e.account_code='seller_pending'),0)::numeric(14,2),
         COALESCE(SUM(e.credit-e.debit) FILTER(WHERE e.account_code='seller_available'),0)::numeric(14,2)
  INTO v_pending,v_available
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id=v_order.seller_id
    AND (e.account_code='seller_available' OR (e.account_code='seller_pending' AND e.order_id=v_order.id));
  SELECT COALESCE(SUM(e.credit-e.debit),0)::numeric(14,2) INTO v_commission_balance
  FROM public.seller_wallet_ledger_entries e WHERE e.account_code='platform_commission';
  SELECT COALESCE(SUM(e.credit-e.debit),0)::numeric(14,2) INTO v_delivery_balance
  FROM public.seller_wallet_ledger_entries e WHERE e.account_code='delivery_payable';
  IF v_pending+v_available<v_seller_refund OR v_commission_balance<v_commission_refund
     OR v_delivery_balance<v_delivery_refund THEN
    RAISE EXCEPTION 'REFUND_REQUIRES_MANUAL_FINANCIAL_REVIEW';
  END IF;
  RETURN jsonb_build_object('success',true,'provider_reference',v_payment.provider_reference,
    'amount',v_case.requested_amount,'currency','GMD','seller_refund',v_seller_refund,
    'commission_refund',v_commission_refund,'delivery_refund',v_delivery_refund);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_mark_refund_provider_pending(p_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_check jsonb;
BEGIN
  v_check:=public.gambasket_validate_refund_case(p_case_id);
  UPDATE public.order_refund_cases SET status='provider_pending',updated_at=now()
  WHERE id=p_case_id AND status='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund case was changed before provider processing'; END IF;
  RETURN v_check;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_mark_refund_failed(p_case_id uuid,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_case public.order_refund_cases%ROWTYPE;
BEGIN
  SELECT * INTO v_case FROM public.order_refund_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND OR v_case.status<>'provider_pending' THEN RAISE EXCEPTION 'Refund is not pending with provider'; END IF;
  UPDATE public.order_refund_cases SET status='failed',updated_at=now(),
    description=concat_ws(E'\n',description,left(COALESCE(p_error,'Provider refund failed'),500))
  WHERE id=p_case_id;
  RETURN jsonb_build_object('success',true,'refund_case_id',p_case_id,'status','failed');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gambasket_finalize_modempay_refund(p_case_id uuid,p_provider_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_case public.order_refund_cases%ROWTYPE;
  v_payment public.gambasket_payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_check jsonb;
  v_seller_refund numeric(14,2);
  v_commission_refund numeric(14,2);
  v_delivery_refund numeric(14,2);
  v_pending numeric(14,2);
  v_available numeric(14,2);
  v_pending_part numeric(14,2);
  v_available_part numeric(14,2);
  v_batch uuid;
  v_total numeric(14,2);
BEGIN
  SELECT * INTO v_case FROM public.order_refund_cases WHERE id=p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund case not found'; END IF;
  IF v_case.status='succeeded' THEN RETURN jsonb_build_object('success',true,'duplicate',true); END IF;
  IF v_case.status<>'provider_pending' THEN RAISE EXCEPTION 'Provider refund is not pending'; END IF;
  v_check:=public.gambasket_validate_refund_case(p_case_id);
  v_seller_refund:=(v_check->>'seller_refund')::numeric;
  v_commission_refund:=(v_check->>'commission_refund')::numeric;
  v_delivery_refund:=(v_check->>'delivery_refund')::numeric;
  SELECT * INTO v_payment FROM public.gambasket_payments WHERE id=v_case.payment_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id=v_case.order_id FOR UPDATE;

  SELECT COALESCE(SUM(e.credit-e.debit),0)::numeric(14,2) INTO v_pending
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id=v_case.seller_id AND e.account_code='seller_pending' AND e.order_id=v_order.id;
  SELECT COALESCE(SUM(e.credit-e.debit),0)::numeric(14,2) INTO v_available
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id=v_case.seller_id AND e.account_code='seller_available';
  v_pending_part:=LEAST(GREATEST(v_pending,0),v_seller_refund);
  v_available_part:=v_seller_refund-v_pending_part;
  IF v_available<v_available_part THEN RAISE EXCEPTION 'Seller funds have already been paid out; manual recovery is required'; END IF;

  INSERT INTO public.seller_wallet_ledger_batches(idempotency_key,source_type,source_id,description,created_by)
  VALUES('modempay-refund:'||v_case.id::text,'refund',v_case.id,
    'ModemPay confirmed refund for order '||v_order.order_number,NULL)
  ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_batch;
  IF v_batch IS NOT NULL THEN
    IF v_pending_part>0 THEN
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,order_id,payment_id)
      VALUES(v_batch,'seller_pending',v_case.seller_id,v_pending_part,'GMD',v_order.id,v_payment.id);
    END IF;
    IF v_available_part>0 THEN
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,account_owner_id,debit,currency,order_id,payment_id)
      VALUES(v_batch,'seller_available',v_case.seller_id,v_available_part,'GMD',v_order.id,v_payment.id);
    END IF;
    IF v_commission_refund>0 THEN
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,debit,currency,order_id,payment_id)
      VALUES(v_batch,'platform_commission',v_commission_refund,'GMD',v_order.id,v_payment.id);
    END IF;
    IF v_delivery_refund>0 THEN
      INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,debit,currency,order_id,payment_id)
      VALUES(v_batch,'delivery_payable',v_delivery_refund,'GMD',v_order.id,v_payment.id);
    END IF;
    INSERT INTO public.seller_wallet_ledger_entries(batch_id,account_code,credit,currency,order_id,payment_id)
    VALUES(v_batch,'gateway_clearing',v_case.requested_amount,'GMD',v_order.id,v_payment.id);
  END IF;

  INSERT INTO public.order_refund_events(refund_case_id,provider,provider_event_id,event_type,payload,processed_at)
  VALUES(v_case.id,'modempay','refund-case:'||v_case.id::text,'refund.succeeded',
    COALESCE(p_provider_payload,'{}'::jsonb),now())
  ON CONFLICT(provider,provider_event_id) DO NOTHING;
  UPDATE public.order_refund_cases SET status='succeeded',
    provider_reference=COALESCE(p_provider_payload->>'id',p_provider_payload->>'reference',provider_reference),
    resolved_at=now(),updated_at=now() WHERE id=v_case.id;
  SELECT COALESCE(SUM(requested_amount),0)::numeric(14,2) INTO v_total
  FROM public.order_refund_cases WHERE payment_id=v_payment.id AND status='succeeded';
  UPDATE public.gambasket_payments SET
    status=CASE WHEN v_total>=v_payment.amount THEN 'refunded' ELSE 'partially_refunded' END,
    provider_payload=jsonb_build_object('last_refund_case',v_case.id,'provider_result',COALESCE(p_provider_payload,'{}'::jsonb)),
    updated_at=now() WHERE id=v_payment.id;
  IF v_total>=v_payment.amount THEN
    UPDATE public.orders SET payment_status='refunded',updated_at=now() WHERE id=v_order.id;
  END IF;
  RETURN jsonb_build_object('success',true,'refund_case_id',v_case.id,'refunded_total',v_total);
END;
$fn$;

REVOKE ALL ON FUNCTION public.gambasket_guard_order_payment_method() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_prevent_unverified_delivery() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_prevent_unverified_order_completion() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_process_modempay_charge(text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_process_modempay_transfer_event(text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_queue_automatic_payouts() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_release_due_seller_funds() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_validate_refund_case(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_mark_refund_provider_pending(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_mark_refund_failed(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_finalize_modempay_refund(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gambasket_issue_delivery_otp(uuid,bytea) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.gambasket_confirm_delivery_with_otp(uuid,bytea) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.gambasket_request_order_refund(uuid,numeric,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_review_gambasket_refund_case(uuid,text) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.gambasket_process_modempay_charge(text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.gambasket_process_modempay_transfer_event(text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.gambasket_queue_automatic_payouts() TO service_role;
GRANT EXECUTE ON FUNCTION public.gambasket_release_due_seller_funds() TO service_role;
GRANT EXECUTE ON FUNCTION public.gambasket_validate_refund_case(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gambasket_mark_refund_provider_pending(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gambasket_mark_refund_failed(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gambasket_finalize_modempay_refund(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.gambasket_issue_delivery_otp(uuid,bytea) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gambasket_confirm_delivery_with_otp(uuid,bytea) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gambasket_request_order_refund(uuid,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_gambasket_refund_case(uuid,text) TO authenticated;

COMMIT;