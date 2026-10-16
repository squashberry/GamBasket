-- Expose only safe seller verification/store metadata via the existing public profile projection.
BEGIN;

ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS business_name character varying,
  ADD COLUMN IF NOT EXISTS seller_type character varying NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS is_seller_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_business_store boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_public_seller_badge(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_store_name text;
  v_store_verified boolean := false;
  v_supplier_name text;
  v_supplier_verified boolean := false;
  v_seller_name text;
  v_seller_status text;
  v_has_business boolean := false;
  v_verified boolean := false;
  v_business_name text;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  SELECT s.name, COALESCE(s.is_verified,false)
    INTO v_store_name, v_store_verified
  FROM public.stores s
  WHERE s.seller_id=p_user_id AND s.is_active=true
  ORDER BY s.created_at DESC NULLS LAST LIMIT 1;

  SELECT sp.business_name, COALESCE(sp.is_verified,false)
    INTO v_supplier_name, v_supplier_verified
  FROM public.supplier_profiles sp
  WHERE sp.user_id=p_user_id AND sp.is_active=true
  ORDER BY sp.created_at DESC NULLS LAST LIMIT 1;

  SELECT sl.business_name, sl.verification_status
    INTO v_seller_name, v_seller_status
  FROM public.seller_profiles sl
  WHERE sl.user_id=p_user_id AND sl.is_active=true
  ORDER BY sl.created_at DESC NULLS LAST LIMIT 1;

  v_has_business := v_store_name IS NOT NULL OR v_supplier_name IS NOT NULL;
  v_verified := COALESCE(v_store_verified,false) OR COALESCE(v_supplier_verified,false) OR COALESCE(v_seller_status IN ('verified','approved'),false);
  v_business_name := COALESCE(
    NULLIF(v_store_name,''),
    NULLIF(v_supplier_name,''),
    CASE WHEN v_seller_status IN ('verified','approved') THEN NULLIF(v_seller_name,'') ELSE NULL END
  );

  UPDATE public.public_profiles
  SET business_name=v_business_name,
      seller_type=CASE WHEN v_has_business THEN 'business' ELSE 'individual' END,
      is_seller_verified=v_verified,
      has_business_store=v_has_business
  WHERE id=p_user_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sync_public_seller_badge(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.refresh_public_seller_badge_from_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF TG_TABLE_NAME='stores' THEN v_user_id:=OLD.seller_id;
    ELSE v_user_id:=OLD.user_id;
    END IF;
  ELSE
    IF TG_TABLE_NAME='stores' THEN v_user_id:=NEW.seller_id;
    ELSE v_user_id:=NEW.user_id;
    END IF;
  END IF;

  PERFORM public.sync_public_seller_badge(v_user_id);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refresh_public_seller_badge_from_source() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_refresh_public_badge_seller ON public.seller_profiles;
CREATE TRIGGER trg_refresh_public_badge_seller
AFTER INSERT OR UPDATE OR DELETE ON public.seller_profiles
FOR EACH ROW EXECUTE FUNCTION public.refresh_public_seller_badge_from_source();

DROP TRIGGER IF EXISTS trg_refresh_public_badge_supplier ON public.supplier_profiles;
CREATE TRIGGER trg_refresh_public_badge_supplier
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_profiles
FOR EACH ROW EXECUTE FUNCTION public.refresh_public_seller_badge_from_source();

DROP TRIGGER IF EXISTS trg_refresh_public_badge_store ON public.stores;
CREATE TRIGGER trg_refresh_public_badge_store
AFTER INSERT OR UPDATE OR DELETE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.refresh_public_seller_badge_from_source();

DO $backfill$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT id FROM public.public_profiles
    UNION
    SELECT user_id FROM public.seller_profiles
    UNION
    SELECT user_id FROM public.supplier_profiles
    UNION
    SELECT seller_id FROM public.stores
  LOOP
    PERFORM public.sync_public_seller_badge(item.id);
  END LOOP;
END
$backfill$;

COMMIT;
