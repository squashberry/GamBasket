-- GamBasket security and workflow repair, audited against live project iwxcepbwmnnkxocskopx.
-- Additive/idempotent: preserves existing accounts, listings, orders and business data.
BEGIN;

ALTER TABLE public.delivery_requests
  ADD COLUMN IF NOT EXISTS out_for_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_lat double precision,
  ADD COLUMN IF NOT EXISTS pickup_lng double precision,
  ADD COLUMN IF NOT EXISTS dropoff_lat double precision,
  ADD COLUMN IF NOT EXISTS dropoff_lng double precision;

-- Safe RLS helpers. A caller cannot probe another user's role/permission.
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role character varying)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_user_id IS NULL THEN false
    WHEN p_user_id <> auth.uid() AND NOT public.is_gambasket_admin() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id=p_user_id AND ur.role_id=p_role AND COALESCE(ur.is_active,true)=true
    )
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission character varying)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_user_id IS NULL THEN false
    WHEN p_user_id <> auth.uid() AND NOT public.is_gambasket_admin() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id=ur.role_id
      WHERE ur.user_id=p_user_id AND COALESCE(ur.is_active,true)=true
        AND (rp.permission_id=p_permission OR ur.role_id='admin')
    )
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.can_view_order(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.orders o
   WHERE o.id=p_order_id AND (
     o.buyer_id=auth.uid() OR o.seller_id=auth.uid()
     OR public.is_gambasket_admin()
     OR EXISTS (SELECT 1 FROM public.delivery_requests dr
                WHERE dr.order_id=o.id AND dr.assigned_worker_id=auth.uid())
   )
 );
$fn$;

-- Protect account identity and moderation flags while allowing normal profile edits.
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF public.is_gambasket_admin() THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR auth.uid()<>OLD.id THEN RAISE EXCEPTION 'You may only update your own profile'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.country IS DISTINCT FROM OLD.country
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.is_banned IS DISTINCT FROM OLD.is_banned
     OR NEW.banned_reason IS DISTINCT FROM OLD.banned_reason
     OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Protected account fields cannot be changed from a profile form';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_guard_profile_update ON public.profiles;
CREATE TRIGGER trg_guard_profile_update BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- Sellers can edit listing content, but cannot set moderation status or counters.
-- Non-owner stock/counter changes are accepted only when they represent a matching sale
-- (the order RPC runs SECURITY DEFINER and is the only public path that can do this).
CREATE OR REPLACE FUNCTION public.guard_product_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_admin boolean := public.is_gambasket_admin();
  v_moderator boolean := public.has_role(auth.uid(),'marketplace_worker'::character varying);
  v_stock_delta integer;
  v_sales_delta integer;
BEGIN
  IF v_admin THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF auth.uid() IS NULL OR NEW.seller_id IS DISTINCT FROM auth.uid()
       OR NOT (public.has_role(auth.uid(),'seller'::character varying)
               OR public.has_role(auth.uid(),'supplier'::character varying)) THEN
      RAISE EXCEPTION 'An active seller or supplier may only create their own listings';
    END IF;
    NEW.status:='pending_review'; NEW.rejection_reason:=NULL; NEW.is_featured:=false;
    NEW.featured_until:=NULL; NEW.views_count:=0; NEW.sales_count:=0;
    NEW.verification_status:='unverified';
    RETURN NEW;
  END IF;

  -- A marketplace moderator may change only the moderation decision/reason.
  IF v_moderator
     AND NEW.seller_id IS NOT DISTINCT FROM OLD.seller_id
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.subcategory_id IS NOT DISTINCT FROM OLD.subcategory_id
     AND NEW.condition IS NOT DISTINCT FROM OLD.condition
     AND NEW.location IS NOT DISTINCT FROM OLD.location
     AND NEW.main_image IS NOT DISTINCT FROM OLD.main_image
     AND NEW.stock IS NOT DISTINCT FROM OLD.stock
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
     AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
     AND NEW.featured_until IS NOT DISTINCT FROM OLD.featured_until
     AND NEW.views_count IS NOT DISTINCT FROM OLD.views_count
     AND NEW.sales_count IS NOT DISTINCT FROM OLD.sales_count
     AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status
     AND NEW.status IN ('approved','rejected','suspended','pending_review') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR OLD.seller_id IS DISTINCT FROM auth.uid() THEN
    IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
       OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
       OR NEW.featured_until IS DISTINCT FROM OLD.featured_until
       OR NEW.views_count IS DISTINCT FROM OLD.views_count
       OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.price IS DISTINCT FROM OLD.price
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.category_id IS DISTINCT FROM OLD.category_id
       OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
       OR NEW.condition IS DISTINCT FROM OLD.condition
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.main_image IS DISTINCT FROM OLD.main_image
       OR NEW.listing_type IS DISTINCT FROM OLD.listing_type
       OR NEW.wholesale_price IS DISTINCT FROM OLD.wholesale_price
       OR NEW.retail_suggested_price IS DISTINCT FROM OLD.retail_suggested_price
       OR NEW.minimum_order_quantity IS DISTINCT FROM OLD.minimum_order_quantity
       OR NEW.min_order_quantity IS DISTINCT FROM OLD.min_order_quantity
       OR NEW.wholesale_currency IS DISTINCT FROM OLD.wholesale_currency
       OR NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled THEN
      RAISE EXCEPTION 'Only a seller or validated server operation may change listing fields';
    END IF;
    v_stock_delta:=OLD.stock-NEW.stock;
    v_sales_delta:=NEW.sales_count-OLD.sales_count;
    IF v_stock_delta<0 OR v_sales_delta<0 OR v_stock_delta<>v_sales_delta THEN
      RAISE EXCEPTION 'Inventory changes must represent a matching sale';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (public.has_role(auth.uid(),'seller'::character varying)
          OR public.has_role(auth.uid(),'supplier'::character varying)) THEN
    RAISE EXCEPTION 'Seller or supplier role required';
  END IF;
  IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
     OR NEW.featured_until IS DISTINCT FROM OLD.featured_until
     OR NEW.views_count IS DISTINCT FROM OLD.views_count
     OR NEW.sales_count IS DISTINCT FROM OLD.sales_count
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    RAISE EXCEPTION 'Moderation, ownership, supplier and counter fields are protected';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'A seller cannot approve or reject a listing';
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
     OR NEW.condition IS DISTINCT FROM OLD.condition
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.main_image IS DISTINCT FROM OLD.main_image
     OR NEW.listing_type IS DISTINCT FROM OLD.listing_type
     OR NEW.wholesale_price IS DISTINCT FROM OLD.wholesale_price
     OR NEW.retail_suggested_price IS DISTINCT FROM OLD.retail_suggested_price
     OR NEW.minimum_order_quantity IS DISTINCT FROM OLD.minimum_order_quantity
     OR NEW.min_order_quantity IS DISTINCT FROM OLD.min_order_quantity
     OR NEW.wholesale_currency IS DISTINCT FROM OLD.wholesale_currency
     OR NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled THEN
    NEW.status:='pending_review'; NEW.rejection_reason:=NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_guard_product_write ON public.products;
CREATE TRIGGER trg_guard_product_write BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.guard_product_write();

-- Courier availability and store verification/metrics are not self-editable.
CREATE OR REPLACE FUNCTION public.guard_delivery_profile_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF public.is_gambasket_admin() THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You may only update your own delivery profile';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.total_completed_deliveries IS DISTINCT FROM OLD.total_completed_deliveries
     OR NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
     OR NEW.delivery_areas IS DISTINCT FROM OLD.delivery_areas
     OR NEW.current_location IS DISTINCT FROM OLD.current_location THEN
    RAISE EXCEPTION 'Courier identity and performance fields are protected';
  END IF;
  IF NEW.status NOT IN ('available','offline','delivering') THEN RAISE EXCEPTION 'Invalid courier status'; END IF;
  IF NEW.status='delivering' AND NOT EXISTS (
    SELECT 1 FROM public.delivery_requests dr
    WHERE dr.assigned_worker_id=auth.uid() AND dr.status IN ('assigned','picked_up','out_for_delivery')
  ) THEN RAISE EXCEPTION 'A courier can only enter delivering state after claiming a job'; END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_guard_delivery_profile_update ON public.delivery_profiles;
