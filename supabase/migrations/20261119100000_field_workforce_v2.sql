-- Field workforce v2: worker applications, Courier Workspace and Operations Center.
--
-- Everything the three new front ends need is exposed as SECURITY DEFINER functions with an empty
-- search_path that authorise the caller themselves. New tables are readable by their owners/ops only
-- and are written exclusively through these functions. Existing RPCs (claim_delivery_job,
-- update_delivery_job_status, moderate_product_listing, resolve_marketplace_report) are reused untouched.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Shared helpers and settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jd_is_ops()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$ SELECT auth.uid() IS NOT NULL AND (public.is_gambasket_admin() OR public.has_role(auth.uid(),'marketplace_worker'::character varying)) $fn$;

CREATE OR REPLACE FUNCTION public.jd_is_courier()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$ SELECT auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'delivery_worker'::character varying) $fn$;

CREATE TABLE IF NOT EXISTS public.workforce_settings (
  key text PRIMARY KEY,
  value numeric NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.workforce_settings(key,value,description) VALUES
  ('min_payout',100,'Smallest courier / operations payout request, in GMD'),
  ('claim_lock_minutes',20,'How long an operations reviewer holds a queue item'),
  ('stale_hours',24,'Queue items older than this count as overdue')
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.workforce_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workforce_settings_read ON public.workforce_settings;
CREATE POLICY workforce_settings_read ON public.workforce_settings FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.workforce_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workforce_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.jd_setting(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$ SELECT COALESCE((SELECT value FROM public.workforce_settings WHERE key=p_key),p_default) $fn$;

-- ---------------------------------------------------------------------------
-- 1. Applications
-- ---------------------------------------------------------------------------
ALTER TABLE public.worker_applications
  ADD COLUMN IF NOT EXISTS identity_document_path text,
  ADD COLUMN IF NOT EXISTS selfie_path text,
  ADD COLUMN IF NOT EXISTS plate_number varchar(30),
  ADD COLUMN IF NOT EXISTS emergency_contact_name varchar(150),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone varchar(50),
  ADD COLUMN IF NOT EXISTS availability jsonb,
  ADD COLUMN IF NOT EXISTS languages text[],
  ADD COLUMN IF NOT EXISTS weekly_hours integer,
  ADD COLUMN IF NOT EXISTS reference_code varchar(16),
  ADD COLUMN IF NOT EXISTS info_request text,
  ADD COLUMN IF NOT EXISTS applicant_response text;

UPDATE public.worker_applications SET reference_code='JD-'||upper(substr(md5(id::text),1,8)) WHERE reference_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS worker_applications_reference_code_uidx ON public.worker_applications(reference_code);

ALTER TABLE public.worker_applications DROP CONSTRAINT IF EXISTS worker_applications_status_check;
ALTER TABLE public.worker_applications ADD CONSTRAINT worker_applications_status_check
  CHECK (status IN ('pending','needs_info','approved','rejected','suspended','withdrawn'));

CREATE TABLE IF NOT EXISTS public.worker_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.worker_applications(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event varchar(30) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_application_events_app_idx ON public.worker_application_events(application_id, created_at);
ALTER TABLE public.worker_application_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_application_events_read ON public.worker_application_events;
CREATE POLICY worker_application_events_read ON public.worker_application_events FOR SELECT TO authenticated
USING (public.jd_is_ops() OR EXISTS (SELECT 1 FROM public.worker_applications a WHERE a.id=application_id AND a.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.worker_application_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.worker_application_events TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_worker_application(
  p_worker_type text,
  p_full_name text,
  p_phone text,
  p_location text,
  p_areas text[] DEFAULT NULL,
  p_vehicle_type text DEFAULT NULL,
  p_plate text DEFAULT NULL,
  p_experience text DEFAULT NULL,
  p_identity_path text DEFAULT NULL,
  p_selfie_path text DEFAULT NULL,
  p_emergency_name text DEFAULT NULL,
  p_emergency_phone text DEFAULT NULL,
  p_availability jsonb DEFAULT NULL,
  p_languages text[] DEFAULT NULL,
  p_weekly_hours integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_prefix text;
  v_vehicle text;
  a public.worker_applications%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in before applying'; END IF;
  IF p_worker_type NOT IN ('delivery_worker','marketplace_worker') THEN RAISE EXCEPTION 'Choose a courier or operations role'; END IF;
  IF public.has_role(v_user,p_worker_type::character varying) THEN RAISE EXCEPTION 'You already hold this role'; END IF;
  IF length(trim(COALESCE(p_full_name,''))) NOT BETWEEN 3 AND 150 THEN RAISE EXCEPTION 'Enter your full name'; END IF;
  IF COALESCE(p_phone,'') !~ '^\+?[0-9][0-9 ()-]{6,19}$' THEN RAISE EXCEPTION 'Enter a valid phone number'; END IF;
  IF length(trim(COALESCE(p_location,''))) = 0 THEN RAISE EXCEPTION 'Choose your area'; END IF;
  IF length(trim(COALESCE(p_emergency_name,''))) < 2 OR COALESCE(p_emergency_phone,'') !~ '^\+?[0-9][0-9 ()-]{6,19}$' THEN
    RAISE EXCEPTION 'Add an emergency contact with a valid phone number';
  END IF;
  v_prefix := v_user::text || '/';
  IF p_identity_path IS NULL OR left(p_identity_path,length(v_prefix)) <> v_prefix THEN RAISE EXCEPTION 'Upload your identity document first'; END IF;
  IF p_selfie_path IS NOT NULL AND left(p_selfie_path,length(v_prefix)) <> v_prefix THEN RAISE EXCEPTION 'Selfie must be in your own private folder'; END IF;
  IF EXISTS (SELECT 1 FROM public.worker_applications w WHERE w.user_id=v_user AND w.worker_type=p_worker_type AND w.status IN ('pending','needs_info')) THEN
    RAISE EXCEPTION 'You already have an open application for this role';
  END IF;

  IF p_worker_type = 'delivery_worker' THEN
    v_vehicle := CASE lower(COALESCE(p_vehicle_type,''))
      WHEN 'motorcycle' THEN 'Motorcycle' WHEN 'car' THEN 'Car' WHEN 'van' THEN 'Van' WHEN 'bicycle' THEN 'Bicycle' WHEN 'other' THEN 'Other' ELSE NULL END;
    IF v_vehicle IS NULL THEN RAISE EXCEPTION 'Choose your vehicle'; END IF;
    IF COALESCE(array_length(p_areas,1),0) = 0 THEN RAISE EXCEPTION 'Choose at least one delivery area'; END IF;
    IF p_selfie_path IS NULL THEN RAISE EXCEPTION 'A selfie is required for couriers'; END IF;
  ELSE
    IF COALESCE(p_weekly_hours,0) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Enter the hours per week you can work (1 to 60)'; END IF;
  END IF;

  PERFORM set_config('app.gambasket_internal','on',true);
  INSERT INTO public.worker_applications(
    user_id,worker_type,full_name,phone,location,delivery_areas,vehicle_type,plate_number,experience_notes,
    identity_document_path,selfie_path,emergency_contact_name,emergency_contact_phone,availability,languages,weekly_hours,
    reference_code,status)
  VALUES(
    v_user,p_worker_type,trim(p_full_name),trim(p_phone),trim(p_location),
    CASE WHEN p_worker_type='delivery_worker' THEN p_areas ELSE NULL END, v_vehicle,
    NULLIF(upper(trim(COALESCE(p_plate,''))),''), NULLIF(left(trim(COALESCE(p_experience,'')),2000),''),
    p_identity_path,p_selfie_path,trim(p_emergency_name),trim(p_emergency_phone),p_availability,p_languages,p_weekly_hours,
    'JD-'||upper(substr(md5(gen_random_uuid()::text),1,8)),'pending')
  RETURNING * INTO a;

  INSERT INTO public.worker_application_events(application_id,actor_id,event,note) VALUES(a.id,v_user,'submitted',NULL);
  INSERT INTO public.notifications(user_id,type,title,message,data)
  VALUES(v_user,'system','Application received','Reference '||a.reference_code||'. We will review it and update you here.',
    jsonb_build_object('application_id',a.id));
  RETURN jsonb_build_object('success',true,'id',a.id,'reference_code',a.reference_code,'status',a.status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.my_worker_applications()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to see your applications'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'reference_code',a.reference_code,'worker_type',a.worker_type,'status',a.status,'full_name',a.full_name,
      'location',a.location,'info_request',a.info_request,'review_notes',CASE WHEN a.status IN ('rejected','approved') THEN a.review_notes END,
      'created_at',a.created_at,'updated_at',a.updated_at,
      'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('event',e.event,'note',e.note,'created_at',e.created_at) ORDER BY e.created_at)
                         FROM public.worker_application_events e WHERE e.application_id=a.id),'[]'::jsonb)
    ) ORDER BY a.created_at DESC)
    FROM public.worker_applications a WHERE a.user_id=v_user),'[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.respond_to_application_info(p_application_id uuid, p_response text, p_new_identity_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid(); a public.worker_applications%ROWTYPE; v_prefix text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF length(trim(COALESCE(p_response,''))) < 2 THEN RAISE EXCEPTION 'Write a short reply'; END IF;
  v_prefix := v_user::text || '/';
  IF p_new_identity_path IS NOT NULL AND left(p_new_identity_path,length(v_prefix)) <> v_prefix THEN RAISE EXCEPTION 'Document must be in your own private folder'; END IF;
  PERFORM set_config('app.gambasket_internal','on',true);
  UPDATE public.worker_applications
  SET status='pending', applicant_response=left(trim(p_response),2000),
      identity_document_path=COALESCE(p_new_identity_path,identity_document_path), updated_at=now()
  WHERE id=p_application_id AND user_id=v_user AND status='needs_info' RETURNING * INTO a;
  IF a.id IS NULL THEN RAISE EXCEPTION 'This application is not waiting for your reply'; END IF;
  INSERT INTO public.worker_application_events(application_id,actor_id,event,note) VALUES(a.id,v_user,'applicant_replied',left(trim(p_response),500));
  RETURN jsonb_build_object('success',true,'status',a.status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.withdraw_worker_application(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid(); a public.worker_applications%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  PERFORM set_config('app.gambasket_internal','on',true);
  UPDATE public.worker_applications SET status='withdrawn', updated_at=now()
  WHERE id=p_application_id AND user_id=v_user AND status IN ('pending','needs_info') RETURNING * INTO a;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Only an open application can be withdrawn'; END IF;
  INSERT INTO public.worker_application_events(application_id,actor_id,event) VALUES(a.id,v_user,'withdrawn');
  RETURN jsonb_build_object('success',true);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Courier workspace
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_profiles
  ADD COLUMN IF NOT EXISTS last_lat double precision,
  ADD COLUMN IF NOT EXISTS last_lng double precision,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS online_since timestamptz,
  ADD COLUMN IF NOT EXISTS plate_number varchar(30);

CREATE TABLE IF NOT EXISTS public.courier_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  deliveries integer NOT NULL DEFAULT 0,
  earned numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS courier_shifts_courier_idx ON public.courier_shifts(courier_id, started_at DESC);
ALTER TABLE public.courier_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courier_shifts_read ON public.courier_shifts;
CREATE POLICY courier_shifts_read ON public.courier_shifts FOR SELECT TO authenticated USING (courier_id=(SELECT auth.uid()) OR public.jd_is_ops());
REVOKE ALL ON public.courier_shifts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.courier_shifts TO authenticated;

CREATE TABLE IF NOT EXISTS public.delivery_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_request_id uuid NOT NULL REFERENCES public.delivery_requests(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  courier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind varchar(40) NOT NULL CHECK (kind IN ('customer_unreachable','wrong_address','seller_not_ready','item_problem','vehicle_problem','safety','other')),
  note text,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_issues_open_idx ON public.delivery_issues(status, created_at);
CREATE INDEX IF NOT EXISTS delivery_issues_request_idx ON public.delivery_issues(delivery_request_id);
ALTER TABLE public.delivery_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_issues_read ON public.delivery_issues;
CREATE POLICY delivery_issues_read ON public.delivery_issues FOR SELECT TO authenticated USING (courier_id=(SELECT auth.uid()) OR public.jd_is_ops());
REVOKE ALL ON public.delivery_issues FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_issues TO authenticated;

CREATE OR REPLACE FUNCTION public.courier_set_availability(p_online boolean, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  dp public.delivery_profiles%ROWTYPE;
  v_shift public.courier_shifts%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.jd_is_courier() THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
  SELECT * INTO dp FROM public.delivery_profiles WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Courier profile not found'; END IF;
  IF dp.status='suspended' THEN RAISE EXCEPTION 'Your courier account is suspended'; END IF;
  IF NOT dp.is_verified THEN RAISE EXCEPTION 'Your courier account is not verified yet'; END IF;

  IF p_online THEN
    IF dp.status='offline' THEN
      UPDATE public.delivery_profiles SET status='available', online_since=now(), last_lat=COALESCE(p_lat,last_lat), last_lng=COALESCE(p_lng,last_lng),
        last_seen_at=now(), updated_at=now() WHERE user_id=v_user;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.courier_shifts WHERE courier_id=v_user AND ended_at IS NULL) THEN
      INSERT INTO public.courier_shifts(courier_id) VALUES(v_user);
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.delivery_requests WHERE assigned_worker_id=v_user AND status IN ('assigned','picked_up','out_for_delivery')) THEN
      RAISE EXCEPTION 'Finish your active delivery before going offline';
    END IF;
    UPDATE public.delivery_profiles SET status='offline', online_since=NULL, updated_at=now() WHERE user_id=v_user;
    FOR v_shift IN SELECT * FROM public.courier_shifts WHERE courier_id=v_user AND ended_at IS NULL LOOP
      UPDATE public.courier_shifts s SET ended_at=now(),
        deliveries=(SELECT count(*) FROM public.delivery_requests d WHERE d.assigned_worker_id=v_user AND d.status='delivered' AND d.delivered_at>=v_shift.started_at),
        earned=(SELECT COALESCE(sum(e.amount),0) FROM public.earning_transactions e WHERE e.user_id=v_user AND e.role_name='delivery_worker'
                AND e.action_type='delivery_completed' AND e.status<>'cancelled' AND e.created_at>=v_shift.started_at)
      WHERE s.id=v_shift.id;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('success',true,'online',p_online);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.courier_ping(p_lat double precision, p_lng double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF NOT public.jd_is_courier() THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid location'; END IF;
  UPDATE public.delivery_profiles SET last_lat=p_lat,last_lng=p_lng,last_seen_at=now() WHERE user_id=auth.uid();
END;
$fn$;

CREATE OR REPLACE FUNCTION public.courier_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  dp public.delivery_profiles%ROWTYPE;
  d_today int; d_week int; d_month int; d_all int;
  e_today numeric; e_week numeric; e_month numeric; e_all numeric;
  v_active uuid; v_issues int; v_avg_min numeric;
BEGIN
  IF NOT public.jd_is_courier() THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
  SELECT * INTO dp FROM public.delivery_profiles WHERE user_id=v_user;
  SELECT count(*) FILTER (WHERE delivered_at>=date_trunc('day',now())),
         count(*) FILTER (WHERE delivered_at>=now()-interval '7 days'),
         count(*) FILTER (WHERE delivered_at>=date_trunc('month',now())), count(*),
         avg(extract(epoch FROM delivered_at-assigned_at)/60.0) FILTER (WHERE delivered_at>=now()-interval '30 days' AND assigned_at IS NOT NULL)
  INTO d_today,d_week,d_month,d_all,v_avg_min
  FROM public.delivery_requests WHERE assigned_worker_id=v_user AND status='delivered';
  SELECT COALESCE(sum(amount) FILTER (WHERE created_at>=date_trunc('day',now())),0),
         COALESCE(sum(amount) FILTER (WHERE created_at>=now()-interval '7 days'),0),
         COALESCE(sum(amount) FILTER (WHERE created_at>=date_trunc('month',now())),0), COALESCE(sum(amount),0)
  INTO e_today,e_week,e_month,e_all
  FROM public.earning_transactions WHERE user_id=v_user AND role_name='delivery_worker' AND action_type='delivery_completed' AND status<>'cancelled';
  SELECT id INTO v_active FROM public.delivery_requests WHERE assigned_worker_id=v_user AND status IN ('assigned','picked_up','out_for_delivery') ORDER BY assigned_at DESC LIMIT 1;
  SELECT count(*) INTO v_issues FROM public.delivery_issues WHERE courier_id=v_user AND status='open';
  RETURN jsonb_build_object(
    'profile',jsonb_build_object('status',dp.status,'verified',dp.is_verified,'rating',dp.rating,'vehicle',dp.vehicle_type,'plate',dp.plate_number,
      'areas',COALESCE(to_jsonb(dp.delivery_areas),'[]'::jsonb),'phone',dp.phone,'completed',dp.total_completed_deliveries,'online_since',dp.online_since),
    'today',jsonb_build_object('deliveries',d_today,'earned',e_today),
    'week',jsonb_build_object('deliveries',d_week,'earned',e_week),
    'month',jsonb_build_object('deliveries',d_month,'earned',e_month),
    'lifetime',jsonb_build_object('deliveries',d_all,'earned',e_all),
    'avg_minutes',round(COALESCE(v_avg_min,0)),
    'active_request_id',v_active,'open_issues',v_issues);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.courier_job_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid(); dp public.delivery_profiles%ROWTYPE; v_jobs jsonb;
BEGIN
  IF NOT public.jd_is_courier() THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
  SELECT * INTO dp FROM public.delivery_profiles WHERE user_id=v_user;
  IF NOT FOUND OR NOT dp.is_verified OR dp.status<>'available' THEN
    RETURN jsonb_build_object('online',false,'jobs','[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',dr.id,'order_number',o.order_number,'pickup_location',dr.pickup_location,'delivery_destination',dr.delivery_destination,
    'delivery_area',dr.delivery_area,'fee',dr.estimated_fee,'created_at',dr.created_at,
    'waiting_minutes',round(extract(epoch FROM now()-dr.created_at)/60.0),
    'pickup_lat',dr.pickup_lat,'pickup_lng',dr.pickup_lng,'dropoff_lat',dr.dropoff_lat,'dropoff_lng',dr.dropoff_lng,
    'items',COALESCE((SELECT sum(oi.quantity) FROM public.order_items oi WHERE oi.order_id=o.id),0),
    'payment_method',o.payment_method,'order_total',o.total,
    'in_my_area',COALESCE(dr.delivery_area IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(dp.delivery_areas) a WHERE lower(a)=lower(dr.delivery_area)),false)
  ) ORDER BY dr.created_at ASC),'[]'::jsonb) INTO v_jobs
  FROM public.delivery_requests dr JOIN public.orders o ON o.id=dr.order_id
  WHERE dr.status='pending' AND dr.assigned_worker_id IS NULL AND o.order_status='ready_for_delivery';
  RETURN jsonb_build_object('online',true,'jobs',v_jobs);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.courier_active_job()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid(); dr public.delivery_requests%ROWTYPE; o public.orders%ROWTYPE; v_buyer text; v_store text; v_seller_phone text;
BEGIN
  IF NOT public.jd_is_courier() THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
  SELECT * INTO dr FROM public.delivery_requests WHERE assigned_worker_id=v_user AND status IN ('assigned','picked_up','out_for_delivery') ORDER BY assigned_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.orders WHERE id=dr.order_id;
  SELECT first_name INTO v_buyer FROM public.profiles WHERE id=o.buyer_id;
  SELECT s.name INTO v_store FROM public.stores s WHERE s.seller_id=o.seller_id LIMIT 1;
  SELECT phone INTO v_seller_phone FROM public.profiles WHERE id=o.seller_id;
  RETURN jsonb_build_object(
    'id',dr.id,'order_id',o.id,'order_number',o.order_number,'status',dr.status,'fee',dr.estimated_fee,
    'pickup_location',dr.pickup_location,'delivery_destination',dr.delivery_destination,'delivery_area',dr.delivery_area,
    'pickup_lat',dr.pickup_lat,'pickup_lng',dr.pickup_lng,'dropoff_lat',dr.dropoff_lat,'dropoff_lng',dr.dropoff_lng,
    'assigned_at',dr.assigned_at,'picked_up_at',dr.picked_up_at,'out_for_delivery_at',dr.out_for_delivery_at,
    'customer',jsonb_build_object('first_name',v_buyer,'phone',o.delivery_phone,'instructions',o.delivery_instructions),
    'seller',jsonb_build_object('store',v_store,'phone',v_seller_phone),
    'payment_method',o.payment_method,'payment_status',o.payment_status,'order_total',o.total,
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('title',oi.title,'quantity',oi.quantity) ORDER BY oi.title) FROM public.order_items oi WHERE oi.order_id=o.id),'[]'::jsonb),
    'timeline',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',h.status,'created_at',h.created_at) ORDER BY h.created_at) FROM public.delivery_status_history h WHERE h.delivery_request_id=dr.id),'[]'::jsonb),
    'issues',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'kind',i.kind,'status',i.status,'resolution',i.resolution,'created_at',i.created_at) ORDER BY i.created_at DESC) FROM public.delivery_issues i WHERE i.delivery_request_id=dr.id),'[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.courier_report_issue(p_request_id uuid, p_kind text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid(); dr public.delivery_requests%ROWTYPE; v_id uuid;
