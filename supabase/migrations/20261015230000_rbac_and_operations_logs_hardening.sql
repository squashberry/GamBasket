-- Close remaining role-write permissions, restore scoped operations/audit reads,
-- and allow the authorized product-moderation RPC to update its timestamp.
BEGIN;

REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
DROP POLICY IF EXISTS "Only admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY user_roles_read_self_or_admin
ON public.user_roles FOR SELECT TO authenticated
USING (user_id=(SELECT auth.uid()) OR public.is_gambasket_admin());

REVOKE ALL ON TABLE public.activity_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.activity_logs TO authenticated;
DROP POLICY IF EXISTS "Admins can view activity logs" ON public.activity_logs;
CREATE POLICY activity_logs_read_own_or_admin
ON public.activity_logs FOR SELECT TO authenticated
USING (actor_id=(SELECT auth.uid()) OR public.is_gambasket_admin());

REVOKE ALL ON TABLE public.platform_audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_audit_logs TO authenticated;
DROP POLICY IF EXISTS platform_audit_logs_admin_read ON public.platform_audit_logs;
CREATE POLICY platform_audit_logs_admin_read
ON public.platform_audit_logs FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

CREATE OR REPLACE FUNCTION public.guard_product_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_admin boolean := public.is_gambasket_admin();
  v_moderator boolean := public.has_role(auth.uid(),'marketplace_worker'::character varying);
  v_stock_delta integer;
  v_sales_delta integer;
