-- Stage A/B: close image exposure, enable multiple photos, category attributes,
-- saved searches, comparison metadata, and moderated price-drop alerts.
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='products_attributes_object_chk'
      AND conrelid='public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_attributes_object_chk
      CHECK (jsonb_typeof(attributes)='object' AND pg_column_size(attributes)<=8192) NOT VALID;
  END IF;
END
$constraint$;
ALTER TABLE public.products VALIDATE CONSTRAINT products_attributes_object_chk;

CREATE OR REPLACE FUNCTION public.guard_product_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
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
    NEW.status:='pending_review';
    NEW.rejection_reason:=NULL;
    NEW.is_featured:=false;
    NEW.featured_until:=NULL;
    NEW.views_count:=0;
    NEW.sales_count:=0;
    NEW.verification_status:='unverified';
    RETURN NEW;
  END IF;

  IF current_setting('app.gambasket_internal',true)='on'
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.seller_id IS NOT DISTINCT FROM OLD.seller_id
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.attributes IS NOT DISTINCT FROM OLD.attributes
     AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.subcategory_id IS NOT DISTINCT FROM OLD.subcategory_id
     AND NEW.condition IS NOT DISTINCT FROM OLD.condition
     AND NEW.location IS NOT DISTINCT FROM OLD.location
     AND NEW.main_image IS NOT DISTINCT FROM OLD.main_image
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason
     AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
     AND NEW.wholesale_price IS NOT DISTINCT FROM OLD.wholesale_price
     AND NEW.minimum_order_quantity IS NOT DISTINCT FROM OLD.minimum_order_quantity
     AND NEW.retail_suggested_price IS NOT DISTINCT FROM OLD.retail_suggested_price
     AND NEW.fulfillment_type IS NOT DISTINCT FROM OLD.fulfillment_type
     AND NEW.listing_type IS NOT DISTINCT FROM OLD.listing_type
     AND NEW.min_order_quantity IS NOT DISTINCT FROM OLD.min_order_quantity
     AND NEW.wholesale_currency IS NOT DISTINCT FROM OLD.wholesale_currency
     AND NEW.wholesale_enabled IS NOT DISTINCT FROM OLD.wholesale_enabled
     AND NEW.featured_until IS NOT DISTINCT FROM OLD.featured_until
     AND NEW.promotion_id IS NOT DISTINCT FROM OLD.promotion_id
     AND NEW.searchable IS NOT DISTINCT FROM OLD.searchable
     AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status
     AND NEW.views_count IS NOT DISTINCT FROM OLD.views_count
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  -- Moderators can change the moderation status/reason only.
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
     AND NEW.wholesale_price IS NOT DISTINCT FROM OLD.wholesale_price
     AND NEW.minimum_order_quantity IS NOT DISTINCT FROM OLD.minimum_order_quantity
     AND NEW.retail_suggested_price IS NOT DISTINCT FROM OLD.retail_suggested_price
     AND NEW.fulfillment_type IS NOT DISTINCT FROM OLD.fulfillment_type
     AND NEW.listing_type IS NOT DISTINCT FROM OLD.listing_type
     AND NEW.min_order_quantity IS NOT DISTINCT FROM OLD.min_order_quantity
     AND NEW.wholesale_currency IS NOT DISTINCT FROM OLD.wholesale_currency
     AND NEW.wholesale_enabled IS NOT DISTINCT FROM OLD.wholesale_enabled
     AND NEW.promotion_id IS NOT DISTINCT FROM OLD.promotion_id
     AND NEW.searchable IS NOT DISTINCT FROM OLD.searchable
     AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
     AND NEW.featured_until IS NOT DISTINCT FROM OLD.featured_until
     AND NEW.views_count IS NOT DISTINCT FROM OLD.views_count
     AND NEW.sales_count IS NOT DISTINCT FROM OLD.sales_count
     AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
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
       OR NEW.attributes IS DISTINCT FROM OLD.attributes
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
       OR NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled
       OR NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type
       OR NEW.promotion_id IS DISTINCT FROM OLD.promotion_id
       OR NEW.searchable IS DISTINCT FROM OLD.searchable THEN
      RAISE EXCEPTION 'Only a seller or validated server operation may change listing fields';
    END IF;

    v_stock_delta:=OLD.stock-NEW.stock;
    v_sales_delta:=NEW.sales_count-OLD.sales_count;
    IF v_stock_delta IS DISTINCT FROM v_sales_delta OR v_stock_delta=0 THEN
      RAISE EXCEPTION 'Inventory changes must represent a matching sale or cancellation';
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
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
     OR NEW.promotion_id IS DISTINCT FROM OLD.promotion_id THEN
    RAISE EXCEPTION 'Moderation, ownership, supplier and counter fields are protected';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'A seller cannot approve or reject a listing';
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.attributes IS DISTINCT FROM OLD.attributes
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
     OR NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled
     OR NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type
     OR NEW.searchable IS DISTINCT FROM OLD.searchable THEN
    NEW.status:='pending_review';
    NEW.rejection_reason:=NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

