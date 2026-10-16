-- Extend the safe public-profile projection with only public merchant identity/status fields.
BEGIN;

ALTER TABLE public.public_profiles
  ADD COLUMN IF NOT EXISTS business_name character varying,
  ADD COLUMN IF NOT EXISTS seller_type character varying NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS is_seller_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_business_store boolean NOT NULL DEFAULT false;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='public_profiles_seller_type_check'
      AND conrelid='public.public_profiles'::regclass
  ) THEN
    ALTER TABLE public.public_profiles
      ADD CONSTRAINT public_profiles_seller_type_check
      CHECK (seller_type IN ('individual','business')) NOT VALID;
  END IF;
END
$constraint$;
ALTER TABLE public.public_profiles VALIDATE CONSTRAINT public_profiles_seller_type_check;

CREATE OR REPLACE FUNCTION public.sync_public_profile_business_fields(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_store_name text;
  v_seller_name text;
  v_supplier_name text;
  v_seller_verified boolean := false;
  v_supplier_verified boolean := false;
  v_has_store boolean := false;
  v_business_name text;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  SELECT s.name
    INTO v_store_name
    FROM public.stores s
   WHERE s.seller_id=p_user_id AND s.is_active IS TRUE
   ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
   LIMIT 1;

  SELECT sp.business_name,
         (sp.is_active IS TRUE AND lower(COALESCE(sp.verification_status,'')) IN ('verified','approved'))
    INTO v_seller_name, v_seller_verified
    FROM public.seller_profiles sp
   WHERE sp.user_id=p_user_id
   ORDER BY sp.updated_at DESC NULLS LAST, sp.created_at DESC NULLS LAST
   LIMIT 1;

  SELECT sup.business_name, (sup.is_active IS TRUE AND sup.is_verified IS TRUE)
    INTO v_supplier_name, v_supplier_verified
    FROM public.supplier_profiles sup
   WHERE sup.user_id=p_user_id
   ORDER BY sup.updated_at DESC NULLS LAST, sup.created_at DESC NULLS LAST
   LIMIT 1;

  SELECT EXISTS(
    SELECT 1 FROM public.stores s WHERE s.seller_id=p_user_id AND s.is_active IS TRUE
  ) INTO v_has_store;

  v_business_name := NULLIF(btrim(COALESCE(v_store_name, v_supplier_name, v_seller_name)), '');
  UPDATE public.public_profiles pp
     SET business_name=v_business_name,
         seller_type=CASE WHEN v_business_name IS NULL THEN 'individual' ELSE 'business' END,
         is_seller_verified=(COALESCE(v_seller_verified,false) OR COALESCE(v_supplier_verified,false)),
         has_business_store=v_has_store
   WHERE pp.id=p_user_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sync_public_profile_business_fields(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.trigger_sync_seller_public_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  PERFORM public.sync_public_profile_business_fields(COALESCE(NEW.user_id,OLD.user_id));
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trigger_sync_seller_public_fields() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.trigger_sync_store_public_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  PERFORM public.sync_public_profile_business_fields(COALESCE(NEW.seller_id,OLD.seller_id));
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trigger_sync_store_public_fields() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_sync_seller_public_fields ON public.seller_profiles;
CREATE TRIGGER trg_sync_seller_public_fields
AFTER INSERT OR UPDATE OR DELETE ON public.seller_profiles
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_seller_public_fields();

DROP TRIGGER IF EXISTS trg_sync_supplier_public_fields ON public.supplier_profiles;
CREATE TRIGGER trg_sync_supplier_public_fields
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_profiles
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_seller_public_fields();

DROP TRIGGER IF EXISTS trg_sync_store_public_fields ON public.stores;
CREATE TRIGGER trg_sync_store_public_fields
AFTER INSERT OR UPDATE OR DELETE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_store_public_fields();

DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.public_profiles LOOP
    PERFORM public.sync_public_profile_business_fields(r.id);
  END LOOP;
END
$backfill$;

COMMIT;
