-- Enable only safe reads for the promotion-product relation used by product pages.
BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.product_promotions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_promotions TO anon, authenticated;
DROP POLICY IF EXISTS product_promotions_public_active_read ON public.product_promotions;
CREATE POLICY product_promotions_public_active_read
ON public.product_promotions FOR SELECT TO anon, authenticated
USING (
  public.is_gambasket_admin()
  OR EXISTS (
    SELECT 1
    FROM public.seller_promotions sp
    JOIN public.products p ON p.id=product_promotions.product_id
    WHERE sp.id=product_promotions.promotion_id
      AND (
        (sp.seller_id=(SELECT auth.uid()))
        OR (
          p.status='approved'
          AND sp.is_active=true
          AND sp.starts_at<=now()
          AND sp.ends_at>=now()
        )
      )
  )
);

COMMIT;
