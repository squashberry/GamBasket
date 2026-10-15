-- GamBasket admin campaign/featured-product permissions and delivered notifications.
BEGIN;

-- Campaigns are readable by visitors only while active and within their advertised dates.
REVOKE ALL ON TABLE public.marketplace_campaigns FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.marketplace_campaigns TO anon,authenticated;
DO $drop_campaign_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='marketplace_campaigns'
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.marketplace_campaigns',p.policyname); END LOOP;
END;
$drop_campaign_policies$;
CREATE POLICY marketplace_campaigns_public_active_read
ON public.marketplace_campaigns FOR SELECT TO anon,authenticated
USING (
  (is_active=true AND starts_at<=now() AND ends_at>=now())
  OR (auth.uid() IS NOT NULL AND public.is_gambasket_admin())
);

REVOKE ALL ON TABLE public.featured_products FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.featured_products TO anon,authenticated;
DO $drop_featured_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='featured_products'
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.featured_products',p.policyname); END LOOP;
END;
$drop_featured_policies$;
CREATE POLICY featured_products_public_active_read
ON public.featured_products FOR SELECT TO anon,authenticated
USING (
  (status='active' AND starts_at<=now() AND (ends_at IS NULL OR ends_at>=now()))
  OR (auth.uid() IS NOT NULL AND public.is_gambasket_admin())
);

REVOKE ALL ON TABLE public.seller_promotions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.seller_promotions TO anon,authenticated;
DO $drop_seller_promotion_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='seller_promotions'
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.seller_promotions',p.policyname); END LOOP;
END;
$drop_seller_promotion_policies$;
CREATE POLICY seller_promotions_public_active_read
ON public.seller_promotions FOR SELECT TO anon,authenticated
USING (
  (is_active=true AND starts_at<=now() AND ends_at>=now())
  OR seller_id=(SELECT auth.uid())
  OR (auth.uid() IS NOT NULL AND public.is_gambasket_admin())
);

CREATE OR REPLACE FUNCTION public.admin_create_campaign(
  p_name character varying,
  p_slug character varying DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_banner_url text DEFAULT NULL,
  p_starts_at timestamptz DEFAULT now(),
  p_ends_at timestamptz DEFAULT NULL,
  p_affiliate_commission_boost numeric DEFAULT 0
)
RETURNS public.marketplace_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE v_campaign public.marketplace_campaigns%ROWTYPE; v_slug text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_gambasket_admin() THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF NULLIF(trim(p_name),'') IS NULL OR length(trim(p_name))>150 THEN
    RAISE EXCEPTION 'Campaign name is required and must be under 150 characters';
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at<=p_starts_at THEN
    RAISE EXCEPTION 'Campaign end must be after its start';
  END IF;
  IF p_affiliate_commission_boost IS NULL OR p_affiliate_commission_boost<0 OR p_affiliate_commission_boost>100 THEN
    RAISE EXCEPTION 'Affiliate commission boost must be between 0 and 100 percent';
  END IF;
  v_slug:=NULLIF(lower(trim(p_slug)),'');
  IF v_slug IS NOT NULL THEN
    v_slug:=regexp_replace(v_slug,'[^a-z0-9-]+','-','g');
    v_slug:=trim(both '-' from v_slug);
    IF v_slug='' THEN v_slug:=NULL; END IF;
    IF v_slug IS NOT NULL AND EXISTS(SELECT 1 FROM public.marketplace_campaigns c WHERE c.slug=v_slug) THEN
      RAISE EXCEPTION 'That campaign slug is already in use';
    END IF;
  END IF;

  INSERT INTO public.marketplace_campaigns(
    name,slug,description,banner_url,campaign_type,starts_at,ends_at,
    affiliate_commission_boost,is_active,created_by
  )
  VALUES(
    trim(p_name),v_slug,NULLIF(trim(p_description),''),NULLIF(trim(p_banner_url),''),
    'marketplace',p_starts_at,p_ends_at,p_affiliate_commission_boost,true,auth.uid()
  )
  RETURNING * INTO v_campaign;

  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'campaign_created','marketplace_campaign',v_campaign.id,
    jsonb_build_object('name',v_campaign.name,'slug',v_campaign.slug,'starts_at',v_campaign.starts_at,'ends_at',v_campaign.ends_at));
  RETURN v_campaign;
END;
$fn$;

