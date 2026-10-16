-- Keep online methods unavailable until their payment-provider integrations are implemented.
-- Existing historical orders are preserved; new orders and changed payment_method values
-- must use cash_on_delivery. The trigger is a second line of defence behind the UI.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_available_checkout_payment_method()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  -- Do not block unrelated updates to existing historical orders.
  IF TG_OP = 'UPDATE' AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method IS DISTINCT FROM 'cash_on_delivery' THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_COMING_SOON'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_available_checkout_payment_method() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_available_payment_methods_only ON public.orders;
CREATE TRIGGER orders_available_payment_methods_only
  BEFORE INSERT OR UPDATE OF payment_method
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_available_checkout_payment_method();

COMMIT;