-- The prior public SELECT policy exposed images of pending/rejected listings.
DROP POLICY IF EXISTS "Product images are viewable by everyone" ON public.product_images;
DROP POLICY IF EXISTS "Sellers can manage product images" ON public.product_images;
DROP POLICY IF EXISTS product_images_public_or_owner_read ON public.product_images;
DROP POLICY IF EXISTS product_images_owner_insert ON public.product_images;
DROP POLICY IF EXISTS product_images_owner_update ON public.product_images;
DROP POLICY IF EXISTS product_images_owner_delete ON public.product_images;

CREATE POLICY product_images_public_or_owner_read
ON public.product_images FOR SELECT TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id=product_images.product_id
      AND (
        p.status='approved'
        OR p.seller_id=(SELECT auth.uid())
        OR public.is_gambasket_admin()
        OR public.has_role((SELECT auth.uid()),'marketplace_worker'::character varying)
      )
  )
);
CREATE POLICY product_images_owner_insert
ON public.product_images FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_images.product_id
    AND (p.seller_id=(SELECT auth.uid()) OR public.is_gambasket_admin()))
  AND image_url ~ '^https?://'
);
CREATE POLICY product_images_owner_update
ON public.product_images FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_images.product_id
  AND (p.seller_id=(SELECT auth.uid()) OR public.is_gambasket_admin())))
WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_images.product_id
  AND (p.seller_id=(SELECT auth.uid()) OR public.is_gambasket_admin()))
  AND image_url ~ '^https?://');
CREATE POLICY product_images_owner_delete
ON public.product_images FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_images.product_id
  AND (p.seller_id=(SELECT auth.uid()) OR public.is_gambasket_admin())));
REVOKE INSERT, UPDATE, DELETE ON public.product_images FROM PUBLIC, anon;
GRANT SELECT ON public.product_images TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_images TO authenticated;

-- Storage uploads work without external Cloudinary credentials. Object names start
-- with the authenticated user's UUID; approved product images are publicly readable.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name=EXCLUDED.name,public=true,file_size_limit=EXCLUDED.file_size_limit,
    allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS gambasket_product_images_public_read ON storage.objects;
DROP POLICY IF EXISTS gambasket_product_images_owner_insert ON storage.objects;
DROP POLICY IF EXISTS gambasket_product_images_owner_update ON storage.objects;
DROP POLICY IF EXISTS gambasket_product_images_owner_delete ON storage.objects;
CREATE POLICY gambasket_product_images_public_read
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id='product-images');
CREATE POLICY gambasket_product_images_owner_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='product-images' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY gambasket_product_images_owner_update
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='product-images' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text)
WITH CHECK (bucket_id='product-images' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY gambasket_product_images_owner_delete
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='product-images' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

-- Category-driven fields are stored as JSON, while field definitions are governed by DB.
CREATE TABLE IF NOT EXISTS public.category_attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id character varying NOT NULL REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE CASCADE,
  attribute_key character varying NOT NULL CHECK (attribute_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label character varying NOT NULL,
  input_type character varying NOT NULL DEFAULT 'text'
    CHECK (input_type IN ('text','number','select','date','checkbox')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options)='array'),
  is_required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(category_id,attribute_key)
);
ALTER TABLE public.category_attribute_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS category_attribute_definitions_public_read ON public.category_attribute_definitions;
CREATE POLICY category_attribute_definitions_public_read
ON public.category_attribute_definitions FOR SELECT TO anon,authenticated
USING (is_active=true);
REVOKE INSERT,UPDATE,DELETE ON public.category_attribute_definitions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.category_attribute_definitions TO anon,authenticated;

