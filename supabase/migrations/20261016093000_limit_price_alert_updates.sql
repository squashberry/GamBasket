-- Restrict saved price-alert updates to the read-state flag only.
BEGIN;
REVOKE UPDATE ON TABLE public.wishlist_alerts FROM PUBLIC, anon, authenticated;
GRANT UPDATE (is_read) ON TABLE public.wishlist_alerts TO authenticated;
COMMIT;