CREATE TRIGGER trg_guard_delivery_profile_update BEFORE UPDATE ON public.delivery_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_profile_update();

CREATE UNIQUE INDEX IF NOT EXISTS stores_seller_id_uidx ON public.stores(seller_id);
CREATE OR REPLACE FUNCTION public.guard_store_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF public.is_gambasket_admin() THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.seller_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'You may only update your own store'; END IF;
  IF NEW.seller_id IS DISTINCT FROM OLD.seller_id OR NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.rating IS DISTINCT FROM OLD.rating OR NEW.total_sales IS DISTINCT FROM OLD.total_sales THEN
    RAISE EXCEPTION 'Store ownership, verification and sales metrics are protected';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_guard_store_update ON public.stores;
CREATE TRIGGER trg_guard_store_update BEFORE UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.guard_store_update();

CREATE OR REPLACE FUNCTION public.guard_affiliate_profile_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF current_setting('app.gambasket_internal',true)='on' THEN RETURN NEW; END IF;
  IF public.is_affiliate_admin() OR public.is_gambasket_admin() THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'You may only update your affiliate profile'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.affiliate_code IS DISTINCT FROM OLD.affiliate_code OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.total_clicks IS DISTINCT FROM OLD.total_clicks OR NEW.total_orders IS DISTINCT FROM OLD.total_orders
     OR NEW.total_sales IS DISTINCT FROM OLD.total_sales OR NEW.total_commission IS DISTINCT FROM OLD.total_commission THEN
    RAISE EXCEPTION 'Affiliate codes, status and financial counters are protected';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_guard_affiliate_profile_update ON public.affiliate_profiles;
CREATE TRIGGER trg_guard_affiliate_profile_update BEFORE UPDATE ON public.affiliate_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_affiliate_profile_update();

-- Public view contains no email, phone or moderation/account state.
CREATE OR REPLACE VIEW public.public_profiles WITH (security_barrier=true) AS
SELECT id,first_name,last_name,avatar_url,country,region,area FROM public.profiles;
REVOKE ALL ON public.profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.profiles TO authenticated;
REVOKE ALL ON public.public_profiles FROM PUBLIC;
GRANT SELECT ON public.public_profiles TO anon,authenticated;

DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_or_admin_select ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_or_admin_update ON public.profiles;
CREATE POLICY profiles_owner_or_admin_select ON public.profiles FOR SELECT TO authenticated
USING (id=(SELECT auth.uid()) OR public.is_gambasket_admin());
CREATE POLICY profiles_owner_or_admin_update ON public.profiles FOR UPDATE TO authenticated
USING (id=(SELECT auth.uid()) OR public.is_gambasket_admin())
WITH CHECK (id=(SELECT auth.uid()) OR public.is_gambasket_admin());

-- Product catalogue: public read, seller CRUD subject to trigger and RLS, moderation fields protected.
REVOKE INSERT,UPDATE,DELETE ON public.products FROM PUBLIC,anon;
GRANT SELECT ON public.products TO anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.products TO authenticated;
DROP POLICY IF EXISTS "Approved products are viewable by everyone" ON public.products;
CREATE POLICY "Approved products are viewable by everyone" ON public.products FOR SELECT TO anon,authenticated
USING (status='approved' OR seller_id=(SELECT auth.uid())
 OR public.has_permission((SELECT auth.uid()),'products.review'::character varying)
 OR public.has_role((SELECT auth.uid()),'marketplace_worker'::character varying)
 OR public.is_gambasket_admin());
DROP POLICY IF EXISTS "Sellers can create products" ON public.products;
CREATE POLICY "Sellers can create products" ON public.products FOR INSERT TO authenticated
WITH CHECK (seller_id=(SELECT auth.uid())
 AND (public.has_role((SELECT auth.uid()),'seller'::character varying)
 OR public.has_role((SELECT auth.uid()),'supplier'::character varying)));
DROP POLICY IF EXISTS "Sellers can update own products" ON public.products;
CREATE POLICY "Sellers can update own products" ON public.products FOR UPDATE TO authenticated
USING (seller_id=(SELECT auth.uid()) OR public.has_permission((SELECT auth.uid()),'products.review'::character varying)
 OR public.has_role((SELECT auth.uid()),'marketplace_worker'::character varying) OR public.is_gambasket_admin())
WITH CHECK (seller_id=(SELECT auth.uid()) OR public.has_permission((SELECT auth.uid()),'products.review'::character varying)
 OR public.has_role((SELECT auth.uid()),'marketplace_worker'::character varying) OR public.is_gambasket_admin());
DROP POLICY IF EXISTS "Sellers can delete own products" ON public.products;
CREATE POLICY "Sellers can delete own products" ON public.products FOR DELETE TO authenticated
USING (seller_id=(SELECT auth.uid()) OR public.is_gambasket_admin());

-- Orders can only be created by create_order() and changed by guarded RPCs/admins.
DROP POLICY IF EXISTS "Buyers can create orders" ON public.orders;
DROP POLICY IF EXISTS "Only the order RPC creates orders" ON public.orders;
DROP POLICY IF EXISTS "Participants and admins can update orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view own orders (buyer or seller)" ON public.orders;
DROP POLICY IF EXISTS orders_select_by_participation ON public.orders;
DROP POLICY IF EXISTS orders_admin_update ON public.orders;
REVOKE ALL ON public.orders FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.orders TO authenticated;
CREATE POLICY orders_select_by_participation ON public.orders FOR SELECT TO authenticated
USING (public.can_view_order(id));
CREATE POLICY orders_admin_update ON public.orders FOR UPDATE TO authenticated
USING (public.is_gambasket_admin()) WITH CHECK (public.is_gambasket_admin());

DROP POLICY IF EXISTS "Buyers can insert order items" ON public.order_items;
DROP POLICY IF EXISTS "Only the order RPC creates order items" ON public.order_items;
DROP POLICY IF EXISTS "Order items viewable by order participants" ON public.order_items;
DROP POLICY IF EXISTS order_items_select_by_participation ON public.order_items;
REVOKE ALL ON public.order_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_items TO authenticated;
CREATE POLICY order_items_select_by_participation ON public.order_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id=order_items.order_id AND public.can_view_order(o.id)));

-- Only RPCs may create conversations or change conversation membership/read state.
DROP POLICY IF EXISTS "Only conversation RPC or existing participant can add members" ON public.conversation_participants;
DROP POLICY IF EXISTS "Participants can update own read state" ON public.conversation_participants;
REVOKE INSERT,UPDATE,DELETE ON public.conversation_participants FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.conversation_participants TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.conversations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.conversations TO authenticated;

-- Couriers only see verified-available pending jobs, their assigned jobs, and related order details.
DO $drop_delivery_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname,tablename FROM pg_policies WHERE schemaname='public' AND tablename IN ('delivery_profiles','delivery_requests')
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,p.tablename); END LOOP;
END;
$drop_delivery_policies$;
REVOKE ALL ON public.delivery_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.delivery_profiles TO authenticated;
CREATE POLICY delivery_profile_select_self_admin ON public.delivery_profiles FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());
CREATE POLICY delivery_profile_update_self_admin ON public.delivery_profiles FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin())
WITH CHECK (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());
REVOKE ALL ON public.delivery_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.delivery_requests TO authenticated;
CREATE POLICY delivery_requests_select_authorized ON public.delivery_requests FOR SELECT TO authenticated
USING (
 public.is_gambasket_admin()
 OR assigned_worker_id=(SELECT auth.uid())
 OR public.can_view_order(order_id)
 OR (status='pending' AND public.has_role((SELECT auth.uid()),'delivery_worker'::character varying)
     AND EXISTS (SELECT 1 FROM public.delivery_profiles dp WHERE dp.user_id=(SELECT auth.uid())
                 AND dp.is_verified=true AND dp.status='available'))
);