INSERT INTO public.category_attribute_definitions
  (category_id,attribute_key,label,input_type,options,is_required,sort_order)
SELECT c.id,v.attribute_key,v.label,v.input_type,v.options::jsonb,v.is_required,v.sort_order
FROM (VALUES
 ('Phones','brand','Brand','text','[]',false,10),
 ('Phones','model','Model','text','[]',true,20),
 ('Phones','storage','Storage','select','["32GB","64GB","128GB","256GB","512GB","1TB"]',false,30),
 ('Phones','colour','Colour','text','[]',false,40),
 ('Phones','battery_health','Battery health (%)','number','[]',false,50),
 ('Phones','network_locked','Network locked?','select','["No","Yes","Unknown"]',false,60),
 ('Electronics','brand','Brand','text','[]',false,10),
 ('Electronics','model','Model','text','[]',false,20),
 ('Electronics','processor','Processor / chipset','text','[]',false,30),
 ('Electronics','ram','RAM','select','["2GB","4GB","8GB","16GB","32GB","64GB"]',false,40),
 ('Electronics','storage','Storage','select','["64GB","128GB","256GB","512GB","1TB","2TB"]',false,50),
 ('Electronics','warranty','Warranty','select','["None","Seller warranty","Manufacturer warranty"]',false,60),
 ('Fashion','brand','Brand','text','[]',false,10),
 ('Fashion','size','Size','text','[]',false,20),
 ('Fashion','colour','Colour','text','[]',false,30),
 ('Fashion','material','Material','text','[]',false,40),
 ('Food','pack_size','Pack size / quantity','text','[]',false,10),
 ('Food','expiry_date','Expiry date','date','[]',false,20),
 ('Food','origin','Origin','text','[]',false,30),
 ('Home','material','Material','text','[]',false,10),
 ('Home','dimensions','Dimensions','text','[]',false,20),
 ('Home','assembly_required','Assembly required?','select','["No","Yes"]',false,30),
 ('Beauty','size','Size / volume','text','[]',false,10),
 ('Beauty','sealed','Factory sealed?','select','["Yes","No"]',false,20),
 ('Beauty','expiry_date','Expiry date','date','[]',false,30),
 ('Solar','power_watts','Power (watts)','number','[]',false,10),
 ('Solar','voltage','Voltage','text','[]',false,20),
 ('Solar','warranty_months','Warranty (months)','number','[]',false,30),
 ('Auto','make','Make','text','[]',false,10),
 ('Auto','model','Model','text','[]',false,20),
 ('Auto','year','Year','number','[]',false,30),
 ('Auto','mileage_km','Mileage (km)','number','[]',false,40),
 ('Auto','transmission','Transmission','select','["Automatic","Manual","Other"]',false,50),
 ('Auto','fuel_type','Fuel type','select','["Petrol","Diesel","Hybrid","Electric","Other"]',false,60),
 ('Hardware','brand','Brand','text','[]',false,10),
 ('Hardware','power_rating','Power / capacity','text','[]',false,20),
 ('Hardware','warranty_months','Warranty (months)','number','[]',false,30),
 ('Baby','age_range','Recommended age','text','[]',false,10),
 ('Baby','material','Material','text','[]',false,20),
 ('Sports','sport_type','Sport / activity','text','[]',false,10),
 ('Sports','size','Size','text','[]',false,20),
 ('Sports','brand','Brand','text','[]',false,30)
) AS v(category_id,attribute_key,label,input_type,options,is_required,sort_order)
JOIN public.categories c ON c.id=v.category_id
ON CONFLICT(category_id,attribute_key) DO UPDATE
SET label=EXCLUDED.label,input_type=EXCLUDED.input_type,options=EXCLUDED.options,
    is_required=EXCLUDED.is_required,sort_order=EXCLUDED.sort_order,is_active=true;

CREATE TABLE IF NOT EXISTS public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  criteria jsonb NOT NULL CHECK (
    jsonb_typeof(criteria)='object'
    AND (criteria - ARRAY['query','category','location','condition','minPrice','maxPrice','inStock','brandModel','sort'])='{}'::jsonb
    AND pg_column_size(criteria)<=4096
    AND (NOT (criteria ? 'minPrice') OR jsonb_typeof(criteria->'minPrice')='number')
    AND (NOT (criteria ? 'maxPrice') OR jsonb_typeof(criteria->'maxPrice')='number')
    AND (NOT (criteria ? 'inStock') OR jsonb_typeof(criteria->'inStock')='boolean')
  ),
  notify_on_new boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_searches_user_created_idx
