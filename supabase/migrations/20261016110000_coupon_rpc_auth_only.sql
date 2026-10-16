-- Coupon validation is only needed in an authenticated checkout session.
-- Do not expose the SECURITY DEFINER coupon lookup as an anonymous RPC.
BEGIN;
REVOKE ALL ON FUNCTION public.validate_coupon(character varying,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon(character varying,numeric) TO authenticated;
COMMIT;