-- Stores are public only while active. Save form uses a secure owner-bound RPC.
DO $drop_store_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='stores'
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.stores',p.policyname); END LOOP;
END;
$drop_store_policies$;
REVOKE ALL ON public.stores FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.stores TO authenticated;
GRANT SELECT ON public.stores TO anon;
CREATE POLICY stores_public_read_active ON public.stores FOR SELECT TO anon,authenticated
USING (is_active=true OR seller_id=(SELECT auth.uid()) OR public.is_gambasket_admin());
CREATE POLICY stores_update_owner_admin ON public.stores FOR UPDATE TO authenticated
USING (seller_id=(SELECT auth.uid()) OR public.is_gambasket_admin())
WITH CHECK (seller_id=(SELECT auth.uid()) OR public.is_gambasket_admin());

-- Protect affiliate records; browser reads are limited to the user's own records.
DO $drop_affiliate_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname,tablename FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('affiliate_profiles','affiliate_attributions','affiliate_conversions','affiliate_payout_requests')
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,p.tablename); END LOOP;
END;
$drop_affiliate_policies$;
REVOKE ALL ON public.affiliate_profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.affiliate_profiles TO authenticated;
CREATE POLICY affiliate_profiles_read_own_admin ON public.affiliate_profiles FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_affiliate_admin() OR public.is_gambasket_admin());
CREATE POLICY affiliate_profiles_update_own_admin ON public.affiliate_profiles FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_affiliate_admin() OR public.is_gambasket_admin())
WITH CHECK (user_id=(SELECT auth.uid()) OR public.is_affiliate_admin() OR public.is_gambasket_admin());
REVOKE ALL ON public.affiliate_attributions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.affiliate_attributions TO authenticated;
CREATE POLICY affiliate_attributions_read_own_admin ON public.affiliate_attributions FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_affiliate_admin() OR public.is_gambasket_admin());
REVOKE ALL ON public.affiliate_conversions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.affiliate_conversions TO authenticated;
CREATE POLICY affiliate_conversions_read_own_admin ON public.affiliate_conversions FOR SELECT TO authenticated
USING (public.is_affiliate_admin() OR public.is_gambasket_admin() OR buyer_id=(SELECT auth.uid())
 OR EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE ap.id=affiliate_conversions.affiliate_id AND ap.user_id=(SELECT auth.uid())));
REVOKE ALL ON public.affiliate_payout_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.affiliate_payout_requests TO authenticated;
CREATE POLICY affiliate_payouts_read_own_admin ON public.affiliate_payout_requests FOR SELECT TO authenticated
USING (public.is_affiliate_admin() OR public.is_gambasket_admin()
 OR EXISTS (SELECT 1 FROM public.affiliate_profiles ap WHERE ap.id=affiliate_payout_requests.affiliate_id AND ap.user_id=(SELECT auth.uid())));

-- Operations center reads its own queues, but only secure RPCs can moderate/resolve them.
DO $drop_ops_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname,tablename FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('worker_applications','reports','marketplace_reviews','earning_transactions','roles','permissions','role_permissions')
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,p.tablename); END LOOP;
END;
$drop_ops_policies$;
REVOKE ALL ON public.worker_applications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.worker_applications TO authenticated;
CREATE POLICY worker_applications_select_self_moderator_admin ON public.worker_applications FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin()
 OR public.has_role((SELECT auth.uid()),'marketplace_worker'::character varying));
CREATE POLICY worker_applications_insert_self ON public.worker_applications FOR INSERT TO authenticated
WITH CHECK (user_id=(SELECT auth.uid()));
REVOKE ALL ON public.reports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.reports TO authenticated;
CREATE POLICY reports_select_moderator_admin ON public.reports FOR SELECT TO authenticated
USING (public.is_gambasket_admin() OR public.has_role((SELECT auth.uid()),'marketplace_worker'::character varying));
REVOKE ALL ON public.marketplace_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.marketplace_reviews TO anon,authenticated;
CREATE POLICY marketplace_reviews_public_read_published ON public.marketplace_reviews FOR SELECT TO anon,authenticated
USING (status='published' OR buyer_id=(SELECT auth.uid()) OR public.is_gambasket_admin());
REVOKE ALL ON public.earning_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.earning_transactions TO authenticated;
CREATE POLICY earning_transactions_read_owner_admin ON public.earning_transactions FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());
REVOKE ALL ON public.roles,public.permissions,public.role_permissions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.roles,public.permissions,public.role_permissions TO authenticated;
CREATE POLICY roles_read_authenticated ON public.roles FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY permissions_read_authenticated ON public.permissions FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY role_permissions_read_authenticated ON public.role_permissions FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);

