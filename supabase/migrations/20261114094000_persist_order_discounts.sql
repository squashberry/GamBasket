-- Persist the final order discount so seller commission is calculated on the paid merchandise amount.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0
  CHECK (discount_amount >= 0);

CREATE FUNCTION public.set_gambasket_order_discount_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
BEGIN
  -- create_order calculates total = merchandise subtotal + delivery - discount.
  -- Persist the derived discount without trusting a browser-supplied amount.
  NEW.discount_amount := GREATEST(
    COALESCE(NEW.subtotal, 0) + COALESCE(NEW.delivery_fee, 0) - COALESCE(NEW.total, 0),
    0
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS orders_set_discount_amount ON public.orders;
CREATE TRIGGER orders_set_discount_amount
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_gambasket_order_discount_amount();

REVOKE ALL ON FUNCTION public.set_gambasket_order_discount_amount() FROM PUBLIC, anon, authenticated;

COMMIT;