BEGIN
  IF v_admin THEN RETURN NEW; END IF;

  IF TG_OP='INSERT' THEN
    IF auth.uid() IS NULL OR NEW.seller_id IS DISTINCT FROM auth.uid()
       OR NOT (public.has_role(auth.uid(),'seller'::character varying)
               OR public.has_role(auth.uid(),'supplier'::character varying)) THEN
      RAISE EXCEPTION 'An active seller or supplier may only create their own listings';
    END IF;
    NEW.status:='pending_review';
    NEW.rejection_reason:=NULL;
    NEW.is_featured:=false;
    NEW.featured_until:=NULL;
    NEW.views_count:=0;
    NEW.sales_count:=0;
    NEW.verification_status:='unverified';
    RETURN NEW;
  END IF;

  IF current_setting('app.gambasket_internal',true)='on'
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.seller_id IS NOT DISTINCT FROM OLD.seller_id
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.subcategory_id IS NOT DISTINCT FROM OLD.subcategory_id
     AND NEW.condition IS NOT DISTINCT FROM OLD.condition
     AND NEW.location IS NOT DISTINCT FROM OLD.location
     AND NEW.main_image IS NOT DISTINCT FROM OLD.main_image
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason
     AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
     AND NEW.wholesale_price IS NOT DISTINCT FROM OLD.wholesale_price
     AND NEW.minimum_order_quantity IS NOT DISTINCT FROM OLD.minimum_order_quantity
     AND NEW.retail_suggested_price IS NOT DISTINCT FROM OLD.retail_suggested_price
     AND NEW.fulfillment_type IS NOT DISTINCT FROM OLD.fulfillment_type
     AND NEW.listing_type IS NOT DISTINCT FROM OLD.listing_type
     AND NEW.min_order_quantity IS NOT DISTINCT FROM OLD.min_order_quantity
     AND NEW.wholesale_currency IS NOT DISTINCT FROM OLD.wholesale_currency
     AND NEW.wholesale_enabled IS NOT DISTINCT FROM OLD.wholesale_enabled
     AND NEW.featured_until IS NOT DISTINCT FROM OLD.featured_until
     AND NEW.promotion_id IS NOT DISTINCT FROM OLD.promotion_id
     AND NEW.searchable IS NOT DISTINCT FROM OLD.searchable
     AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status
     AND NEW.views_count IS NOT DISTINCT FROM OLD.views_count
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  -- Moderators can change the moderation status/reason only.
  IF v_moderator
     AND NEW.seller_id IS NOT DISTINCT FROM OLD.seller_id
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.subcategory_id IS NOT DISTINCT FROM OLD.subcategory_id
     AND NEW.condition IS NOT DISTINCT FROM OLD.condition
     AND NEW.location IS NOT DISTINCT FROM OLD.location
     AND NEW.main_image IS NOT DISTINCT FROM OLD.main_image
     AND NEW.stock IS NOT DISTINCT FROM OLD.stock
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
     AND NEW.wholesale_price IS NOT DISTINCT FROM OLD.wholesale_price
     AND NEW.minimum_order_quantity IS NOT DISTINCT FROM OLD.minimum_order_quantity
     AND NEW.retail_suggested_price IS NOT DISTINCT FROM OLD.retail_suggested_price
     AND NEW.fulfillment_type IS NOT DISTINCT FROM OLD.fulfillment_type
     AND NEW.listing_type IS NOT DISTINCT FROM OLD.listing_type
     AND NEW.min_order_quantity IS NOT DISTINCT FROM OLD.min_order_quantity
     AND NEW.wholesale_currency IS NOT DISTINCT FROM OLD.wholesale_currency
     AND NEW.wholesale_enabled IS NOT DISTINCT FROM OLD.wholesale_enabled
     AND NEW.promotion_id IS NOT DISTINCT FROM OLD.promotion_id
     AND NEW.searchable IS NOT DISTINCT FROM OLD.searchable
     AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
     AND NEW.featured_until IS NOT DISTINCT FROM OLD.featured_until
     AND NEW.views_count IS NOT DISTINCT FROM OLD.views_count
     AND NEW.sales_count IS NOT DISTINCT FROM OLD.sales_count
     AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.status IN ('approved','rejected','suspended','pending_review') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR OLD.seller_id IS DISTINCT FROM auth.uid() THEN
    IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
       OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
       OR NEW.featured_until IS DISTINCT FROM OLD.featured_until
       OR NEW.views_count IS DISTINCT FROM OLD.views_count
       OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.price IS DISTINCT FROM OLD.price
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.category_id IS DISTINCT FROM OLD.category_id
       OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
       OR NEW.condition IS DISTINCT FROM OLD.condition
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.main_image IS DISTINCT FROM OLD.main_image
       OR NEW.listing_type IS DISTINCT FROM OLD.listing_type
       OR NEW.wholesale_price IS DISTINCT FROM OLD.wholesale_price
       OR NEW.retail_suggested_price IS DISTINCT FROM OLD.retail_suggested_price
       OR NEW.minimum_order_quantity IS DISTINCT FROM OLD.minimum_order_quantity
       OR NEW.min_order_quantity IS DISTINCT FROM OLD.min_order_quantity
       OR NEW.wholesale_currency IS DISTINCT FROM OLD.wholesale_currency
       OR NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled
       OR NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type
       OR NEW.promotion_id IS DISTINCT FROM OLD.promotion_id
       OR NEW.searchable IS DISTINCT FROM OLD.searchable THEN
      RAISE EXCEPTION 'Only a seller or validated server operation may change listing fields';
    END IF;

    v_stock_delta:=OLD.stock-NEW.stock;
    v_sales_delta:=NEW.sales_count-OLD.sales_count;
    IF v_stock_delta IS DISTINCT FROM v_sales_delta OR v_stock_delta=0 THEN
      RAISE EXCEPTION 'Inventory changes must represent a matching sale or cancellation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (public.has_role(auth.uid(),'seller'::character varying)
          OR public.has_role(auth.uid(),'supplier'::character varying)) THEN
    RAISE EXCEPTION 'Seller or supplier role required';
  END IF;

  IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
     OR NEW.featured_until IS DISTINCT FROM OLD.featured_until
     OR NEW.views_count IS DISTINCT FROM OLD.views_count
     OR NEW.sales_count IS DISTINCT FROM OLD.sales_count
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
     OR NEW.promotion_id IS DISTINCT FROM OLD.promotion_id THEN
    RAISE EXCEPTION 'Moderation, ownership, supplier and counter fields are protected';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'A seller cannot approve or reject a listing';
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
     OR NEW.condition IS DISTINCT FROM OLD.condition
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.main_image IS DISTINCT FROM OLD.main_image
     OR NEW.listing_type IS DISTINCT FROM OLD.listing_type
     OR NEW.wholesale_price IS DISTINCT FROM OLD.wholesale_price
     OR NEW.retail_suggested_price IS DISTINCT FROM OLD.retail_suggested_price
     OR NEW.minimum_order_quantity IS DISTINCT FROM OLD.minimum_order_quantity
     OR NEW.min_order_quantity IS DISTINCT FROM OLD.min_order_quantity
     OR NEW.wholesale_currency IS DISTINCT FROM OLD.wholesale_currency
     OR NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled
     OR NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type
     OR NEW.searchable IS DISTINCT FROM OLD.searchable THEN
    NEW.status:='pending_review';
    NEW.rejection_reason:=NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

COMMIT;
