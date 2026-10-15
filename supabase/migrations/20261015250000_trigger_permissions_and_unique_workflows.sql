-- Finish trigger-RPC isolation and enforce one active dispute/store/commission relation.
BEGIN;

-- Trigger-only functions must not be callable through PostgREST RPC endpoints.
REVOKE ALL ON FUNCTION public.guard_growth_notification_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_verification_document_paths() FROM PUBLIC, anon, authenticated;

-- The storefront RPC and checkout/coupon accounting assume stable unique identities.
-- Existing test data has no stores, disputes, or affiliate conversions; the indexes
-- also protect against concurrent writes racing through those workflows.
CREATE UNIQUE INDEX IF NOT EXISTS stores_seller_id_uidx
ON public.stores(seller_id);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_disputes_one_active_order_uidx
ON public.marketplace_disputes(order_id)
WHERE status IN ('open','investigating');

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_conversions_order_id_uidx
ON public.affiliate_conversions(order_id);

COMMIT;
