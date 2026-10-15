-- Complete verification and dispute RPCs used by the frontend; limit admin queues to admins.
BEGIN;

-- These tables were previously policy-less, which denied the admin console too.
REVOKE ALL ON TABLE public.account_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.account_actions TO authenticated;
DROP POLICY IF EXISTS account_actions_owner_admin_read ON public.account_actions;
CREATE POLICY account_actions_owner_admin_read
  ON public.account_actions FOR SELECT TO authenticated
  USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());

REVOKE ALL ON TABLE public.marketplace_disputes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.marketplace_disputes TO authenticated;
DROP POLICY IF EXISTS marketplace_disputes_participant_admin_read ON public.marketplace_disputes;
CREATE POLICY marketplace_disputes_participant_admin_read
  ON public.marketplace_disputes FOR SELECT TO authenticated
  USING (opened_by=(SELECT auth.uid()) OR public.is_gambasket_admin());

-- Verification requests are private. Submissions are through the validated RPC only.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.verification_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.verification_requests TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS verification_one_pending_per_role_uidx
ON public.verification_requests(user_id, role_type)
WHERE status='pending';

CREATE OR REPLACE FUNCTION public.submit_verification_request(
  p_role_type character varying,
  p_business_name character varying,
  p_business_category character varying DEFAULT NULL,
  p_identity_document_url text DEFAULT NULL,
  p_business_document_url text DEFAULT NULL,
  p_additional_document_url text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_request public.verification_requests%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_role_type NOT IN ('seller','supplier') THEN
    RAISE EXCEPTION 'Only seller or supplier verification is available here';
  END IF;
  IF NULLIF(trim(p_business_name),'') IS NULL OR length(trim(p_business_name))>160 THEN
    RAISE EXCEPTION 'Business or seller name is required and must be under 160 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id=v_user AND ur.role_id=p_role_type AND COALESCE(ur.is_active,true)=true
  ) THEN
    RAISE EXCEPTION 'This role is already active on your account';
  END IF;

  SELECT * INTO v_request
  FROM public.verification_requests
  WHERE user_id=v_user AND role_type=p_role_type AND status='pending'
  ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN v_request; END IF;

  INSERT INTO public.verification_requests(
    user_id,role_type,business_name,business_category,identity_document_url,
    business_document_url,additional_document_url,notes,status
  )
  VALUES(
    v_user,p_role_type,trim(p_business_name),NULLIF(trim(p_business_category),''),
    NULLIF(trim(p_identity_document_url),''),NULLIF(trim(p_business_document_url),''),
    NULLIF(trim(p_additional_document_url),''),NULLIF(trim(p_notes),''),'pending'
  )
  RETURNING * INTO v_request;
  RETURN v_request;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.open_marketplace_dispute(
  p_order_id uuid,
  p_reason character varying,
  p_description text DEFAULT NULL,
  p_evidence text DEFAULT NULL
)
RETURNS public.marketplace_disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_dispute public.marketplace_disputes%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NULLIF(trim(p_reason),'') IS NULL OR length(trim(p_reason))>200 THEN
    RAISE EXCEPTION 'A dispute reason is required and must be under 200 characters';
  END IF;
  SELECT * INTO v_order
  FROM public.orders
  WHERE id=p_order_id AND (buyer_id=v_user OR seller_id=v_user)
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an order participant can open a dispute'; END IF;
  IF v_order.order_status='cancelled' THEN RAISE EXCEPTION 'A cancelled order cannot be disputed'; END IF;

  SELECT * INTO v_dispute
  FROM public.marketplace_disputes
  WHERE order_id=p_order_id AND opened_by=v_user AND status IN ('open','investigating')
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_dispute; END IF;

  IF EXISTS (
    SELECT 1 FROM public.marketplace_disputes
    WHERE order_id=p_order_id AND status IN ('open','investigating')
  ) THEN
    RAISE EXCEPTION 'This order already has an open dispute';
  END IF;

  INSERT INTO public.marketplace_disputes(order_id,opened_by,reason,description,evidence,status)
  VALUES(p_order_id,v_user,left(trim(p_reason),200),NULLIF(trim(p_description),''),
    NULLIF(trim(p_evidence),''),'open')
  RETURNING * INTO v_dispute;
  RETURN v_dispute;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_resolve_marketplace_dispute(
  p_dispute_id uuid,
  p_status character varying,
  p_resolution text DEFAULT NULL
)
RETURNS public.marketplace_disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_dispute public.marketplace_disputes%ROWTYPE;
BEGIN
  IF NOT public.is_gambasket_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_status NOT IN ('investigating','resolved','dismissed') THEN
    RAISE EXCEPTION 'Invalid dispute status';
  END IF;
  IF p_status IN ('resolved','dismissed') AND NULLIF(trim(p_resolution),'') IS NULL THEN
    RAISE EXCEPTION 'A resolution note is required';
  END IF;

  UPDATE public.marketplace_disputes
  SET status=p_status,
      assigned_to=CASE WHEN p_status='investigating' THEN auth.uid() ELSE assigned_to END,
      resolution=CASE WHEN p_status IN ('resolved','dismissed') THEN left(trim(p_resolution),5000) ELSE resolution END,
      resolved_at=CASE WHEN p_status IN ('resolved','dismissed') THEN now() ELSE NULL END,
      updated_at=now()
  WHERE id=p_dispute_id AND status IN ('open','investigating')
  RETURNING * INTO v_dispute;

  IF v_dispute.id IS NULL THEN RAISE EXCEPTION 'Dispute not found or already closed'; END IF;

  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'dispute_'||p_status,'marketplace_dispute',v_dispute.id,
    jsonb_build_object('order_id',v_dispute.order_id,'reason',v_dispute.reason,'resolution',p_resolution));
  RETURN v_dispute;
END;
$fn$;

REVOKE ALL ON FUNCTION public.submit_verification_request(character varying,character varying,character varying,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_marketplace_dispute(uuid,character varying,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_resolve_marketplace_dispute(uuid,character varying,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_verification_request(character varying,character varying,character varying,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_marketplace_dispute(uuid,character varying,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_marketplace_dispute(uuid,character varying,text) TO authenticated;

COMMIT;
