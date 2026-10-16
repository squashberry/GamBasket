-- Add a real delivery-availability field and include it in saved-search notifications.
BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS delivery_available boolean NOT NULL DEFAULT false;

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
     AND NEW.delivery_available IS NOT DISTINCT FROM OLD.delivery_available
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
     AND NEW.attributes IS NOT DISTINCT FROM OLD.attributes
     AND NEW.delivery_available IS NOT DISTINCT FROM OLD.delivery_available
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
       OR NEW.delivery_available IS DISTINCT FROM OLD.delivery_available
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
     OR NEW.delivery_available IS DISTINCT FROM OLD.delivery_available
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

ALTER TABLE public.saved_searches DROP CONSTRAINT IF EXISTS saved_searches_criteria_check;
ALTER TABLE public.saved_searches
  ADD CONSTRAINT saved_searches_criteria_check
  CHECK (
    jsonb_typeof(criteria)='object'
    AND (criteria - ARRAY['query','category','location','condition','minPrice','maxPrice','inStock','delivery','brandModel','sort'])='{}'::jsonb
    AND pg_column_size(criteria)<=4096
    AND (NOT (criteria ? 'minPrice') OR jsonb_typeof(criteria->'minPrice')='number')
    AND (NOT (criteria ? 'maxPrice') OR jsonb_typeof(criteria->'maxPrice')='number')
    AND (NOT (criteria ? 'inStock') OR jsonb_typeof(criteria->'inStock')='boolean')
    AND (NOT (criteria ? 'delivery') OR jsonb_typeof(criteria->'delivery')='boolean')
  );

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
    IF COALESCE((s.criteria->>'delivery')::boolean,false) AND NEW.delivery_available IS DISTINCT FROM true THEN CONTINUE; END IF;
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
DROP TRIGGER IF EXISTS trg_notify_saved_search_matches_update ON public.products;
CREATE TRIGGER trg_notify_saved_search_matches_update
AFTER UPDATE OF status,title,description,price,category_id,location,condition,attributes,searchable,delivery_available
ON public.products FOR EACH ROW EXECUTE FUNCTION public.notify_saved_search_matches();

COMMIT;