BEGIN
  IF NOT public.jd_is_courier() THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
  IF p_kind NOT IN ('customer_unreachable','wrong_address','seller_not_ready','item_problem','vehicle_problem','safety','other') THEN RAISE EXCEPTION 'Choose what went wrong'; END IF;
  IF p_kind='other' AND length(trim(COALESCE(p_note,''))) < 3 THEN RAISE EXCEPTION 'Describe the problem'; END IF;
  SELECT * INTO dr FROM public.delivery_requests WHERE id=p_request_id AND assigned_worker_id=v_user AND status IN ('assigned','picked_up','out_for_delivery');
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only report a problem on your active delivery'; END IF;
  IF (SELECT count(*) FROM public.delivery_issues WHERE delivery_request_id=p_request_id AND status='open') >= 3 THEN RAISE EXCEPTION 'Operations already has open reports for this delivery'; END IF;
  INSERT INTO public.delivery_issues(delivery_request_id,order_id,courier_id,kind,note) VALUES(dr.id,dr.order_id,v_user,p_kind,NULLIF(left(trim(COALESCE(p_note,'')),1000),'')) RETURNING id INTO v_id;
  INSERT INTO public.activity_logs(actor_id,action,target_type,target_id,metadata)
  VALUES(v_user,'delivery_issue_reported','delivery_issue',v_id::text,jsonb_build_object('kind',p_kind,'delivery_request_id',dr.id));
  RETURN jsonb_build_object('success',true,'id',v_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.courier_history(p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF NOT public.jd_is_courier() THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.delivered_at DESC) FROM (
    SELECT dr.id,o.order_number,dr.delivery_area,dr.delivery_destination,dr.estimated_fee AS fee,dr.assigned_at,dr.delivered_at,
           round(extract(epoch FROM dr.delivered_at-dr.assigned_at)/60.0) AS minutes
    FROM public.delivery_requests dr JOIN public.orders o ON o.id=dr.order_id
    WHERE dr.assigned_worker_id=auth.uid() AND dr.status='delivered'
    ORDER BY dr.delivered_at DESC LIMIT LEAST(GREATEST(p_limit,1),100) OFFSET GREATEST(p_offset,0)) t),'[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.courier_earnings_series(p_days integer DEFAULT 14)
