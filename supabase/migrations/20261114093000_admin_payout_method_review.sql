-- Admin-only approval gate for seller payout destinations.
BEGIN;

CREATE FUNCTION public.admin_review_seller_payout_method(
  p_method_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_method public.seller_payout_methods%ROWTYPE;
  v_status text := lower(trim(COALESCE(p_status, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_gambasket_admin() THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF v_status NOT IN ('active','rejected','disabled') THEN
    RAISE EXCEPTION 'Invalid payout method review status';
  END IF;

  SELECT * INTO v_method
  FROM public.seller_payout_methods
  WHERE id = p_method_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Payout method not found'; END IF;

  IF v_status = 'active' THEN
    UPDATE public.seller_payout_methods
    SET is_primary = false, updated_at = now()
    WHERE seller_id = v_method.seller_id AND id <> p_method_id;

    UPDATE public.seller_payout_methods
    SET verification_status = 'active', is_primary = true,
        verified_at = now(), verified_by = auth.uid(), updated_at = now()
    WHERE id = p_method_id;
  ELSE
    UPDATE public.seller_payout_methods
    SET verification_status = v_status, is_primary = false,
        verified_at = now(), verified_by = auth.uid(), updated_at = now()
    WHERE id = p_method_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'method_id', p_method_id,
    'seller_id', v_method.seller_id,
    'verification_status', v_status
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_review_seller_payout_method(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_seller_payout_method(uuid,text) TO authenticated;

COMMIT;