ON public.saved_searches(user_id,created_at DESC);
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_searches_read_own ON public.saved_searches;
DROP POLICY IF EXISTS saved_searches_insert_own ON public.saved_searches;
DROP POLICY IF EXISTS saved_searches_update_own ON public.saved_searches;
DROP POLICY IF EXISTS saved_searches_delete_own ON public.saved_searches;
CREATE POLICY saved_searches_read_own ON public.saved_searches FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()));
CREATE POLICY saved_searches_insert_own ON public.saved_searches FOR INSERT TO authenticated
WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY saved_searches_update_own ON public.saved_searches FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()))
WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY saved_searches_delete_own ON public.saved_searches FOR DELETE TO authenticated
USING (user_id=(SELECT auth.uid()));
REVOKE ALL ON public.saved_searches FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.saved_searches TO authenticated;

-- Record a lower price on a previously public product, but alert users only when
-- the updated listing passes review and becomes publicly visible again.
CREATE TABLE IF NOT EXISTS public.product_price_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_price numeric(12,2) NOT NULL,
  new_price numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status character varying NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN ('awaiting_approval','notified','superseded'))
);
CREATE INDEX IF NOT EXISTS product_price_change_pending_idx
ON public.product_price_change_events(product_id,status,created_at DESC);
ALTER TABLE public.product_price_change_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_price_change_events_deny_client_access
ON public.product_price_change_events FOR ALL TO anon,authenticated
USING (false) WITH CHECK (false);
REVOKE ALL ON public.product_price_change_events FROM PUBLIC,anon,authenticated;

ALTER TABLE public.wishlist_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wishlist_alerts_read_own ON public.wishlist_alerts;
DROP POLICY IF EXISTS wishlist_alerts_update_own ON public.wishlist_alerts;
CREATE POLICY wishlist_alerts_read_own ON public.wishlist_alerts FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()));
CREATE POLICY wishlist_alerts_update_own ON public.wishlist_alerts FOR UPDATE TO authenticated
USING (user_id=(SELECT auth.uid()))
WITH CHECK (user_id=(SELECT auth.uid()));
REVOKE ALL ON public.wishlist_alerts FROM PUBLIC,anon;
GRANT SELECT,UPDATE ON public.wishlist_alerts TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_pending_price_drop()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.status='approved' AND NEW.price<OLD.price AND NEW.status='pending_review' THEN
    INSERT INTO public.product_price_change_events(product_id,old_price,new_price,status)
    VALUES(NEW.id,OLD.price,NEW.price,'awaiting_approval');
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.capture_pending_price_drop() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_capture_pending_price_drop ON public.products;
CREATE TRIGGER trg_capture_pending_price_drop
AFTER UPDATE OF price ON public.products
FOR EACH ROW EXECUTE FUNCTION public.capture_pending_price_drop();

CREATE OR REPLACE FUNCTION public.notify_price_drop_after_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  ev record;
  wish record;
BEGIN
  IF NEW.status<>'approved' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='approved' THEN RETURN NEW; END IF;

  FOR ev IN
    SELECT * FROM public.product_price_change_events
    WHERE product_id=NEW.id AND status='awaiting_approval'
    ORDER BY created_at FOR UPDATE
  LOOP
    IF ev.new_price IS DISTINCT FROM NEW.price THEN
      UPDATE public.product_price_change_events SET status='superseded' WHERE id=ev.id;
      CONTINUE;
    END IF;

    FOR wish IN
      SELECT wi.user_id FROM public.wishlist_items wi
      WHERE wi.product_id=NEW.id AND wi.user_id IS NOT NULL
    LOOP
      INSERT INTO public.wishlist_alerts(user_id,product_id,alert_type,old_value,new_value,is_read)
      VALUES(wish.user_id,NEW.id,'price_drop',ev.old_price,ev.new_price,false);
      INSERT INTO public.growth_notifications(user_id,type,title,message,action_url,is_read)
      VALUES(
        wish.user_id,'price_drop','A saved product dropped in price',
        left(NEW.title,160)||' is now listed for D '||trim(to_char(ev.new_price,'FM999999999990D00')),
        'product.html?id='||NEW.id::text,false
      );
    END LOOP;
    UPDATE public.product_price_change_events SET status='notified' WHERE id=ev.id;
  END LOOP;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.notify_price_drop_after_approval() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_notify_price_drop_after_approval_insert ON public.products;
