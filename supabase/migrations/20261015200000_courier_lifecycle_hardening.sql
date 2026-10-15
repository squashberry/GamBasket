-- GamBasket courier lifecycle hardening: trusted delivery-profile mutations and correct order history.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_delivery_job(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_request public.delivery_requests%ROWTYPE;
  v_buyer uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(v_user,'delivery_worker'::character varying) THEN
    RAISE EXCEPTION 'Delivery-worker role required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_profiles dp
    WHERE dp.user_id=v_user AND dp.is_verified=true AND dp.status='available'
  ) THEN RAISE EXCEPTION 'A verified, available courier profile is required'; END IF;

  SELECT * INTO v_request FROM public.delivery_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery request not found'; END IF;
  IF v_request.status<>'pending' OR v_request.assigned_worker_id IS NOT NULL THEN
    RAISE EXCEPTION 'Delivery request is no longer available';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=v_request.order_id AND o.order_status='ready_for_delivery') THEN
    RAISE EXCEPTION 'The seller has not marked this order ready for delivery';
  END IF;

  PERFORM set_config('app.gambasket_internal','on',true);
  UPDATE public.delivery_requests
  SET status='assigned',assigned_worker_id=v_user,assigned_at=now(),updated_at=now()
  WHERE id=p_request_id RETURNING * INTO v_request;
  UPDATE public.orders SET order_status='delivery_assigned',updated_at=now() WHERE id=v_request.order_id;
  UPDATE public.delivery_profiles SET status='delivering',updated_at=now() WHERE user_id=v_user;

  INSERT INTO public.delivery_status_history(delivery_request_id,status,updated_by,notes)
  VALUES(p_request_id,'assigned',v_user,'Claimed by the assigned delivery worker');

  SELECT buyer_id INTO v_buyer FROM public.orders WHERE id=v_request.order_id;
  IF v_buyer IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,type,title,message,data)
    VALUES(v_buyer,'delivery','Delivery driver assigned',
      'A verified delivery driver has accepted your order.',
      jsonb_build_object('order_id',v_request.order_id,'delivery_request_id',p_request_id));
  END IF;
  RETURN jsonb_build_object('success',true,'message','Delivery job assigned successfully','order_id',v_request.order_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.update_delivery_job_status(p_request_id uuid,p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_request public.delivery_requests%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_order_status_before text;
  v_delivery_status_before text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_request FROM public.delivery_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery request not found'; END IF;
  IF v_request.assigned_worker_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Only the assigned courier may update this delivery';
  END IF;

  v_delivery_status_before:=v_request.status;
  IF NOT ((v_delivery_status_before='assigned' AND p_status='picked_up')
      OR (v_delivery_status_before='picked_up' AND p_status='out_for_delivery')
      OR (v_delivery_status_before='out_for_delivery' AND p_status='delivered')) THEN
    RAISE EXCEPTION 'Invalid delivery status transition: % -> %',v_delivery_status_before,p_status;
  END IF;

  SELECT order_status INTO v_order_status_before FROM public.orders WHERE id=v_request.order_id FOR UPDATE;
  IF v_order_status_before IS NULL THEN RAISE EXCEPTION 'Order not found for delivery request'; END IF;

  PERFORM set_config('app.gambasket_internal','on',true);
  UPDATE public.delivery_requests
  SET status=p_status,
      picked_up_at=CASE WHEN p_status='picked_up' THEN now() ELSE picked_up_at END,
      out_for_delivery_at=CASE WHEN p_status='out_for_delivery' THEN now() ELSE out_for_delivery_at END,
      delivered_at=CASE WHEN p_status='delivered' THEN now() ELSE delivered_at END,
      updated_at=now()
  WHERE id=p_request_id RETURNING * INTO v_request;

  UPDATE public.orders SET order_status=p_status,updated_at=now()
  WHERE id=v_request.order_id RETURNING * INTO v_order;

  INSERT INTO public.delivery_status_history(delivery_request_id,status,updated_by,notes)
  VALUES(p_request_id,p_status,v_user,'Updated by the assigned delivery worker');

  INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,notes)
  VALUES(v_request.order_id,v_order_status_before,v_order.order_status,v_user,'Delivery status updated by assigned courier');

  IF p_status='delivered' THEN
    INSERT INTO public.earning_transactions(user_id,role_name,action_type,reference_id,amount,currency,status,description)
    SELECT v_user,'delivery_worker','delivery_completed',p_request_id::text,
      GREATEST(COALESCE(v_request.estimated_fee,0),0),'GMD','available',
      'Completed delivery '||COALESCE(v_order.order_number,p_request_id::text)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.earning_transactions et
      WHERE et.user_id=v_user AND et.role_name='delivery_worker'
        AND et.action_type='delivery_completed' AND et.reference_id=p_request_id::text
    );

    UPDATE public.delivery_profiles
    SET status='available',
        total_completed_deliveries=COALESCE(total_completed_deliveries,0)+1,
        updated_at=now()
    WHERE user_id=v_user;

    IF v_order.buyer_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id,type,title,message,data)
      VALUES(v_order.buyer_id,'delivery','Order delivered',
        'Your GamBasket order has been marked as delivered.',
        jsonb_build_object('order_id',v_order.id,'delivery_request_id',p_request_id));
    END IF;
  END IF;
  RETURN jsonb_build_object('success',true,'status',p_status,'request_id',p_request_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_delivery_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_delivery_job(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.update_delivery_job_status(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_delivery_job_status(uuid,text) TO authenticated;

COMMIT;
