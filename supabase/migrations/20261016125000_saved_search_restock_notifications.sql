-- Send in-stock saved-search alerts only when a previously unavailable approved listing is restocked.
-- Listing metadata/visibility changes continue to evaluate all matching saved searches.
BEGIN;

CREATE OR REPLACE FUNCTION public.notify_saved_search_matches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
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
  v_stock_only_change boolean := false;
BEGIN
  IF NEW.status<>'approved' OR NEW.searchable IS FALSE THEN RETURN NEW; END IF;

  IF TG_OP='UPDATE' THEN
    v_stock_only_change :=
      OLD.status='approved'
      AND NEW.status='approved'
      AND NEW.title IS NOT DISTINCT FROM OLD.title
      AND NEW.description IS NOT DISTINCT FROM OLD.description
      AND NEW.price IS NOT DISTINCT FROM OLD.price
      AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
      AND NEW.location IS NOT DISTINCT FROM OLD.location
      AND NEW.condition IS NOT DISTINCT FROM OLD.condition
      AND NEW.attributes IS NOT DISTINCT FROM OLD.attributes
      AND NEW.delivery_available IS NOT DISTINCT FROM OLD.delivery_available
      AND NEW.searchable IS NOT DISTINCT FROM OLD.searchable
      AND NEW.stock IS DISTINCT FROM OLD.stock;

    -- A stock-only event is interesting only when availability changes from empty to in stock.
    IF v_stock_only_change
       AND (COALESCE(OLD.stock,0)>0 OR COALESCE(NEW.stock,0)<=0) THEN
      RETURN NEW;
    END IF;

    IF OLD.status='approved'
       AND NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.price IS NOT DISTINCT FROM OLD.price
       AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
       AND NEW.location IS NOT DISTINCT FROM OLD.location
       AND NEW.condition IS NOT DISTINCT FROM OLD.condition
       AND NEW.attributes IS NOT DISTINCT FROM OLD.attributes
       AND NEW.delivery_available IS NOT DISTINCT FROM OLD.delivery_available
       AND NEW.searchable IS NOT DISTINCT FROM OLD.searchable
       AND NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
      RETURN NEW;
    END IF;
  END IF;

  FOR s IN SELECT * FROM public.saved_searches WHERE notify_on_new=true LOOP
    IF v_stock_only_change
       AND NOT COALESCE((s.criteria->>'inStock')::boolean,false) THEN
      CONTINUE;
    END IF;

    q:=NULLIF(btrim(COALESCE(s.criteria->>'query','')),'');
    category_filter:=NULLIF(COALESCE(s.criteria->>'category',''),'');
    location_filter:=NULLIF(COALESCE(s.criteria->>'location',''),'');
    condition_filter:=NULLIF(COALESCE(s.criteria->>'condition',''),'');
    brand_model:=NULLIF(btrim(COALESCE(s.criteria->>'brandModel','')),'');
    min_price:=CASE WHEN jsonb_typeof(s.criteria->'minPrice')='number' THEN (s.criteria->>'minPrice')::numeric ELSE NULL END;
    max_price:=CASE WHEN jsonb_typeof(s.criteria->'maxPrice')='number' THEN (s.criteria->>'maxPrice')::numeric ELSE NULL END;

    IF category_filter IS NOT NULL AND category_filter NOT IN ('All',NEW.category_id) THEN CONTINUE; END IF;
    IF COALESCE((s.criteria->>'delivery')::boolean,false) AND NEW.delivery_available IS DISTINCT FROM true THEN CONTINUE; END IF;
    IF COALESCE((s.criteria->>'inStock')::boolean,false) AND COALESCE(NEW.stock,0)<=0 THEN CONTINUE; END IF;
    IF location_filter IS NOT NULL AND location_filter<>'all' AND lower(NEW.location) NOT LIKE '%'||lower(location_filter)||'%' THEN CONTINUE; END IF;
    IF condition_filter IS NOT NULL AND condition_filter<>'all' AND NEW.condition IS DISTINCT FROM condition_filter THEN CONTINUE; END IF;
    IF min_price IS NOT NULL AND NEW.price<min_price THEN CONTINUE; END IF;
    IF max_price IS NOT NULL AND NEW.price>max_price THEN CONTINUE; END IF;
    IF q IS NOT NULL AND lower(COALESCE(NEW.title,'')||' '||COALESCE(NEW.description,'')) NOT LIKE '%'||lower(q)||'%' THEN CONTINUE; END IF;
    IF brand_model IS NOT NULL AND lower(NEW.attributes::text||' '||COALESCE(NEW.title,'')) NOT LIKE '%'||lower(brand_model)||'%' THEN CONTINUE; END IF;

    INSERT INTO public.growth_notifications(user_id,type,title,message,action_url,is_read)
    VALUES(
      s.user_id,
      CASE WHEN v_stock_only_change THEN 'restock' ELSE 'saved_search' END,
      CASE WHEN v_stock_only_change THEN 'A saved listing is back in stock' ELSE 'A new listing matches your saved search' END,
      left(NEW.title,160)||' · D '||trim(to_char(NEW.price,'FM999999999990D00'))||' · '||left(NEW.location,80),
      'product.html?id='||NEW.id::text,
      false
    );
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_saved_search_matches_update ON public.products;
CREATE TRIGGER trg_notify_saved_search_matches_update
AFTER UPDATE OF status,title,description,price,category_id,location,condition,attributes,searchable,delivery_available,stock
ON public.products FOR EACH ROW EXECUTE FUNCTION public.notify_saved_search_matches();

COMMIT;
