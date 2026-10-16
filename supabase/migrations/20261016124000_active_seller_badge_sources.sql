-- Expose seller business labels only from currently active storefront/profile records.
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_public_profile_business_fields(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_store_name text;
  v_store_verified boolean := false;
  v_seller_name text;
  v_supplier_name text;
  v_seller_verified boolean := false;
  v_supplier_verified boolean := false;
  v_has_store boolean := false;
  v_business_name text;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  SELECT s.name, COALESCE(s.is_verified,false)
    INTO v_store_name,v_store_verified
    FROM public.stores s
   WHERE s.seller_id=p_user_id AND s.is_active IS TRUE
   ORDER BY s.updated_at DESC NULLS LAST,s.created_at DESC NULLS LAST
   LIMIT 1;

  SELECT sp.business_name,
         lower(COALESCE(sp.verification_status,'')) IN ('verified','approved')
    INTO v_seller_name,v_seller_verified
    FROM public.seller_profiles sp
   WHERE sp.user_id=p_user_id AND sp.is_active IS TRUE
   ORDER BY sp.updated_at DESC NULLS LAST,sp.created_at DESC NULLS LAST
   LIMIT 1;

  SELECT sup.business_name,COALESCE(sup.is_verified,false)
    INTO v_supplier_name,v_supplier_verified
    FROM public.supplier_profiles sup
   WHERE sup.user_id=p_user_id AND sup.is_active IS TRUE
   ORDER BY sup.updated_at DESC NULLS LAST,sup.created_at DESC NULLS LAST
   LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.seller_id=p_user_id AND s.is_active IS TRUE
  ) INTO v_has_store;

  v_business_name := NULLIF(btrim(COALESCE(
    NULLIF(v_store_name,''),
    NULLIF(v_supplier_name,''),
    NULLIF(v_seller_name,'')
  )),'');

  UPDATE public.public_profiles pp
     SET business_name=v_business_name,
         seller_type=CASE WHEN v_business_name IS NULL THEN 'individual' ELSE 'business' END,
         is_seller_verified=(COALESCE(v_store_verified,false)
                             OR COALESCE(v_seller_verified,false)
                             OR COALESCE(v_supplier_verified,false)),
         has_business_store=v_has_store
   WHERE pp.id=p_user_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sync_public_profile_business_fields(uuid) FROM PUBLIC,anon,authenticated;

DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.public_profiles
    UNION SELECT user_id FROM public.seller_profiles WHERE is_active IS TRUE
    UNION SELECT user_id FROM public.supplier_profiles WHERE is_active IS TRUE
    UNION SELECT seller_id FROM public.stores WHERE is_active IS TRUE
  LOOP
    PERFORM public.sync_public_profile_business_fields(r.id);
  END LOOP;
END
$backfill$;

COMMIT;