RETURNS TABLE(day date, deliveries bigint, earned numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE n integer := LEAST(GREATEST(COALESCE(p_days,14),1),90);
BEGIN
  IF NOT public.jd_is_courier() THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
  RETURN QUERY
  SELECT g::date, count(e.id), COALESCE(sum(e.amount),0)::numeric
  FROM generate_series(current_date-(n-1),current_date,interval '1 day') g
  LEFT JOIN public.earning_transactions e ON e.user_id=auth.uid() AND e.role_name='delivery_worker' AND e.action_type='delivery_completed'
       AND e.status<>'cancelled' AND e.created_at::date=g::date
  GROUP BY g ORDER BY g;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Wallet and payouts (couriers and operations workers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jd_worker_available(p_user uuid, p_role text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT GREATEST(
    COALESCE((SELECT sum(amount) FROM public.earning_transactions WHERE user_id=p_user AND role_name=p_role AND status='available'),0)
    -- Completed requests remain paid out even though the legacy earnings ledger is immutable.
    - COALESCE((SELECT sum(amount) FROM public.payout_requests WHERE user_id=p_user AND role_name=p_role AND status IN ('pending','approved','processing','completed')),0), 0)
$fn$;

CREATE OR REPLACE FUNCTION public.worker_wallet(p_role text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR p_role NOT IN ('delivery_worker','marketplace_worker') OR NOT public.has_role(v_user,p_role::character varying) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN jsonb_build_object(
    'available',public.jd_worker_available(v_user,p_role),
    'pending_payout',COALESCE((SELECT sum(amount) FROM public.payout_requests WHERE user_id=v_user AND role_name=p_role AND status IN ('pending','approved','processing')),0),
    -- This schema records disbursement state on payout_requests.status='completed'.
    'paid_out',COALESCE((SELECT sum(amount) FROM public.payout_requests WHERE user_id=v_user AND role_name=p_role AND status='completed'),0),
    'lifetime',COALESCE((SELECT sum(amount) FROM public.earning_transactions WHERE user_id=v_user AND role_name=p_role AND status<>'cancelled'),0),
    'min_payout',public.jd_setting('min_payout',100),
    'recent',COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC) FROM (
      SELECT id,action_type,amount,status,description,created_at FROM public.earning_transactions
      WHERE user_id=v_user AND role_name=p_role ORDER BY created_at DESC LIMIT 60) t),'[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.worker_payouts(p_role text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR p_role NOT IN ('delivery_worker','marketplace_worker') OR NOT public.has_role(v_user,p_role::character varying) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC) FROM (
    SELECT id,amount,payment_method,status,admin_notes,created_at FROM public.payout_requests
    WHERE user_id=v_user AND role_name=p_role ORDER BY created_at DESC LIMIT 30) t),'[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.worker_request_payout(p_role text, p_amount numeric, p_method text, p_account text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid(); v_available numeric; v_min numeric; v_id uuid;
BEGIN
  IF v_user IS NULL OR p_role NOT IN ('delivery_worker','marketplace_worker') OR NOT public.has_role(v_user,p_role::character varying) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_method NOT IN ('wave','qmoney','afrimoney','bank_transfer','cash') THEN RAISE EXCEPTION 'Choose a payout method'; END IF;
  IF length(trim(COALESCE(p_account,''))) < 5 OR length(p_account) > 100 THEN RAISE EXCEPTION 'Enter the number or account to pay'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payout:'||v_user::text));
  v_min := public.jd_setting('min_payout',100);
  v_available := public.jd_worker_available(v_user,p_role);
  IF p_amount IS NULL OR p_amount < v_min THEN RAISE EXCEPTION 'The smallest payout is D %',v_min; END IF;
  IF p_amount > v_available THEN RAISE EXCEPTION 'You only have D % available',v_available; END IF;
  INSERT INTO public.payout_requests(user_id,role_name,amount,payment_method,phone_or_account,status)
  VALUES(v_user,p_role,round(p_amount,2),p_method,trim(p_account),'pending') RETURNING id INTO v_id;
  INSERT INTO public.activity_logs(actor_id,action,target_type,target_id,metadata)
  VALUES(v_user,'payout_requested','payout_request',v_id::text,jsonb_build_object('role',p_role,'amount',p_amount,'method',p_method));
  RETURN jsonb_build_object('success',true,'id',v_id,'available',public.jd_worker_available(v_user,p_role));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Operations center
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ops_case_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type varchar(20) NOT NULL CHECK (subject_type IN ('product','application','report','issue')),
  subject_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_case_notes_subject_idx ON public.ops_case_notes(subject_type, subject_id, created_at);

CREATE TABLE IF NOT EXISTS public.ops_item_claims (
  subject_type varchar(20) NOT NULL CHECK (subject_type IN ('product','application','report','issue')),
  subject_id uuid NOT NULL,
  worker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS public.ops_decision_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(30) NOT NULL CHECK (kind IN ('product_reject','application_reject','application_info','report_resolve','report_dismiss','issue_resolve')),
  label varchar(80) NOT NULL,
  body text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (kind, label)
);
INSERT INTO public.ops_decision_templates(kind,label,body,sort) VALUES
 ('product_reject','Poor or missing photos','Please add clear, well-lit photos of the actual item from several angles. Listings without them cannot be published.',1),
 ('product_reject','Misleading title or description','The title or description does not match the item. Please describe exactly what you are selling, including its condition.',2),
 ('product_reject','Prohibited item','This item is not allowed on JulaDirect. Please read the seller rules before listing again.',3),
 ('product_reject','Price looks wrong','The price looks like a mistake or does not match similar listings. Please correct it and resubmit.',4),
 ('product_reject','Contact details in listing','Please remove phone numbers or links from the title, description and photos. Buyers contact you through JulaDirect messages.',5),
 ('application_reject','Documents not readable','We could not read your identity document. You are welcome to apply again with a clear, uncropped photo.',1),
 ('application_reject','Does not meet requirements','We are unable to accept your application at this time. You are welcome to apply again when the requirements are met.',2),
 ('application_info','Need a clearer ID photo','Please send a clearer photo of your ID with all four corners visible and no glare.',1),
 ('application_info','Need a selfie holding your ID','Please send a selfie in which your face and your ID are both clearly visible.',2),
 ('application_info','Confirm your area and vehicle','Please confirm the areas you can cover and the vehicle you will use.',3),
 ('report_resolve','Listing removed','The reported listing was reviewed and removed. Thank you for helping keep JulaDirect safe.',1),
 ('report_resolve','Warning issued','The account was reviewed and a warning was issued. Thank you for the report.',2),
 ('report_dismiss','No violation found','We reviewed this report and found no violation of the marketplace rules.',1),
 ('report_dismiss','Duplicate report','This report duplicates one that is already being handled.',2),
 ('issue_resolve','Customer contacted','The customer was contacted and the delivery can continue. Thank you for flagging it.',1),
 ('issue_resolve','Seller notified','The seller was notified and will fix the problem. Please wait at the pickup point for up to 15 minutes.',2),
 ('issue_resolve','Delivery cancelled','The delivery was cancelled. Please return the item to the seller and mark yourself available again.',3)
ON CONFLICT (kind,label) DO NOTHING;

ALTER TABLE public.ops_case_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_item_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_decision_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_case_notes_read ON public.ops_case_notes;
DROP POLICY IF EXISTS ops_item_claims_read ON public.ops_item_claims;
DROP POLICY IF EXISTS ops_decision_templates_read ON public.ops_decision_templates;
CREATE POLICY ops_case_notes_read ON public.ops_case_notes FOR SELECT TO authenticated USING (public.jd_is_ops());
CREATE POLICY ops_item_claims_read ON public.ops_item_claims FOR SELECT TO authenticated USING (public.jd_is_ops());
CREATE POLICY ops_decision_templates_read ON public.ops_decision_templates FOR SELECT TO authenticated USING (public.jd_is_ops());
REVOKE ALL ON public.ops_case_notes, public.ops_item_claims, public.ops_decision_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ops_case_notes, public.ops_item_claims, public.ops_decision_templates TO authenticated;

CREATE OR REPLACE FUNCTION public.ops_queue(p_kind text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v jsonb;
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  WITH raw AS (
    SELECT 'product'::text AS kind, p.id, p.title::text AS title,
      ('Listing by '||COALESCE(NULLIF(trim(pr.first_name||' '||pr.last_name),''),'a seller'))::text AS subtitle,
      p.created_at, 1 AS base,
      jsonb_build_object('price',p.price,'currency',p.currency,'image',p.main_image,'condition',p.condition,'category',p.category_id) AS meta
    FROM public.products p LEFT JOIN public.profiles pr ON pr.id=p.seller_id WHERE p.status='pending_review'
    UNION ALL
    SELECT 'application', a.id, a.full_name::text, (replace(a.worker_type,'_',' ')||' · '||a.location)::text, a.created_at, 1,
      jsonb_build_object('worker_type',a.worker_type,'reference',a.reference_code,'vehicle',a.vehicle_type)
    FROM public.worker_applications a WHERE a.status='pending' AND a.worker_type IN ('delivery_worker','marketplace_worker')
    UNION ALL
    SELECT 'report', r.id, r.reason::text, (r.target_type||' report')::text, r.created_at,
      CASE WHEN lower(r.reason||' '||COALESCE(r.description,'')) ~ 'fraud|scam|threat|stolen|danger|harass' THEN 3
           WHEN lower(r.reason||' '||COALESCE(r.description,'')) ~ 'counterfeit|abuse|payment' THEN 2 ELSE 1 END,
      jsonb_build_object('target_type',r.target_type,'status',r.status)
    FROM public.reports r WHERE r.status IN ('pending','investigating')
    UNION ALL
    SELECT 'issue', i.id, ('Delivery: '||replace(i.kind,'_',' '))::text, COALESCE('Order '||o.order_number,'Delivery')::text, i.created_at,
      CASE WHEN i.kind='safety' THEN 3 WHEN i.kind IN ('customer_unreachable','wrong_address','seller_not_ready') THEN 2 ELSE 1 END,
      jsonb_build_object('kind',i.kind)
    FROM public.delivery_issues i LEFT JOIN public.orders o ON o.id=i.order_id WHERE i.status='open'
  ), scored AS (
    SELECT raw.*, extract(epoch FROM now()-raw.created_at)/3600.0 AS age_hours,
      GREATEST(raw.base, CASE WHEN now()-raw.created_at>=interval '48 hours' THEN 3 WHEN now()-raw.created_at>=interval '24 hours' THEN 2 ELSE 1 END) AS rank
    FROM raw WHERE p_kind IS NULL OR raw.kind=p_kind
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind',s.kind,'id',s.id,'title',s.title,'subtitle',s.subtitle,'created_at',s.created_at,'age_hours',round(s.age_hours::numeric,1),
    'priority',CASE s.rank WHEN 3 THEN 'high' WHEN 2 THEN 'medium' ELSE 'standard' END,'meta',s.meta,
    'claimed_by',CASE WHEN c.worker_id IS NULL THEN NULL ELSE COALESCE(NULLIF(trim(cp.first_name||' '||cp.last_name),''),'A teammate') END,
    'claimed_by_me',COALESCE(c.worker_id=auth.uid(),false),'claim_expires_at',c.expires_at
  ) ORDER BY s.rank DESC, s.created_at ASC),'[]'::jsonb) INTO v
  FROM scored s
  LEFT JOIN public.ops_item_claims c ON c.subject_type=s.kind AND c.subject_id=s.id AND c.expires_at>now()
  LEFT JOIN public.profiles cp ON cp.id=c.worker_id;
  RETURN v;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_get_item(p_kind text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v jsonb; p public.products%ROWTYPE; a public.worker_applications%ROWTYPE; r public.reports%ROWTYPE; i public.delivery_issues%ROWTYPE;
  v_name text; v_notes jsonb;
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  IF p_kind NOT IN ('product','application','report','issue') THEN RAISE EXCEPTION 'Unknown item type'; END IF;

  IF p_kind='product' THEN
    SELECT * INTO p FROM public.products WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
    v := jsonb_build_object('kind','product',
      'item',jsonb_build_object('id',p.id,'title',p.title,'description',p.description,'price',p.price,'currency',p.currency,'category',p.category_id,
        'condition',p.condition,'stock',p.stock,'location',p.location,'status',p.status,'rejection_reason',p.rejection_reason,'created_at',p.created_at,'main_image',p.main_image),
      'images',COALESCE((SELECT jsonb_agg(pi.image_url ORDER BY pi.sort_order) FROM public.product_images pi WHERE pi.product_id=p.id),'[]'::jsonb),
      'seller',(SELECT jsonb_build_object('id',pr.id,'name',trim(pr.first_name||' '||pr.last_name),'joined',pr.created_at,
          'store_verified',COALESCE((SELECT s.is_verified FROM public.stores s WHERE s.seller_id=pr.id LIMIT 1),false),
          'approved',(SELECT count(*) FROM public.products x WHERE x.seller_id=pr.id AND x.status='approved'),
          'rejected',(SELECT count(*) FROM public.products x WHERE x.seller_id=pr.id AND x.status='rejected'),
          'open_reports',(SELECT count(*) FROM public.reports rr WHERE rr.status IN ('pending','investigating') AND ((rr.target_type='seller' AND rr.target_id=pr.id)
              OR (rr.target_type='product' AND rr.target_id IN (SELECT y.id FROM public.products y WHERE y.seller_id=pr.id))))
        ) FROM public.profiles pr WHERE pr.id=p.seller_id));
  ELSIF p_kind='application' THEN
    SELECT * INTO a FROM public.worker_applications WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
    v := jsonb_build_object('kind','application',
      'item',jsonb_build_object('id',a.id,'reference_code',a.reference_code,'worker_type',a.worker_type,'status',a.status,'full_name',a.full_name,'phone',a.phone,
        'location',a.location,'areas',COALESCE(to_jsonb(a.delivery_areas),'[]'::jsonb),'vehicle_type',a.vehicle_type,'plate_number',a.plate_number,
        'experience',a.experience_notes,'emergency_contact_name',a.emergency_contact_name,'emergency_contact_phone',a.emergency_contact_phone,
        'availability',a.availability,'languages',COALESCE(to_jsonb(a.languages),'[]'::jsonb),'weekly_hours',a.weekly_hours,
        'identity_document_path',a.identity_document_path,'selfie_path',a.selfie_path,'info_request',a.info_request,'applicant_response',a.applicant_response,
        'review_notes',a.review_notes,'created_at',a.created_at),
      'applicant',(SELECT jsonb_build_object('id',pr.id,'name',trim(pr.first_name||' '||pr.last_name),'email',pr.email,'joined',pr.created_at,
          'earlier_applications',(SELECT count(*) FROM public.worker_applications w WHERE w.user_id=pr.id AND w.id<>a.id)) FROM public.profiles pr WHERE pr.id=a.user_id),
      'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('event',e.event,'note',e.note,'created_at',e.created_at) ORDER BY e.created_at) FROM public.worker_application_events e WHERE e.application_id=a.id),'[]'::jsonb));
  ELSIF p_kind='report' THEN
    SELECT * INTO r FROM public.reports WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
    v := jsonb_build_object('kind','report',
      'item',jsonb_build_object('id',r.id,'reason',r.reason,'description',r.description,'target_type',r.target_type,'target_id',r.target_id,'status',r.status,'resolution',r.resolution,'created_at',r.created_at),
      'reporter',(SELECT trim(pr.first_name||' '||pr.last_name) FROM public.profiles pr WHERE pr.id=r.reporter_id),
      'target',CASE r.target_type
        WHEN 'product' THEN (SELECT jsonb_build_object('title',x.title,'status',x.status,'image',x.main_image,'seller',(SELECT trim(pr.first_name||' '||pr.last_name) FROM public.profiles pr WHERE pr.id=x.seller_id)) FROM public.products x WHERE x.id=r.target_id)
        WHEN 'seller' THEN (SELECT jsonb_build_object('name',trim(pr.first_name||' '||pr.last_name)) FROM public.profiles pr WHERE pr.id=r.target_id)
        WHEN 'user' THEN (SELECT jsonb_build_object('name',trim(pr.first_name||' '||pr.last_name)) FROM public.profiles pr WHERE pr.id=r.target_id)
        ELSE NULL END,
      'other_open_reports',(SELECT count(*) FROM public.reports z WHERE z.target_type=r.target_type AND z.target_id=r.target_id AND z.id<>r.id AND z.status IN ('pending','investigating')));
  ELSE
    SELECT * INTO i FROM public.delivery_issues WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Delivery issue not found'; END IF;
    v := jsonb_build_object('kind','issue',
      'item',jsonb_build_object('id',i.id,'kind',i.kind,'note',i.note,'status',i.status,'resolution',i.resolution,'created_at',i.created_at,'resolved_at',i.resolved_at),
      'courier',(SELECT jsonb_build_object('name',trim(pr.first_name||' '||pr.last_name),'phone',dp.phone,'vehicle',dp.vehicle_type,'status',dp.status)
                 FROM public.profiles pr LEFT JOIN public.delivery_profiles dp ON dp.user_id=pr.id WHERE pr.id=i.courier_id),
      'delivery',(SELECT jsonb_build_object('order_number',o.order_number,'status',dr.status,'pickup',dr.pickup_location,'destination',dr.delivery_destination,
                  'area',dr.delivery_area,'customer_phone',o.delivery_phone,'assigned_at',dr.assigned_at)
                  FROM public.delivery_requests dr JOIN public.orders o ON o.id=dr.order_id WHERE dr.id=i.delivery_request_id));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'author',COALESCE(NULLIF(trim(pr.first_name||' '||pr.last_name),''),'Teammate'),'created_at',n.created_at) ORDER BY n.created_at),'[]'::jsonb)
  INTO v_notes FROM public.ops_case_notes n LEFT JOIN public.profiles pr ON pr.id=n.author_id WHERE n.subject_type=p_kind AND n.subject_id=p_id;
  RETURN v || jsonb_build_object('notes',v_notes);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_claim_item(p_kind text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid(); c public.ops_item_claims%ROWTYPE; v_exp timestamptz; v_name text;
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  IF p_kind NOT IN ('product','application','report','issue') THEN RAISE EXCEPTION 'Unknown item type'; END IF;
  v_exp := now() + make_interval(mins => public.jd_setting('claim_lock_minutes',20)::int);
  PERFORM pg_advisory_xact_lock(hashtext(p_kind||p_id::text));
  SELECT * INTO c FROM public.ops_item_claims WHERE subject_type=p_kind AND subject_id=p_id;
  IF FOUND AND c.expires_at>now() AND c.worker_id<>v_user THEN
    SELECT COALESCE(NULLIF(trim(first_name||' '||last_name),''),'A teammate') INTO v_name FROM public.profiles WHERE id=c.worker_id;
    RETURN jsonb_build_object('success',false,'held_by',v_name,'expires_at',c.expires_at);
  END IF;
  INSERT INTO public.ops_item_claims(subject_type,subject_id,worker_id,claimed_at,expires_at) VALUES(p_kind,p_id,v_user,now(),v_exp)
  ON CONFLICT (subject_type,subject_id) DO UPDATE SET worker_id=v_user,claimed_at=now(),expires_at=v_exp;
  RETURN jsonb_build_object('success',true,'expires_at',v_exp);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_release_item(p_kind text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  DELETE FROM public.ops_item_claims WHERE subject_type=p_kind AND subject_id=p_id AND (worker_id=auth.uid() OR public.is_gambasket_admin());
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_add_note(p_kind text, p_id uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  IF p_kind NOT IN ('product','application','report','issue') THEN RAISE EXCEPTION 'Unknown item type'; END IF;
  IF length(trim(COALESCE(p_note,''))) = 0 THEN RAISE EXCEPTION 'Write a note first'; END IF;
  INSERT INTO public.ops_case_notes(subject_type,subject_id,author_id,note) VALUES(p_kind,p_id,auth.uid(),left(trim(p_note),2000)) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success',true,'id',v_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_review_application(p_application_id uuid, p_decision text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  a public.worker_applications%ROWTYPE;
  v_vehicle text; v_reward numeric; v_cur character varying; v_desc text;
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  IF p_decision NOT IN ('approved','rejected','needs_info') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF p_decision IN ('rejected','needs_info') AND length(trim(COALESCE(p_notes,''))) < 3 THEN RAISE EXCEPTION 'Add a message for the applicant'; END IF;

  SELECT * INTO a FROM public.worker_applications WHERE id=p_application_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found or already reviewed'; END IF;
  IF a.worker_type NOT IN ('delivery_worker','marketplace_worker') THEN RAISE EXCEPTION 'Seller verification is reviewed in the verification queue'; END IF;
  IF a.user_id = v_user THEN RAISE EXCEPTION 'You cannot review your own application'; END IF;
  IF p_decision='approved' AND a.worker_type='marketplace_worker' AND NOT public.is_gambasket_admin() THEN
    RAISE EXCEPTION 'Only an administrator can approve operations workers';
  END IF;

  PERFORM set_config('app.gambasket_internal','on',true);
  UPDATE public.worker_applications
  SET status=CASE p_decision WHEN 'needs_info' THEN 'needs_info' ELSE p_decision END,
      reviewed_by=v_user, review_notes=NULLIF(trim(COALESCE(p_notes,'')),''),
      info_request=CASE WHEN p_decision='needs_info' THEN left(trim(p_notes),1000) ELSE info_request END, updated_at=now()
  WHERE id=a.id RETURNING * INTO a;

  IF p_decision='approved' THEN
    INSERT INTO public.user_roles(user_id,role_id,assigned_by,is_active) VALUES(a.user_id,a.worker_type,v_user,true)
    ON CONFLICT (user_id,role_id) DO UPDATE SET is_active=true, assigned_by=v_user;
    IF a.worker_type='delivery_worker' THEN
      v_vehicle := CASE lower(COALESCE(a.vehicle_type,'')) WHEN 'car' THEN 'Car' WHEN 'van' THEN 'Van' WHEN 'bicycle' THEN 'Bicycle' WHEN 'other' THEN 'Other' ELSE 'Motorcycle' END;
      UPDATE public.delivery_profiles SET phone=a.phone, vehicle_type=v_vehicle, plate_number=a.plate_number,
        delivery_areas=COALESCE(a.delivery_areas,ARRAY[a.location]::text[]), current_location=a.location, status='offline', is_verified=true, updated_at=now()
      WHERE user_id=a.user_id;
      IF NOT FOUND THEN
        INSERT INTO public.delivery_profiles(user_id,phone,vehicle_type,plate_number,delivery_areas,current_location,status,is_verified)
        VALUES(a.user_id,a.phone,v_vehicle,a.plate_number,COALESCE(a.delivery_areas,ARRAY[a.location]::text[]),a.location,'offline',true);
      END IF;
    END IF;
  END IF;

  INSERT INTO public.worker_application_events(application_id,actor_id,event,note) VALUES(a.id,v_user,p_decision,NULLIF(trim(COALESCE(p_notes,'')),''));
  INSERT INTO public.notifications(user_id,type,title,message,data)
  VALUES(a.user_id,'system',
    CASE p_decision WHEN 'approved' THEN 'Application approved' WHEN 'rejected' THEN 'Application not accepted' ELSE 'We need a bit more from you' END,
    CASE p_decision WHEN 'approved' THEN 'Welcome aboard. Your workspace is ready.' WHEN 'rejected' THEN COALESCE(left(p_notes,300),'See your application for details.') ELSE left(p_notes,300) END,
    jsonb_build_object('application_id',a.id,'status',a.status));
  INSERT INTO public.activity_logs(actor_id,action,target_type,target_id,metadata)
  VALUES(v_user,'worker_application_'||p_decision,'worker_application',a.id::text,jsonb_build_object('applicant_id',a.user_id,'worker_type',a.worker_type,'notes',p_notes));
  DELETE FROM public.ops_item_claims WHERE subject_type='application' AND subject_id=a.id;

  IF public.has_role(v_user,'marketplace_worker'::character varying) THEN
    SELECT reward_amount,currency,description INTO v_reward,v_cur,v_desc FROM public.earning_rules
    WHERE role_name='marketplace_worker' AND action_type='review_worker_application' AND is_active=true;
    IF FOUND AND COALESCE(v_reward,0)>0 AND NOT EXISTS (SELECT 1 FROM public.earning_transactions WHERE user_id=v_user AND role_name='marketplace_worker'
        AND action_type='review_worker_application' AND reference_id=a.id::text) THEN
      INSERT INTO public.earning_transactions(user_id,role_name,action_type,reference_id,amount,currency,status,description)
      VALUES(v_user,'marketplace_worker','review_worker_application',a.id::text,v_reward,COALESCE(v_cur,'GMD'),'available',COALESCE(v_desc,'Worker application review'));
    END IF;
  END IF;
  RETURN jsonb_build_object('success',true,'status',a.status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_resolve_delivery_issue(p_issue_id uuid, p_resolution text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid(); i public.delivery_issues%ROWTYPE;
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  IF length(trim(COALESCE(p_resolution,''))) < 3 THEN RAISE EXCEPTION 'Tell the courier what happens next'; END IF;
  UPDATE public.delivery_issues SET status='resolved', resolution=left(trim(p_resolution),1000), resolved_by=v_user, resolved_at=now()
  WHERE id=p_issue_id AND status='open' RETURNING * INTO i;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Issue not found or already resolved'; END IF;
  INSERT INTO public.notifications(user_id,type,title,message,data)
  VALUES(i.courier_id,'delivery','Operations replied to your report',left(trim(p_resolution),300),jsonb_build_object('delivery_issue_id',i.id,'delivery_request_id',i.delivery_request_id));
  INSERT INTO public.activity_logs(actor_id,action,target_type,target_id,metadata)
  VALUES(v_user,'delivery_issue_resolved','delivery_issue',i.id::text,jsonb_build_object('kind',i.kind));
  DELETE FROM public.ops_item_claims WHERE subject_type='issue' AND subject_id=i.id;
  RETURN jsonb_build_object('success',true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid(); v_stale interval;
  c_products int; c_apps int; c_waiting int; c_reports int; c_issues int; c_unassigned int; c_active int; c_online int;
  s_products int; s_apps int; s_reports int; s_issues int; v_oldest numeric;
  my_today int; my_week int; team_today int; v_series jsonb; v_turn numeric;
  re text := '^(product_(approved|rejected)|worker_application_(approved|rejected|needs_info)|report_(investigating|resolved|dismissed)|delivery_issue_resolved)$';
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  v_stale := make_interval(hours => public.jd_setting('stale_hours',24)::int);
  SELECT count(*), count(*) FILTER (WHERE created_at<now()-v_stale) INTO c_products,s_products FROM public.products WHERE status='pending_review';
  SELECT count(*) FILTER (WHERE status='pending'), count(*) FILTER (WHERE status='needs_info'), count(*) FILTER (WHERE status='pending' AND created_at<now()-v_stale)
    INTO c_apps,c_waiting,s_apps FROM public.worker_applications WHERE worker_type IN ('delivery_worker','marketplace_worker');
  SELECT count(*), count(*) FILTER (WHERE created_at<now()-v_stale) INTO c_reports,s_reports FROM public.reports WHERE status IN ('pending','investigating');
  SELECT count(*), count(*) FILTER (WHERE created_at<now()-v_stale) INTO c_issues,s_issues FROM public.delivery_issues WHERE status='open';
  SELECT count(*) INTO c_unassigned FROM public.delivery_requests dr JOIN public.orders o ON o.id=dr.order_id WHERE dr.status='pending' AND o.order_status='ready_for_delivery';
  SELECT count(*) INTO c_active FROM public.delivery_requests WHERE status IN ('assigned','picked_up','out_for_delivery');
  SELECT count(*) INTO c_online FROM public.delivery_profiles WHERE status IN ('available','delivering');
  SELECT max(extract(epoch FROM now()-t)/3600.0) INTO v_oldest FROM (
    SELECT min(created_at) t FROM public.products WHERE status='pending_review'
    UNION ALL SELECT min(created_at) FROM public.worker_applications WHERE status='pending'
    UNION ALL SELECT min(created_at) FROM public.reports WHERE status IN ('pending','investigating')
    UNION ALL SELECT min(created_at) FROM public.delivery_issues WHERE status='open') q;
  SELECT count(*) FILTER (WHERE actor_id=v_user AND created_at>=date_trunc('day',now())),
         count(*) FILTER (WHERE actor_id=v_user AND created_at>=now()-interval '7 days'),
         count(*) FILTER (WHERE created_at>=date_trunc('day',now()))
  INTO my_today,my_week,team_today FROM public.activity_logs WHERE action ~ re AND created_at>=now()-interval '7 days';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('day',g::date,'decisions',COALESCE(x.n,0),'mine',COALESCE(x.m,0)) ORDER BY g),'[]'::jsonb) INTO v_series
  FROM generate_series(current_date-6,current_date,interval '1 day') g
  LEFT JOIN (SELECT created_at::date d, count(*) n, count(*) FILTER (WHERE actor_id=v_user) m FROM public.activity_logs WHERE action ~ re AND created_at>=current_date-6 GROUP BY 1) x ON x.d=g::date;
  SELECT round(avg(extract(epoch FROM l.created_at-p.created_at)/3600.0)::numeric,1) INTO v_turn
  FROM public.activity_logs l JOIN public.products p ON p.id::text=l.target_id
  WHERE l.action IN ('product_approved','product_rejected') AND l.created_at>=now()-interval '14 days';
  RETURN jsonb_build_object(
    'queues',jsonb_build_object('products',c_products,'applications',c_apps,'reports',c_reports,'issues',c_issues),
    'overdue',jsonb_build_object('products',s_products,'applications',s_apps,'reports',s_reports,'issues',s_issues),
    'waiting_on_applicants',c_waiting,'oldest_hours',round(COALESCE(v_oldest,0)::numeric,1),
    'dispatch',jsonb_build_object('unassigned',c_unassigned,'active',c_active,'couriers_online',c_online),
    'me',jsonb_build_object('today',my_today,'week',my_week),'team_today',team_today,'series',v_series,'avg_product_turnaround_hours',v_turn);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_dispatch_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  RETURN jsonb_build_object(
    'unassigned',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',dr.id,'order_number',o.order_number,'area',dr.delivery_area,'fee',dr.estimated_fee,
        'waiting_minutes',round(extract(epoch FROM now()-dr.created_at)/60.0)) ORDER BY dr.created_at)
      FROM public.delivery_requests dr JOIN public.orders o ON o.id=dr.order_id WHERE dr.status='pending' AND o.order_status='ready_for_delivery'),'[]'::jsonb),
    'active',COALESCE((SELECT jsonb_agg(t ORDER BY (t->>'minutes_in_status')::numeric DESC) FROM (
      SELECT jsonb_build_object('id',dr.id,'order_number',o.order_number,'status',dr.status,'area',dr.delivery_area,
        'courier',trim(pr.first_name||' '||pr.last_name),'courier_phone',dp.phone,
        'minutes_in_status',round(extract(epoch FROM now()-COALESCE(dr.out_for_delivery_at,dr.picked_up_at,dr.assigned_at,dr.created_at))/60.0),
        'stuck',(now()-COALESCE(dr.out_for_delivery_at,dr.picked_up_at,dr.assigned_at,dr.created_at)) >
                 CASE dr.status WHEN 'assigned' THEN interval '45 minutes' WHEN 'picked_up' THEN interval '30 minutes' ELSE interval '90 minutes' END,
        'open_issues',(SELECT count(*) FROM public.delivery_issues i WHERE i.delivery_request_id=dr.id AND i.status='open')) AS t
      FROM public.delivery_requests dr JOIN public.orders o ON o.id=dr.order_id
      LEFT JOIN public.profiles pr ON pr.id=dr.assigned_worker_id LEFT JOIN public.delivery_profiles dp ON dp.user_id=dr.assigned_worker_id
      WHERE dr.status IN ('assigned','picked_up','out_for_delivery')) q),'[]'::jsonb),
    'couriers',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',trim(pr.first_name||' '||pr.last_name),'status',dp.status,'vehicle',dp.vehicle_type,
        'areas',COALESCE(to_jsonb(dp.delivery_areas),'[]'::jsonb),'last_seen_at',dp.last_seen_at,'online_since',dp.online_since) ORDER BY dp.status,dp.online_since)
      FROM public.delivery_profiles dp JOIN public.profiles pr ON pr.id=dp.user_id WHERE dp.status IN ('available','delivering')),'[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ops_my_activity(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF NOT public.jd_is_ops() THEN RAISE EXCEPTION 'Operations access required'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC) FROM (
    SELECT id,action,target_type,target_id,metadata,created_at FROM public.activity_logs WHERE actor_id=auth.uid()
    ORDER BY created_at DESC LIMIT LEAST(GREATEST(p_limit,1),200)) t),'[]'::jsonb);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Grants: authenticated only; each function checks the caller's role itself.
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'jd_is_ops()','jd_is_courier()','jd_setting(text,numeric)','jd_worker_available(uuid,text)',
    'submit_worker_application(text,text,text,text,text[],text,text,text,text,text,text,text,jsonb,text[],integer)',
    'my_worker_applications()','respond_to_application_info(uuid,text,text)','withdraw_worker_application(uuid)',
    'courier_set_availability(boolean,double precision,double precision)','courier_ping(double precision,double precision)',
    'courier_dashboard()','courier_job_board()','courier_active_job()','courier_report_issue(uuid,text,text)',
    'courier_history(integer,integer)','courier_earnings_series(integer)',
    'worker_wallet(text)','worker_payouts(text)','worker_request_payout(text,numeric,text,text)',
    'ops_queue(text)','ops_get_item(text,uuid)','ops_claim_item(text,uuid)','ops_release_item(text,uuid)','ops_add_note(text,uuid,text)',
    'ops_review_application(uuid,text,text)','ops_resolve_delivery_issue(uuid,text)','ops_dashboard()','ops_dispatch_board()','ops_my_activity(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END
$grants$;

COMMIT;
