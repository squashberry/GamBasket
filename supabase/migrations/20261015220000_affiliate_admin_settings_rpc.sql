-- Add the missing read RPC used by the affiliate administration page.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_get_affiliate_settings()
RETURNS public.affiliate_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE result public.affiliate_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_affiliate_admin() THEN
    RAISE EXCEPTION 'Affiliate administrator access required';
  END IF;
  SELECT * INTO result FROM public.affiliate_settings WHERE id=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Affiliate settings have not been initialized'; END IF;
  RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_get_affiliate_settings() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_affiliate_settings() TO authenticated;
COMMIT;