-- Tighten featured placement and allow product trigger protections to remain in place.
CREATE OR REPLACE FUNCTION public.admin_feature_product(
  p_product_id uuid,
  p_placement character varying,
  p_priority integer,
  p_ends_at timestamptz DEFAULT NULL
)
RETURNS public.featured_products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE result public.featured_products%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_gambasket_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF NULLIF(trim(p_placement),'') IS NULL OR length(trim(p_placement))>50 THEN RAISE EXCEPTION 'Placement is required and must be under 50 characters'; END IF;
  IF p_priority IS NULL OR p_priority < -1000 OR p_priority > 10000 THEN RAISE EXCEPTION 'Featured priority is outside the allowed range'; END IF;
  IF p_ends_at IS NOT NULL AND p_ends_at<=now() THEN RAISE EXCEPTION 'Featured end time must be in the future'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id AND status='approved') THEN
    RAISE EXCEPTION 'Only approved products can be featured';
  END IF;

  INSERT INTO public.featured_products(product_id,placement,priority,starts_at,ends_at,status,created_by)
  VALUES(p_product_id,trim(p_placement),p_priority,now(),p_ends_at,'active',auth.uid())
  RETURNING * INTO result;

  UPDATE public.products SET is_featured=true,featured_until=p_ends_at,updated_at=now()
  WHERE id=p_product_id;

  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'product_featured','product',p_product_id,
    jsonb_build_object('placement',p_placement,'priority',p_priority,'ends_at',p_ends_at));
  RETURN result;
END;
$fn$;

-- Send growth messages to both the dedicated growth inbox and the in-app notification feed.
CREATE OR REPLACE FUNCTION public.admin_send_growth_notification(
  p_user_id uuid,
  p_title character varying,
  p_message text,
  p_type character varying DEFAULT 'campaign',
  p_action_url text DEFAULT NULL
)
RETURNS public.growth_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE result public.growth_notifications%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_gambasket_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id) THEN RAISE EXCEPTION 'Recipient not found'; END IF;
  IF NULLIF(trim(p_title),'') IS NULL OR length(trim(p_title))>150 THEN RAISE EXCEPTION 'Notification title is required and must be under 150 characters'; END IF;
  IF NULLIF(trim(p_message),'') IS NULL OR length(trim(p_message))>5000 THEN RAISE EXCEPTION 'Notification message is required and must be under 5000 characters'; END IF;

  INSERT INTO public.growth_notifications(user_id,type,title,message,action_url)
  VALUES(p_user_id,COALESCE(NULLIF(trim(p_type),''),'campaign'),trim(p_title),trim(p_message),NULLIF(trim(p_action_url),''))
  RETURNING * INTO result;

  INSERT INTO public.notifications(user_id,type,title,message,data)
  VALUES(p_user_id,COALESCE(NULLIF(trim(p_type),''),'campaign'),trim(p_title),trim(p_message),
    jsonb_build_object('action_url',NULLIF(trim(p_action_url),''),'growth_notification_id',result.id));

  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'growth_notification_sent','profile',p_user_id,jsonb_build_object('title',p_title,'type',p_type));
  RETURN result;
END;
$fn$;

-- User-owned growth notifications are private and users can only mark them read.
REVOKE ALL ON TABLE public.growth_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON TABLE public.growth_notifications TO authenticated;
DO $drop_growth_notification_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='growth_notifications'
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.growth_notifications',p.policyname); END LOOP;
END;
$drop_growth_notification_policies$;
CREATE POLICY growth_notifications_select_owner
ON public.growth_notifications FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());
CREATE POLICY growth_notifications_update_owner
ON public.growth_notifications FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin())
WITH CHECK (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());

CREATE OR REPLACE FUNCTION public.guard_growth_notification_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF public.is_gambasket_admin() THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'You may only update your own growth notifications'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.action_url IS DISTINCT FROM OLD.action_url OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Growth notification content is immutable';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_guard_growth_notification_update ON public.growth_notifications;
CREATE TRIGGER trg_guard_growth_notification_update
BEFORE UPDATE ON public.growth_notifications FOR EACH ROW
EXECUTE FUNCTION public.guard_growth_notification_update();

REVOKE ALL ON FUNCTION public.admin_create_campaign(character varying,character varying,text,text,timestamptz,timestamptz,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_campaign(character varying,character varying,text,text,timestamptz,timestamptz,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_feature_product(uuid,character varying,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_feature_product(uuid,character varying,integer,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_send_growth_notification(uuid,character varying,text,character varying,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_growth_notification(uuid,character varying,text,character varying,text) TO authenticated;

COMMIT;