DROP TRIGGER IF EXISTS trg_notify_price_drop_after_approval_update ON public.products;
CREATE TRIGGER trg_notify_price_drop_after_approval_insert
AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.notify_price_drop_after_approval();
CREATE TRIGGER trg_notify_price_drop_after_approval_update
AFTER UPDATE OF status ON public.products FOR EACH ROW EXECUTE FUNCTION public.notify_price_drop_after_approval();

CREATE OR REPLACE FUNCTION public.notify_saved_search_matches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  s record;
  q text;
  category_filter text;
  location_filter text;
  condition_filter text;
  min_price numeric;
  max_price numeric;
  brand_model text;
BEGIN
  IF NEW.status<>'approved' OR NEW.searchable IS FALSE THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status='approved'
       AND NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.price IS NOT DISTINCT FROM OLD.price
       AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
       AND NEW.location IS NOT DISTINCT FROM OLD.location
       AND NEW.condition IS NOT DISTINCT FROM OLD.condition
       AND NEW.attributes IS NOT DISTINCT FROM OLD.attributes THEN
      RETURN NEW;
    END IF;
  END IF;

  FOR s IN SELECT * FROM public.saved_searches WHERE notify_on_new=true LOOP
    q:=NULLIF(btrim(COALESCE(s.criteria->>'query','')),'');
    category_filter:=NULLIF(COALESCE(s.criteria->>'category',''),'');
    location_filter:=NULLIF(COALESCE(s.criteria->>'location',''),'');
    condition_filter:=NULLIF(COALESCE(s.criteria->>'condition',''),'');
    brand_model:=NULLIF(btrim(COALESCE(s.criteria->>'brandModel','')),'');
    min_price:=CASE WHEN jsonb_typeof(s.criteria->'minPrice')='number' THEN (s.criteria->>'minPrice')::numeric ELSE NULL END;
    max_price:=CASE WHEN jsonb_typeof(s.criteria->'maxPrice')='number' THEN (s.criteria->>'maxPrice')::numeric ELSE NULL END;

    IF category_filter IS NOT NULL AND category_filter NOT IN ('All',NEW.category_id) THEN CONTINUE; END IF;
    IF location_filter IS NOT NULL AND location_filter<>'all' AND lower(NEW.location) NOT LIKE '%'||lower(location_filter)||'%' THEN CONTINUE; END IF;
    IF condition_filter IS NOT NULL AND condition_filter<>'all' AND NEW.condition IS DISTINCT FROM condition_filter THEN CONTINUE; END IF;
    IF min_price IS NOT NULL AND NEW.price<min_price THEN CONTINUE; END IF;
    IF max_price IS NOT NULL AND NEW.price>max_price THEN CONTINUE; END IF;
    IF q IS NOT NULL AND lower(COALESCE(NEW.title,'')||' '||COALESCE(NEW.description,'')) NOT LIKE '%'||lower(q)||'%' THEN CONTINUE; END IF;
    IF brand_model IS NOT NULL AND lower(NEW.attributes::text||' '||COALESCE(NEW.title,'')) NOT LIKE '%'||lower(brand_model)||'%' THEN CONTINUE; END IF;

    INSERT INTO public.growth_notifications(user_id,type,title,message,action_url,is_read)
    VALUES(
      s.user_id,'saved_search','A new listing matches your saved search',
      left(NEW.title,160)||' · D '||trim(to_char(NEW.price,'FM999999999990D00'))||' · '||left(NEW.location,80),
      'product.html?id='||NEW.id::text,false
    );
  END LOOP;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.notify_saved_search_matches() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_notify_saved_search_matches_insert ON public.products;
DROP TRIGGER IF EXISTS trg_notify_saved_search_matches_update ON public.products;
CREATE TRIGGER trg_notify_saved_search_matches_insert
AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.notify_saved_search_matches();
CREATE TRIGGER trg_notify_saved_search_matches_update
AFTER UPDATE OF status,title,description,price,category_id,location,condition,attributes,searchable
ON public.products FOR EACH ROW EXECUTE FUNCTION public.notify_saved_search_matches();

COMMIT;