-- Profile bootstrap is safe for existing OAuth users and never accepts a target user ID.
CREATE OR REPLACE FUNCTION public.bootstrap_my_profile()
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE u auth.users%ROWTYPE; p public.profiles%ROWTYPE; f text; l text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO u FROM auth.users WHERE id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Authenticated user not found'; END IF;
 f:=COALESCE(NULLIF(trim(u.raw_user_meta_data->>'first_name'),''),NULLIF(trim(u.raw_user_meta_data->>'given_name'),''),
   NULLIF(split_part(COALESCE(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',''),' ',1),''),'User');
 l:=COALESCE(NULLIF(trim(u.raw_user_meta_data->>'last_name'),''),NULLIF(trim(u.raw_user_meta_data->>'family_name'),''),
   NULLIF(trim(substr(COALESCE(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',''),length(f)+1)),''),'');
 INSERT INTO public.profiles(id,first_name,last_name,email,phone,country,region,area,avatar_url)
 VALUES(u.id,f,l,u.email,NULLIF(u.raw_user_meta_data->>'phone',''),'The Gambia',
   COALESCE(NULLIF(u.raw_user_meta_data->>'region',''),'Greater Banjul'),
   COALESCE(u.raw_user_meta_data->>'area',''),
   COALESCE(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture'))
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.user_roles(user_id,role_id,is_active) VALUES(u.id,'buyer',true)
 ON CONFLICT(user_id,role_id) DO NOTHING;
 SELECT * INTO p FROM public.profiles WHERE id=u.id;
 RETURN p;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.save_my_store(
 p_name text,p_description text DEFAULT NULL,p_category text DEFAULT NULL,
 p_logo_url text DEFAULT NULL,p_banner_url text DEFAULT NULL,p_location text DEFAULT NULL,p_phone text DEFAULT NULL
)
RETURNS public.stores LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE u uuid:=auth.uid(); s public.stores%ROWTYPE;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT public.is_gambasket_admin() AND NOT public.has_role(u,'seller'::character varying) THEN RAISE EXCEPTION 'Seller role required'; END IF;
 IF NULLIF(trim(p_name),'') IS NULL OR length(trim(p_name))>120 THEN RAISE EXCEPTION 'Store name is required and must be under 120 characters'; END IF;
 SELECT * INTO s FROM public.stores WHERE seller_id=u FOR UPDATE;
 IF FOUND THEN
   UPDATE public.stores SET name=trim(p_name),description=NULLIF(trim(p_description),''),
     category=NULLIF(trim(p_category),''),logo_url=NULLIF(trim(p_logo_url),''),
     banner_url=NULLIF(trim(p_banner_url),''),location=NULLIF(trim(p_location),''),
     phone=NULLIF(trim(p_phone),''),updated_at=now()
   WHERE id=s.id RETURNING * INTO s;
 ELSE
   INSERT INTO public.stores(seller_id,name,description,category,logo_url,banner_url,location,phone,is_active)
   VALUES(u,trim(p_name),NULLIF(trim(p_description),''),NULLIF(trim(p_category),''),
    NULLIF(trim(p_logo_url),''),NULLIF(trim(p_banner_url),''),NULLIF(trim(p_location),''),NULLIF(trim(p_phone),''),true)
   RETURNING * INTO s;
 END IF;
 RETURN s;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE o public.orders%ROWTYPE; old_status text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO o FROM public.orders
 WHERE buyer_id=auth.uid() AND (order_number=p_order_number OR id::text=p_order_number) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
 IF o.order_status NOT IN ('pending','confirmed') THEN RAISE EXCEPTION 'This order can no longer be cancelled by the buyer'; END IF;
 old_status:=o.order_status;
 UPDATE public.orders SET order_status='cancelled',cancellation_reason='Cancelled by buyer',updated_at=now()
 WHERE id=o.id RETURNING * INTO o;
 INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,notes)
 VALUES(o.id,old_status,'cancelled',auth.uid(),'Buyer cancelled order');
 RETURN jsonb_build_object('id',o.id,'order_number',o.order_number,'order_status',o.order_status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.seller_update_order_status(p_order_id uuid,p_next_status text,p_reason text DEFAULT NULL)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE o public.orders%ROWTYPE; old_status text; ok boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
 IF NOT public.is_gambasket_admin() AND (o.seller_id IS DISTINCT FROM auth.uid()
   OR NOT public.has_role(auth.uid(),'seller'::character varying)) THEN RAISE EXCEPTION 'Seller access required'; END IF;
 old_status:=o.order_status;
 ok:=CASE old_status
   WHEN 'pending' THEN p_next_status IN ('confirmed','cancelled')
   WHEN 'confirmed' THEN p_next_status IN ('processing','cancelled')
   WHEN 'processing' THEN p_next_status IN ('ready_for_pickup','ready_for_delivery','delivery_assigned','out_for_delivery','cancelled')
   WHEN 'ready_for_delivery' THEN p_next_status IN ('delivery_assigned','out_for_delivery','cancelled')
   WHEN 'delivery_assigned' THEN p_next_status IN ('picked_up','out_for_delivery','cancelled')
   WHEN 'ready_for_pickup' THEN p_next_status IN ('completed','delivered','cancelled')
   WHEN 'picked_up' THEN p_next_status IN ('out_for_delivery','delivered')
   WHEN 'out_for_delivery' THEN p_next_status IN ('delivered','cancelled')
   WHEN 'delivered' THEN p_next_status='completed'
   ELSE false END;
 IF NOT COALESCE(ok,false) THEN RAISE EXCEPTION 'Invalid order status transition: % -> %',old_status,p_next_status; END IF;
 IF p_next_status='cancelled' THEN p_reason:=COALESCE(NULLIF(trim(p_reason),''),'Cancelled by seller'); END IF;
 UPDATE public.orders SET order_status=p_next_status,
   cancellation_reason=CASE WHEN p_next_status='cancelled' THEN p_reason ELSE cancellation_reason END,updated_at=now()
 WHERE id=p_order_id RETURNING * INTO o;
 INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,notes)
 VALUES(p_order_id,old_status,p_next_status,auth.uid(),NULLIF(trim(p_reason),''));
 RETURN o;
END;
$fn$;

DROP FUNCTION IF EXISTS public.claim_delivery_job(uuid,uuid);
CREATE OR REPLACE FUNCTION public.claim_delivery_job(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE u uuid:=auth.uid(); r public.delivery_requests%ROWTYPE; buyer uuid;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT public.has_role(u,'delivery_worker'::character varying) THEN RAISE EXCEPTION 'Delivery-worker role required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.delivery_profiles dp WHERE dp.user_id=u AND dp.is_verified=true AND dp.status='available') THEN
   RAISE EXCEPTION 'A verified, available courier profile is required';
 END IF;
 SELECT * INTO r FROM public.delivery_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery request not found'; END IF;
 IF r.status<>'pending' OR r.assigned_worker_id IS NOT NULL THEN RAISE EXCEPTION 'Delivery request is no longer available'; END IF;
 UPDATE public.delivery_requests SET status='assigned',assigned_worker_id=u,assigned_at=now(),updated_at=now()
 WHERE id=p_request_id RETURNING * INTO r;
 UPDATE public.orders SET order_status='delivery_assigned',updated_at=now() WHERE id=r.order_id;
 UPDATE public.delivery_profiles SET status='delivering',updated_at=now() WHERE user_id=u;
 INSERT INTO public.delivery_status_history(delivery_request_id,status,updated_by,notes)
 VALUES(p_request_id,'assigned',u,'Claimed by the assigned delivery worker');
 SELECT buyer_id INTO buyer FROM public.orders WHERE id=r.order_id;
 IF buyer IS NOT NULL THEN
   INSERT INTO public.notifications(user_id,type,title,message,data)
   VALUES(buyer,'delivery','Delivery driver assigned','A verified delivery driver has accepted your order.',
    jsonb_build_object('order_id',r.order_id,'delivery_request_id',p_request_id));
 END IF;
 RETURN jsonb_build_object('success',true,'message','Delivery job assigned successfully','order_id',r.order_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.update_delivery_job_status(p_request_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE u uuid:=auth.uid(); r public.delivery_requests%ROWTYPE; o public.orders%ROWTYPE; old_order_status text; old_status text;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO r FROM public.delivery_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Delivery request not found'; END IF;
 IF r.assigned_worker_id IS DISTINCT FROM u THEN RAISE EXCEPTION 'Only the assigned courier may update this delivery'; END IF;
 old_status:=r.status;
 IF NOT ((old_status='assigned' AND p_status='picked_up')
    OR (old_status='picked_up' AND p_status='out_for_delivery')
    OR (old_status='out_for_delivery' AND p_status='delivered')) THEN
   RAISE EXCEPTION 'Invalid delivery status transition: % -> %',old_status,p_status;
 END IF;
 SELECT order_status INTO old_order_status FROM public.orders WHERE id=r.order_id;
 UPDATE public.delivery_requests SET status=p_status,
  picked_up_at=CASE WHEN p_status='picked_up' THEN now() ELSE picked_up_at END,
  out_for_delivery_at=CASE WHEN p_status='out_for_delivery' THEN now() ELSE out_for_delivery_at END,
  delivered_at=CASE WHEN p_status='delivered' THEN now() ELSE delivered_at END,updated_at=now()
 WHERE id=p_request_id RETURNING * INTO r;
 UPDATE public.orders SET order_status=p_status,updated_at=now() WHERE id=r.order_id RETURNING * INTO o;
 INSERT INTO public.delivery_status_history(delivery_request_id,status,updated_by,notes)
 VALUES(p_request_id,p_status,u,'Updated by the assigned delivery worker');
 INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,notes)
 VALUES(r.order_id,old_order_status,o.order_status,u,'Delivery status updated');
 IF p_status='delivered' THEN
   INSERT INTO public.earning_transactions(user_id,role_name,action_type,reference_id,amount,currency,status,description)
   SELECT u,'delivery_worker','delivery_completed',p_request_id::text,GREATEST(COALESCE(r.estimated_fee,0),0),
     'GMD','available','Completed delivery '||COALESCE(o.order_number,p_request_id::text)
   WHERE NOT EXISTS(SELECT 1 FROM public.earning_transactions et WHERE et.user_id=u
    AND et.role_name='delivery_worker' AND et.action_type='delivery_completed' AND et.reference_id=p_request_id::text);
   UPDATE public.delivery_profiles SET status='available',
    total_completed_deliveries=COALESCE(total_completed_deliveries,0)+1,updated_at=now() WHERE user_id=u;
   IF o.buyer_id IS NOT NULL THEN
     INSERT INTO public.notifications(user_id,type,title,message,data)
     VALUES(o.buyer_id,'delivery','Order delivered','Your GamBasket order has been marked as delivered.',
       jsonb_build_object('order_id',o.id,'delivery_request_id',p_request_id));
   END IF;
 END IF;
 RETURN jsonb_build_object('success',true,'status',p_status,'request_id',p_request_id);
END;
$fn$;

DROP FUNCTION IF EXISTS public.submit_marketplace_review(uuid,uuid,uuid,integer,character varying,text);
CREATE OR REPLACE FUNCTION public.submit_marketplace_review(
 p_order_id uuid,p_product_id uuid,p_rating integer,p_title character varying DEFAULT NULL,p_body text DEFAULT NULL,p_seller_id uuid DEFAULT NULL
)
RETURNS public.marketplace_reviews LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE o public.orders%ROWTYPE; i public.order_items%ROWTYPE; result public.marketplace_reviews%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF p_rating IS NULL OR p_rating<1 OR p_rating>5 THEN RAISE EXCEPTION 'Rating must be between 1 and 5'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id AND buyer_id=auth.uid() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only the buyer who owns this order can review it'; END IF;
 IF o.order_status NOT IN ('delivered','completed') THEN RAISE EXCEPTION 'Reviews are available after delivery is completed'; END IF;
 SELECT * INTO i FROM public.order_items WHERE order_id=p_order_id AND product_id=p_product_id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'The product is not part of this order'; END IF;
 IF p_seller_id IS NOT NULL AND p_seller_id IS DISTINCT FROM o.seller_id THEN RAISE EXCEPTION 'Seller does not match the order'; END IF;
 IF EXISTS(SELECT 1 FROM public.marketplace_reviews WHERE order_id=p_order_id AND product_id=p_product_id AND buyer_id=auth.uid()) THEN
   RAISE EXCEPTION 'You have already reviewed this product';
 END IF;
 INSERT INTO public.marketplace_reviews(order_id,product_id,buyer_id,seller_id,rating,title,body,status)
 VALUES(p_order_id,p_product_id,auth.uid(),o.seller_id,p_rating,NULLIF(trim(p_title),''),NULLIF(trim(p_body),''),'published')
 RETURNING * INTO result;
 RETURN result;
END;
$fn$;
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_reviews_order_product_buyer_uidx
ON public.marketplace_reviews(order_id,product_id,buyer_id)
WHERE order_id IS NOT NULL AND product_id IS NOT NULL AND buyer_id IS NOT NULL;

-- Repair affiliate RPC signatures to match the browser client and live table columns.
CREATE OR REPLACE FUNCTION public.get_or_create_affiliate_profile()
RETURNS public.affiliate_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$ BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 RETURN public.get_or_create_affiliate();
END; $fn$;

CREATE OR REPLACE FUNCTION public.attach_affiliate_attribution(p_visitor_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE affected uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NULLIF(trim(p_visitor_token),'') IS NULL THEN RETURN false; END IF;
 UPDATE public.affiliate_attributions SET user_id=auth.uid()
 WHERE id=(SELECT a.id FROM public.affiliate_attributions a
   WHERE a.visitor_id=p_visitor_token AND a.expires_at>now()
   AND (a.user_id IS NULL OR a.user_id=auth.uid())
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_profiles ap WHERE ap.id=a.affiliate_id AND ap.user_id=auth.uid())
   ORDER BY a.created_at DESC LIMIT 1)
 RETURNING id INTO affected;
 RETURN affected IS NOT NULL;
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_current_affiliate_attribution(p_visitor_token text)
RETURNS TABLE(affiliate_id uuid,affiliate_link_id uuid,product_id uuid,created_at timestamptz,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT a.affiliate_id,a.affiliate_link_id,a.product_id,a.created_at,a.expires_at
 FROM public.affiliate_attributions a
 WHERE auth.uid() IS NOT NULL AND a.expires_at>now()
 AND (a.user_id=auth.uid() OR (a.visitor_id=p_visitor_token AND a.user_id IS NULL))
 ORDER BY a.created_at DESC LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.get_affiliate_attribution(p_visitor_id character varying DEFAULT NULL)
RETURNS TABLE(affiliate_id uuid,affiliate_link_id uuid,product_id uuid,created_at timestamptz,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT a.affiliate_id,a.affiliate_link_id,a.product_id,a.created_at,a.expires_at
 FROM public.affiliate_attributions a
 WHERE auth.uid() IS NOT NULL AND a.user_id=auth.uid() AND a.expires_at>now()
 ORDER BY a.created_at DESC LIMIT 1;
$fn$;

DROP FUNCTION IF EXISTS public.record_affiliate_click(character varying,uuid,uuid,character varying,text);
CREATE OR REPLACE FUNCTION public.record_affiliate_click(
 p_affiliate_code character varying,p_product_id uuid DEFAULT NULL,p_visitor_token text DEFAULT NULL,
 p_link_id uuid DEFAULT NULL,p_landing_page text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE ap public.affiliate_profiles%ROWTYPE; u uuid:=auth.uid(); days integer; expiry timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.affiliate_settings WHERE id=true AND enabled=true) THEN RETURN false; END IF;
 SELECT * INTO ap FROM public.affiliate_profiles WHERE affiliate_code=upper(trim(p_affiliate_code)) AND status='active';
 IF NOT FOUND THEN RETURN false; END IF;
 IF u IS NOT NULL AND ap.user_id=u THEN RETURN false; END IF;
 IF p_link_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.affiliate_links al WHERE al.id=p_link_id AND al.affiliate_id=ap.id
   AND (p_product_id IS NULL OR al.product_id=p_product_id)) THEN RETURN false; END IF;
 IF p_product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=p_product_id AND p.status='approved') THEN RETURN false; END IF;
 SELECT attribution_days INTO days FROM public.affiliate_settings WHERE id=true;
 expiry:=now()+make_interval(days=>GREATEST(COALESCE(days,30),1));
 PERFORM set_config('app.gambasket_internal','on',true);
 INSERT INTO public.affiliate_clicks(affiliate_id,affiliate_link_id,product_id,visitor_id,user_id,landing_page)
 VALUES(ap.id,p_link_id,p_product_id,NULLIF(trim(p_visitor_token),''),u,left(p_landing_page,1000));
 UPDATE public.affiliate_profiles SET total_clicks=COALESCE(total_clicks,0)+1,updated_at=now() WHERE id=ap.id;
 IF p_link_id IS NOT NULL THEN
   UPDATE public.affiliate_links SET clicks=COALESCE(clicks,0)+1,last_clicked_at=now() WHERE id=p_link_id AND affiliate_id=ap.id;
 END IF;
 INSERT INTO public.affiliate_attributions(affiliate_id,affiliate_link_id,visitor_id,user_id,product_id,expires_at)
 VALUES(ap.id,p_link_id,NULLIF(trim(p_visitor_token),''),u,p_product_id,expiry);
 RETURN true;
END; $fn$;

CREATE OR REPLACE FUNCTION public.register_affiliate_attribution(
 p_affiliate_id uuid,p_affiliate_link_id uuid DEFAULT NULL,p_product_id uuid DEFAULT NULL,p_visitor_token text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.affiliate_profiles ap WHERE ap.id=p_affiliate_id AND ap.user_id=auth.uid() AND ap.status='active') THEN
   RAISE EXCEPTION 'Affiliate account not available';
 END IF;
 IF p_affiliate_link_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.affiliate_links al WHERE al.id=p_affiliate_link_id AND al.affiliate_id=p_affiliate_id
   AND (p_product_id IS NULL OR al.product_id=p_product_id)) THEN RAISE EXCEPTION 'Affiliate link does not belong to this account'; END IF;
 INSERT INTO public.affiliate_attributions(affiliate_id,affiliate_link_id,product_id,visitor_id,user_id,expires_at)
 VALUES(p_affiliate_id,p_affiliate_link_id,p_product_id,NULLIF(trim(p_visitor_token),''),auth.uid(),now()+interval '30 days');
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_my_affiliate_links()
RETURNS TABLE(id uuid,product_id uuid,product_title text,price numeric,currency character varying,main_image text,clicks integer,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE aid uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT id INTO aid FROM public.affiliate_profiles WHERE user_id=auth.uid();
 IF aid IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT al.id,al.product_id,p.title::text,p.price,p.currency,p.main_image,COALESCE(al.clicks,0),al.created_at
 FROM public.affiliate_links al JOIN public.products p ON p.id=al.product_id WHERE al.affiliate_id=aid ORDER BY al.created_at DESC;
END; $fn$;

CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE ap public.affiliate_profiles%ROWTYPE; approved numeric; reserved numeric;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO ap FROM public.affiliate_profiles WHERE user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Affiliate account not found'; END IF;
 SELECT COALESCE(sum(commission_amount),0) INTO approved FROM public.affiliate_conversions WHERE affiliate_id=ap.id AND status='approved';
 SELECT COALESCE(sum(amount),0) INTO reserved FROM public.affiliate_payout_requests WHERE affiliate_id=ap.id AND status IN ('pending','approved','paid');
 RETURN jsonb_build_object('affiliate_id',ap.id,'affiliate_code',ap.affiliate_code,'status',ap.status,
  'total_clicks',COALESCE(ap.total_clicks,0),'total_orders',COALESCE(ap.total_orders,0),
  'total_sales',COALESCE(ap.total_sales,0),'total_commission',COALESCE(ap.total_commission,0),
  'approved_commission',approved,'reserved_payouts',reserved,'available_balance',GREATEST(approved-reserved,0));
END; $fn$;

DROP FUNCTION IF EXISTS public.record_affiliate_conversion(uuid,character varying,character varying);
CREATE OR REPLACE FUNCTION public.record_affiliate_conversion(
 p_order_id uuid,p_affiliate_code character varying DEFAULT NULL,p_visitor_token text DEFAULT NULL
)
RETURNS public.affiliate_conversions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE u uuid:=auth.uid(); o public.orders%ROWTYPE; ap public.affiliate_profiles%ROWTYPE;
 a public.affiliate_attributions%ROWTYPE; c public.affiliate_conversions%ROWTYPE; rate numeric(5,2); fee numeric(14,2);
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id AND buyer_id=u FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only the buyer who owns this order can attribute it'; END IF;
 IF o.order_status='cancelled' OR o.payment_status IN ('failed','refunded') THEN RAISE EXCEPTION 'Cancelled, failed or refunded orders cannot earn commission'; END IF;
 SELECT * INTO c FROM public.affiliate_conversions WHERE order_id=p_order_id;
 IF FOUND THEN RETURN c; END IF;
 IF NULLIF(trim(p_affiliate_code),'') IS NOT NULL THEN
   SELECT * INTO ap FROM public.affiliate_profiles WHERE affiliate_code=upper(trim(p_affiliate_code)) AND status='active';
 END IF;
 IF ap.id IS NULL THEN
   SELECT * INTO a FROM public.affiliate_attributions
   WHERE expires_at>now() AND (user_id=u OR (NULLIF(trim(p_visitor_token),'') IS NOT NULL AND visitor_id=p_visitor_token AND (user_id IS NULL OR user_id=u)))
   ORDER BY created_at DESC LIMIT 1;
   IF a.id IS NOT NULL THEN SELECT * INTO ap FROM public.affiliate_profiles WHERE id=a.affiliate_id AND status='active'; END IF;
 END IF;
 IF ap.id IS NULL THEN RAISE EXCEPTION 'No active affiliate attribution found'; END IF;
 IF ap.user_id=u THEN RAISE EXCEPTION 'Self-referral is not allowed'; END IF;
 SELECT default_commission_rate INTO rate FROM public.affiliate_settings WHERE id=true AND enabled=true;
 IF rate IS NULL OR rate<0 OR rate>100 THEN rate:=5; END IF;
 fee:=round(GREATEST(COALESCE(o.total,0),0)*rate/100,2);
 PERFORM set_config('app.gambasket_internal','on',true);
 INSERT INTO public.affiliate_conversions(affiliate_id,affiliate_link_id,order_id,buyer_id,sale_amount,commission_rate,commission_amount,status)
 VALUES(ap.id,COALESCE(a.affiliate_link_id,
   (SELECT al.id FROM public.affiliate_links al WHERE al.affiliate_id=ap.id AND al.product_id IN
    (SELECT oi.product_id FROM public.order_items oi WHERE oi.order_id=p_order_id) ORDER BY al.created_at DESC LIMIT 1)),
   p_order_id,u,COALESCE(o.total,0),rate,fee,'pending')
 ON CONFLICT(order_id) DO NOTHING RETURNING * INTO c;
 IF c.id IS NULL THEN SELECT * INTO c FROM public.affiliate_conversions WHERE order_id=p_order_id; RETURN c; END IF;
 UPDATE public.orders SET affiliate_id=ap.id,affiliate_link_id=c.affiliate_link_id,affiliate_commission=fee,
  affiliate_commission_rate=rate,affiliate_commission_status='pending' WHERE id=p_order_id AND buyer_id=u;
 UPDATE public.affiliate_profiles SET total_orders=COALESCE(total_orders,0)+1,total_sales=COALESCE(total_sales,0)+COALESCE(o.total,0),
  total_commission=COALESCE(total_commission,0)+fee,updated_at=now() WHERE id=ap.id;
 RETURN c;
END; $fn$;

CREATE OR REPLACE FUNCTION public.admin_approve_commission(p_conversion_id uuid)
RETURNS public.affiliate_conversions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE c public.affiliate_conversions%ROWTYPE;
BEGIN
 IF NOT public.is_affiliate_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
 UPDATE public.affiliate_conversions ac SET status='approved',approved_at=now(),rejection_reason=NULL
 FROM public.orders o
 WHERE ac.id=p_conversion_id AND ac.order_id=o.id AND ac.status='pending'
 AND o.payment_status='paid' AND o.order_status<>'cancelled'
 RETURNING ac.* INTO c;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Commission is missing, already reviewed or the order has not been paid'; END IF;
 UPDATE public.orders SET affiliate_commission_status='approved',affiliate_approved_at=now(),updated_at=now() WHERE id=c.order_id;
 RETURN c;
END; $fn$;

CREATE OR REPLACE FUNCTION public.admin_mark_affiliate_payout_paid(p_payout_id uuid)
RETURNS public.affiliate_payout_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE p public.affiliate_payout_requests%ROWTYPE;
BEGIN
 IF NOT public.is_affiliate_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
 SELECT * INTO p FROM public.affiliate_payout_requests WHERE id=p_payout_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payout not found'; END IF;
 IF p.status NOT IN ('approved','pending') THEN RAISE EXCEPTION 'Payout cannot be marked paid from its current state'; END IF;
 UPDATE public.affiliate_payout_requests SET status='paid',paid_at=now(),updated_at=now()
 WHERE id=p_payout_id RETURNING * INTO p;
 RETURN p;
END; $fn$;

CREATE OR REPLACE FUNCTION public.request_affiliate_payout(p_amount numeric,p_payment_method character varying,p_payment_account character varying)
RETURNS public.affiliate_payout_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE ap public.affiliate_profiles%ROWTYPE; minimum_amount numeric; approved numeric; reserved numeric; available numeric; result public.affiliate_payout_requests%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Payout amount must be positive'; END IF;
 IF NULLIF(trim(p_payment_account),'') IS NULL THEN RAISE EXCEPTION 'A payment account is required'; END IF;
 IF p_payment_method NOT IN ('wave','qmoney','afrimoney','bank_transfer') THEN RAISE EXCEPTION 'Unsupported payout method'; END IF;
 SELECT * INTO ap FROM public.affiliate_profiles WHERE user_id=auth.uid() AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active affiliate account not found'; END IF;
 SELECT minimum_payout INTO minimum_amount FROM public.affiliate_settings WHERE id=true AND enabled=true;
 IF minimum_amount IS NULL THEN RAISE EXCEPTION 'Affiliate payouts are currently disabled'; END IF;
 SELECT COALESCE(sum(commission_amount),0) INTO approved FROM public.affiliate_conversions WHERE affiliate_id=ap.id AND status='approved';
 SELECT COALESCE(sum(amount),0) INTO reserved FROM public.affiliate_payout_requests
 WHERE affiliate_id=ap.id AND status IN ('pending','approved','paid');
 available:=GREATEST(approved-reserved,0);
 IF p_amount<minimum_amount THEN RAISE EXCEPTION 'Minimum payout is D %',minimum_amount; END IF;
 IF p_amount>available THEN RAISE EXCEPTION 'Available balance is only D %',available; END IF;
 INSERT INTO public.affiliate_payout_requests(affiliate_id,amount,payment_method,payment_account,status)
 VALUES(ap.id,p_amount,p_payment_method,left(trim(p_payment_account),250),'pending') RETURNING * INTO result;
 RETURN result;
END; $fn$;

CREATE OR REPLACE FUNCTION public.admin_set_verification(p_request_id uuid,p_status character varying,p_notes text DEFAULT NULL)
RETURNS public.verification_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE r public.verification_requests%ROWTYPE;
BEGIN
 IF NOT public.is_gambasket_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
 IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid verification status'; END IF;
 SELECT * INTO r FROM public.verification_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verification request not found'; END IF;
 IF r.role_type NOT IN ('seller','supplier') THEN RAISE EXCEPTION 'Only seller and supplier verification requests can assign roles'; END IF;
 UPDATE public.verification_requests SET status=p_status,reviewed_at=now(),reviewed_by=auth.uid(),review_notes=p_notes
 WHERE id=p_request_id RETURNING * INTO r;
 IF p_status='approved' THEN
   INSERT INTO public.user_roles(user_id,role_id,assigned_by,is_active) VALUES(r.user_id,r.role_type,auth.uid(),true)
   ON CONFLICT(user_id,role_id) DO UPDATE SET is_active=true,assigned_by=auth.uid();
   IF r.role_type='seller' THEN UPDATE public.seller_profiles SET verification_status='verified',updated_at=now() WHERE user_id=r.user_id;
   ELSE UPDATE public.supplier_profiles SET verification_status='verified',updated_at=now() WHERE user_id=r.user_id; END IF;
 ELSE
   IF r.role_type='seller' THEN UPDATE public.seller_profiles SET verification_status='rejected',updated_at=now() WHERE user_id=r.user_id;
   ELSE UPDATE public.supplier_profiles SET verification_status='rejected',updated_at=now() WHERE user_id=r.user_id; END IF;
 END IF;
 INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
 VALUES(auth.uid(),'verification_'||p_status,'verification_request',r.id,jsonb_build_object('role',r.role_type,'user_id',r.user_id));
 RETURN r;
END; $fn$;

-- Store reports in the table the operations center actually reads.
DROP FUNCTION IF EXISTS public.create_trust_report(uuid,uuid,uuid,character varying,text,text);
CREATE OR REPLACE FUNCTION public.create_trust_report(
 p_target_user_id uuid DEFAULT NULL,p_target_product_id uuid DEFAULT NULL,p_target_store_id uuid DEFAULT NULL,
 p_report_type character varying DEFAULT 'other',p_reason text DEFAULT '',p_evidence text DEFAULT NULL
)
RETURNS public.reports LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE target_type text; target_id uuid; r public.reports%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A report reason is required'; END IF;
 IF p_target_product_id IS NOT NULL THEN target_type:='product'; target_id:=p_target_product_id;
 ELSIF p_target_store_id IS NOT NULL THEN
   target_type:='seller'; SELECT seller_id INTO target_id FROM public.stores WHERE id=p_target_store_id;
   IF target_id IS NULL THEN target_id:=p_target_store_id; END IF;
 ELSIF p_target_user_id IS NOT NULL THEN target_type:='user'; target_id:=p_target_user_id;
 ELSE RAISE EXCEPTION 'Choose a product, store or user to report'; END IF;
 INSERT INTO public.reports(reporter_id,target_type,target_id,reason,description,status)
 VALUES(auth.uid(),target_type,target_id,left(COALESCE(NULLIF(trim(p_report_type),''),'other')||': '||trim(p_reason),200),
  left(trim(p_reason)||CASE WHEN NULLIF(trim(p_evidence),'') IS NOT NULL THEN E'\nEvidence: '||trim(p_evidence) ELSE '' END,5000),'pending')
 RETURNING * INTO r;
 RETURN r;
END; $fn$;

-- Operations workspace RPCs: moderator/admin auth is checked inside each function.
CREATE OR REPLACE FUNCTION public.moderate_product_listing(p_product_id uuid,p_status character varying,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE p public.products%ROWTYPE; reward numeric; currency character varying; description text;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_gambasket_admin() OR public.has_role(auth.uid(),'marketplace_worker'::character varying)) THEN
  RAISE EXCEPTION 'Marketplace moderation access required';
 END IF;
 IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid moderation decision'; END IF;
 IF p_status='rejected' AND NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
 UPDATE public.products SET status=p_status,rejection_reason=CASE WHEN p_status='rejected' THEN left(trim(p_reason),1000) ELSE NULL END,updated_at=now()
 WHERE id=p_product_id AND status='pending_review' RETURNING * INTO p;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Listing not found or no longer pending review'; END IF;
 INSERT INTO public.activity_logs(actor_id,action,target_type,target_id,metadata)
 VALUES(auth.uid(),'product_'||p_status,'product',p_product_id::text,jsonb_build_object('reason',p_reason,'seller_id',p.seller_id));
 SELECT reward_amount,currency,earning_rules.description INTO reward,currency,description
 FROM public.earning_rules WHERE role_name='marketplace_worker' AND action_type='moderate_product_listing' AND is_active=true;
 IF FOUND AND COALESCE(reward,0)>0 AND NOT EXISTS(SELECT 1 FROM public.earning_transactions WHERE user_id=auth.uid()
   AND role_name='marketplace_worker' AND action_type='moderate_product_listing' AND reference_id=p_product_id::text) THEN
  INSERT INTO public.earning_transactions(user_id,role_name,action_type,reference_id,amount,currency,status,description)
  VALUES(auth.uid(),'marketplace_worker','moderate_product_listing',p_product_id::text,reward,COALESCE(currency,'GMD'),'available',COALESCE(description,'Product listing moderation'));
 END IF;
 RETURN jsonb_build_object('success',true,'product_id',p_product_id,'status',p_status);
END; $fn$;

CREATE OR REPLACE FUNCTION public.review_worker_application(p_application_id uuid,p_status character varying,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE a public.worker_applications%ROWTYPE; reward numeric; currency character varying; description text;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_gambasket_admin() OR public.has_role(auth.uid(),'marketplace_worker'::character varying)) THEN
  RAISE EXCEPTION 'Marketplace moderation access required';
 END IF;
 IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid application decision'; END IF;
 UPDATE public.worker_applications SET status=p_status,reviewed_by=auth.uid(),review_notes=p_notes,updated_at=now()
 WHERE id=p_application_id AND status='pending' RETURNING * INTO a;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Application not found or already reviewed'; END IF;
 INSERT INTO public.activity_logs(actor_id,action,target_type,target_id,metadata)
 VALUES(auth.uid(),'worker_application_'||p_status,'worker_application',p_application_id::text,
 jsonb_build_object('applicant_id',a.user_id,'worker_type',a.worker_type,'notes',p_notes));
 SELECT reward_amount,currency,earning_rules.description INTO reward,currency,description FROM public.earning_rules
 WHERE role_name='marketplace_worker' AND action_type='review_worker_application' AND is_active=true;
 IF FOUND AND COALESCE(reward,0)>0 AND NOT EXISTS(SELECT 1 FROM public.earning_transactions WHERE user_id=auth.uid()
  AND role_name='marketplace_worker' AND action_type='review_worker_application' AND reference_id=p_application_id::text) THEN
  INSERT INTO public.earning_transactions(user_id,role_name,action_type,reference_id,amount,currency,status,description)
  VALUES(auth.uid(),'marketplace_worker','review_worker_application',p_application_id::text,reward,COALESCE(currency,'GMD'),'available',COALESCE(description,'Worker application review'));
 END IF;
 RETURN jsonb_build_object('success',true,'application_id',p_application_id,'status',p_status);
END; $fn$;

CREATE OR REPLACE FUNCTION public.resolve_marketplace_report(p_report_id uuid,p_status character varying,p_resolution text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE r public.reports%ROWTYPE; reward numeric; currency character varying; description text;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_gambasket_admin() OR public.has_role(auth.uid(),'marketplace_worker'::character varying)) THEN
  RAISE EXCEPTION 'Marketplace moderation access required';
 END IF;
 IF p_status NOT IN ('investigating','resolved','dismissed') THEN RAISE EXCEPTION 'Invalid report status'; END IF;
 IF p_status IN ('resolved','dismissed') AND NULLIF(trim(p_resolution),'') IS NULL THEN RAISE EXCEPTION 'A resolution note is required'; END IF;
 UPDATE public.reports SET status=p_status,reviewed_by=auth.uid(),resolution=NULLIF(trim(p_resolution),''),updated_at=now()
 WHERE id=p_report_id AND status IN ('pending','investigating') RETURNING * INTO r;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Report not found or already resolved'; END IF;
 INSERT INTO public.activity_logs(actor_id,action,target_type,target_id,metadata)
 VALUES(auth.uid(),'report_'||p_status,'report',p_report_id::text,jsonb_build_object('target_type',r.target_type,'target_id',r.target_id,'resolution',p_resolution));
 IF p_status IN ('resolved','dismissed') THEN
  SELECT reward_amount,currency,earning_rules.description INTO reward,currency,description FROM public.earning_rules
  WHERE role_name='marketplace_worker' AND action_type='resolve_marketplace_report' AND is_active=true;
  IF FOUND AND COALESCE(reward,0)>0 AND NOT EXISTS(SELECT 1 FROM public.earning_transactions WHERE user_id=auth.uid()
   AND role_name='marketplace_worker' AND action_type='resolve_marketplace_report' AND reference_id=p_report_id::text) THEN
   INSERT INTO public.earning_transactions(user_id,role_name,action_type,reference_id,amount,currency,status,description)
   VALUES(auth.uid(),'marketplace_worker','resolve_marketplace_report',p_report_id::text,reward,COALESCE(currency,'GMD'),'available',COALESCE(description,'Report resolution'));
  END IF;
 END IF;
 RETURN jsonb_build_object('success',true,'report_id',p_report_id,'status',p_status);
END; $fn$;

-- Public notifications may only be read by their owner and updated only to mark read.
DO $drop_notification_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='notifications'
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications',p.policyname); END LOOP;
END;
$drop_notification_policies$;
CREATE OR REPLACE FUNCTION public.guard_notification_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
 IF public.is_gambasket_admin() THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'You may only update your own notifications'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.type IS DISTINCT FROM OLD.type
  OR NEW.title IS DISTINCT FROM OLD.title OR NEW.message IS DISTINCT FROM OLD.message
  OR NEW.data IS DISTINCT FROM OLD.data OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'Notification content is immutable';
 END IF;
 RETURN NEW;
END; $fn$;
DROP TRIGGER IF EXISTS trg_guard_notification_update ON public.notifications;
CREATE TRIGGER trg_guard_notification_update BEFORE UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.guard_notification_update();
REVOKE ALL ON public.notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.notifications TO authenticated;
CREATE POLICY notifications_select_owner ON public.notifications FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());
CREATE POLICY notifications_update_read_state ON public.notifications FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin())
WITH CHECK (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());

-- Direct messages may be sent by authenticated participants, not anonymous clients.
REVOKE INSERT,UPDATE,DELETE ON public.messages FROM PUBLIC,anon;
GRANT SELECT,INSERT ON public.messages TO authenticated;
REVOKE ALL ON public.user_roles FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_roles TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.worker_applications FROM PUBLIC,anon;
GRANT SELECT,INSERT ON public.worker_applications TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.reports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.reports TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.earning_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.earning_transactions TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.affiliate_attributions,public.affiliate_conversions,public.affiliate_payout_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.affiliate_attributions,public.affiliate_conversions,public.affiliate_payout_requests TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.delivery_status_history,public.order_status_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.delivery_status_history,public.order_status_history TO authenticated;

-- Rebuild role catalogue policies without deprecated auth.role().
DROP POLICY IF EXISTS "Roles are viewable by authenticated users" ON public.roles;
DROP POLICY IF EXISTS "Permissions are viewable by authenticated users" ON public.permissions;
DROP POLICY IF EXISTS "Role permissions are viewable by authenticated users" ON public.role_permissions;
DO $drop_role_catalog_policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname,tablename FROM pg_policies WHERE schemaname='public' AND tablename IN ('roles','permissions','role_permissions')
 LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,p.tablename); END LOOP;
END;
$drop_role_catalog_policies$;
REVOKE ALL ON public.roles,public.permissions,public.role_permissions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.roles,public.permissions,public.role_permissions TO authenticated;
CREATE POLICY roles_read_authenticated ON public.roles FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY permissions_read_authenticated ON public.permissions FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY role_permissions_read_authenticated ON public.role_permissions FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);

-- Lock down any SECURITY DEFINER function that otherwise inherits PUBLIC execution.
DO $revoke_definer$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
 LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature); END LOOP;
END;
$revoke_definer$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid,character varying) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid,character varying) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_gambasket_admin() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_affiliate_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_store(text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_update_order_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,character varying,text,character varying,character varying,character varying,text,character varying,character varying) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_delivery_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_delivery_job_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_product_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_marketplace_review(uuid,uuid,integer,character varying,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_trust_report(uuid,uuid,uuid,character varying,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_seller_promotion(character varying,text,character varying,numeric,numeric,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_affiliate_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_affiliate_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_affiliate_attribution(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_affiliate_attribution(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_affiliate_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_affiliate_conversion(uuid,character varying,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_affiliate_payout(numeric,character varying,character varying) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_affiliate_attribution(character varying) TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_product_listing(uuid,character varying,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_worker_application(uuid,character varying,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_marketplace_report(uuid,character varying,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_affiliate_click(character varying,uuid,text,uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(character varying,numeric) TO anon,authenticated;

-- Admin routines are individually guarded in their bodies.
DO $grant_admin$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef AND p.proname LIKE 'admin\_%' ESCAPE '\'
 LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END LOOP;
END;
$grant_admin$;

COMMIT;
