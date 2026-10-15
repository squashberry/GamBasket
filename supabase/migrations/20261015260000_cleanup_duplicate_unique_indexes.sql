-- Remove duplicate indexes where the schema already has equivalent UNIQUE constraints.
BEGIN;
DROP INDEX IF EXISTS public.stores_seller_id_uidx;
DROP INDEX IF EXISTS public.affiliate_conversions_order_id_uidx;
COMMIT;
