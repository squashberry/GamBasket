-- Seller Studio (v2) backend.
-- Builds on the existing orders / order_items / products / marketplace_reviews tables and the
-- existing wallet ledger. Adds: dashboard analytics RPCs, bulk stock/price updates, review
-- replies, monthly goals and private order notes.
--
-- Every function is SECURITY DEFINER with an empty search_path, requires an active seller role
-- and only ever reads or writes rows owned by auth.uid().
--
-- Money rules match the rest of the marketplace: merchandise value = subtotal - discount_amount,
-- cancelled orders excluded, platform fee = gambasket_finance_settings.commission_rate.

-- ---------------------------------------------------------------------------------------------
-- Indexes for seller-scoped reads
-- ---------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS orders_seller_created_idx
  ON public.orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_status_idx
  ON public.orders (seller_id, order_status);
CREATE INDEX IF NOT EXISTS order_items_product_idx
  ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS marketplace_reviews_seller_idx
  ON public.marketplace_reviews (seller_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- Monthly goals (one row per seller)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seller_goals (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_revenue_target numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_revenue_target >= 0),
  monthly_orders_target integer NOT NULL DEFAULT 0 CHECK (monthly_orders_target >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- Private order notes (never visible to the buyer)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seller_order_notes (
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (length(note) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, seller_id)
);

ALTER TABLE public.seller_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_order_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_goals_owner_read ON public.seller_goals;
CREATE POLICY seller_goals_owner_read ON public.seller_goals
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS seller_order_notes_owner_read ON public.seller_order_notes;
CREATE POLICY seller_order_notes_owner_read ON public.seller_order_notes
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));

-- Reads only through RLS; every write goes through the RPCs below.
REVOKE ALL ON TABLE public.seller_goals, public.seller_order_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.seller_goals, public.seller_order_notes TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Dashboard summary: current period vs the period before it, plus live work queues.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_dashboard_summary(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_seller uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_now timestamptz := now();
  v_cur timestamptz;
  v_prev timestamptz;
  v_rate numeric := 5;
  c record; p record; q record; r record; g record;
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  v_cur := v_now - make_interval(days => v_days);
  v_prev := v_now - make_interval(days => v_days * 2);
  SELECT COALESCE(commission_rate, 5) INTO v_rate FROM public.gambasket_finance_settings WHERE id = 1;

  SELECT
    COALESCE(SUM(GREATEST(o.subtotal - COALESCE(o.discount_amount, 0), 0))
      FILTER (WHERE o.created_at >= v_cur AND o.order_status <> 'cancelled'), 0) AS cur_revenue,
    COUNT(*) FILTER (WHERE o.created_at >= v_cur AND o.order_status <> 'cancelled') AS cur_orders,
    COUNT(*) FILTER (WHERE o.created_at >= v_cur AND o.order_status = 'cancelled') AS cur_cancelled,
    COUNT(DISTINCT o.buyer_id) FILTER (WHERE o.created_at >= v_cur AND o.order_status <> 'cancelled') AS cur_buyers,
    COALESCE(SUM(GREATEST(o.subtotal - COALESCE(o.discount_amount, 0), 0))
      FILTER (WHERE o.created_at >= v_prev AND o.created_at < v_cur AND o.order_status <> 'cancelled'), 0) AS prev_revenue,
    COUNT(*) FILTER (WHERE o.created_at >= v_prev AND o.created_at < v_cur AND o.order_status <> 'cancelled') AS prev_orders
  INTO c
  FROM public.orders o
  WHERE o.seller_id = v_seller AND o.created_at >= v_prev;

  SELECT
    COUNT(*) FILTER (WHERE o.order_status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE o.order_status IN ('confirmed','processing','ready_for_delivery','delivery_assigned',
                                              'picked_up','out_for_delivery','ready_for_pickup')) AS in_progress,
    COUNT(*) FILTER (WHERE o.order_status = 'pending' AND o.created_at < v_now - interval '24 hours') AS overdue
  INTO q
  FROM public.orders o WHERE o.seller_id = v_seller;

  SELECT
    COUNT(*) FILTER (WHERE pr.status = 'approved') AS live,
    COUNT(*) FILTER (WHERE pr.status = 'approved' AND pr.stock BETWEEN 1 AND 3) AS low_stock,
    COUNT(*) FILTER (WHERE pr.status = 'approved' AND pr.stock = 0) AS out_of_stock,
    COUNT(*) FILTER (WHERE pr.status = 'pending_review') AS in_review,
    COUNT(*) FILTER (WHERE pr.status = 'rejected') AS rejected
  INTO p
  FROM public.products pr WHERE pr.seller_id = v_seller;

  SELECT
    COALESCE(ROUND(AVG(rv.rating)::numeric, 2), 0) AS avg_rating,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rv.seller_reply IS NULL) AS unanswered
  INTO r
  FROM public.marketplace_reviews rv WHERE rv.seller_id = v_seller AND rv.status = 'published';

  SELECT COALESCE(sg.monthly_revenue_target, 0) AS rev_target,
         COALESCE(sg.monthly_orders_target, 0) AS ord_target
  INTO g
  FROM (SELECT 1) one LEFT JOIN public.seller_goals sg ON sg.seller_id = v_seller;

  RETURN jsonb_build_object(
    'days', v_days,
    'fee_rate', v_rate,
    'revenue', c.cur_revenue,
    'orders', c.cur_orders,
    'cancelled', c.cur_cancelled,
    'buyers', c.cur_buyers,
    'avg_order', CASE WHEN c.cur_orders > 0 THEN ROUND(c.cur_revenue / c.cur_orders, 2) ELSE 0 END,
    'est_fees', ROUND(c.cur_revenue * v_rate / 100, 2),
    'prev_revenue', c.prev_revenue,
    'prev_orders', c.prev_orders,
    'pending_orders', q.pending,
    'overdue_orders', q.overdue,
    'in_progress_orders', q.in_progress,
    'live_products', p.live,
    'low_stock', p.low_stock,
    'out_of_stock', p.out_of_stock,
    'in_review', p.in_review,
    'rejected', p.rejected,
    'avg_rating', r.avg_rating,
    'review_count', r.total,
    'unanswered_reviews', r.unanswered,
    'goal_revenue', g.rev_target,
    'goal_orders', g.ord_target,
    'month_revenue', (SELECT COALESCE(SUM(GREATEST(o.subtotal - COALESCE(o.discount_amount, 0), 0)), 0)
                      FROM public.orders o
                      WHERE o.seller_id = v_seller AND o.order_status <> 'cancelled'
                        AND o.created_at >= date_trunc('month', v_now)),
    'month_orders', (SELECT COUNT(*) FROM public.orders o
                     WHERE o.seller_id = v_seller AND o.order_status <> 'cancelled'
                       AND o.created_at >= date_trunc('month', v_now))
  );
END;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Daily sales series, zero-filled so charts have no gaps.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_sales_series(p_days integer DEFAULT 30)
RETURNS TABLE (day date, orders integer, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_seller uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  RETURN QUERY
  SELECT d::date,
         COALESCE(COUNT(o.id), 0)::integer,
         COALESCE(SUM(GREATEST(o.subtotal - COALESCE(o.discount_amount, 0), 0)), 0)::numeric(14,2)
  FROM generate_series(current_date - (v_days - 1), current_date, interval '1 day') AS d
  LEFT JOIN public.orders o
    ON o.seller_id = v_seller AND o.order_status <> 'cancelled' AND o.created_at::date = d::date
  GROUP BY d
  ORDER BY d;
END;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Best sellers for the period.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_top_products(p_days integer DEFAULT 30, p_limit integer DEFAULT 5)
RETURNS TABLE (product_id uuid, title text, image text, units bigint, revenue numeric, stock integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_seller uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 25);
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  RETURN QUERY
  SELECT oi.product_id,
         COALESCE(MAX(pr.title), MAX(oi.title))::text,
         MAX(pr.main_image)::text,
         SUM(oi.quantity)::bigint,
         SUM(oi.subtotal)::numeric(14,2),
         MAX(pr.stock)::integer
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  LEFT JOIN public.products pr ON pr.id = oi.product_id
  WHERE o.seller_id = v_seller
    AND o.order_status <> 'cancelled'
    AND o.created_at >= now() - make_interval(days => v_days)
  GROUP BY oi.product_id
  ORDER BY SUM(oi.subtotal) DESC
  LIMIT v_limit;
END;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Customers: everyone who has bought from this seller (all time), newest first.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_customer_insights(p_limit integer DEFAULT 200)
RETURNS TABLE (
  buyer_id uuid, display_name text, avatar_url text, orders bigint, spent numeric,
  first_order_at timestamptz, last_order_at timestamptz, is_repeat boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_seller uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  RETURN QUERY
  SELECT o.buyer_id,
         COALESCE(NULLIF(trim(concat_ws(' ', pp.first_name, left(pp.last_name, 1) || '.')), '.'), 'Customer')::text,
         pp.avatar_url::text,
         COUNT(*)::bigint,
         COALESCE(SUM(GREATEST(o.subtotal - COALESCE(o.discount_amount, 0), 0)), 0)::numeric(14,2),
         MIN(o.created_at), MAX(o.created_at),
         COUNT(*) > 1
  FROM public.orders o
  LEFT JOIN public.public_profiles pp ON pp.id = o.buyer_id
  WHERE o.seller_id = v_seller AND o.order_status <> 'cancelled'
  GROUP BY o.buyer_id, pp.first_name, pp.last_name, pp.avatar_url
  ORDER BY MAX(o.created_at) DESC
  LIMIT v_limit;
END;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Bulk stock / price update. Input: [{"id": "<uuid>", "stock": 12, "price": 450}, ...]
-- Stock-only changes are applied immediately. A price change makes the existing
-- guard_product_write trigger send the listing back to review; the count is returned so the UI
-- can say so honestly.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_bulk_update_products(p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_seller uuid := auth.uid();
  u jsonb;
  v_id uuid;
  v_stock integer;
  v_price numeric;
  v_updated integer := 0;
  v_reviewed integer := 0;
  v_before public.products%ROWTYPE;
  v_after public.products%ROWTYPE;
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  IF jsonb_typeof(p_updates) <> 'array' THEN RAISE EXCEPTION 'Updates must be an array'; END IF;
  IF jsonb_array_length(p_updates) > 200 THEN RAISE EXCEPTION 'At most 200 products per request'; END IF;

  FOR u IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    v_id := NULLIF(u ->> 'id', '')::uuid;
    v_stock := CASE WHEN u ? 'stock' THEN (u ->> 'stock')::integer END;
    v_price := CASE WHEN u ? 'price' THEN (u ->> 'price')::numeric END;
    IF v_id IS NULL OR (v_stock IS NULL AND v_price IS NULL) THEN CONTINUE; END IF;
    IF v_stock IS NOT NULL AND v_stock < 0 THEN RAISE EXCEPTION 'Stock cannot be negative'; END IF;
    IF v_price IS NOT NULL AND v_price < 0 THEN RAISE EXCEPTION 'Price cannot be negative'; END IF;

    SELECT * INTO v_before FROM public.products WHERE id = v_id AND seller_id = v_seller FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product % not found', v_id; END IF;

    UPDATE public.products
    SET stock = COALESCE(v_stock, stock),
        price = COALESCE(v_price, price),
        updated_at = now()
    WHERE id = v_id
    RETURNING * INTO v_after;

    v_updated := v_updated + 1;
    IF v_before.status IS DISTINCT FROM v_after.status AND v_after.status = 'pending_review' THEN
      v_reviewed := v_reviewed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'sent_to_review', v_reviewed);
END;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Reply to a customer review (one reply, editable). Only on this seller's own published reviews.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_reply_to_review(p_review_id uuid, p_reply text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_seller uuid := auth.uid();
  v_reply text := NULLIF(trim(COALESCE(p_reply, '')), '');
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  IF v_reply IS NOT NULL AND length(v_reply) > 800 THEN
    RAISE EXCEPTION 'Replies are limited to 800 characters';
  END IF;
  UPDATE public.marketplace_reviews
  SET seller_reply = v_reply, updated_at = now()
  WHERE id = p_review_id AND seller_id = v_seller AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  RETURN jsonb_build_object('success', true, 'reply', v_reply);
END;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Goals and order notes
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_set_goals(p_monthly_revenue numeric, p_monthly_orders integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_seller uuid := auth.uid();
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  IF COALESCE(p_monthly_revenue, 0) < 0 OR COALESCE(p_monthly_orders, 0) < 0 THEN
    RAISE EXCEPTION 'Goals cannot be negative';
  END IF;
  INSERT INTO public.seller_goals(seller_id, monthly_revenue_target, monthly_orders_target, updated_at)
  VALUES (v_seller, COALESCE(p_monthly_revenue, 0), COALESCE(p_monthly_orders, 0), now())
  ON CONFLICT (seller_id) DO UPDATE
    SET monthly_revenue_target = EXCLUDED.monthly_revenue_target,
        monthly_orders_target = EXCLUDED.monthly_orders_target,
        updated_at = now();
  RETURN jsonb_build_object('success', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.seller_save_order_note(p_order_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_seller uuid := auth.uid();
  v_note text := NULLIF(trim(COALESCE(p_note, '')), '');
BEGIN
  IF v_seller IS NULL OR NOT public.has_role(v_seller, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND seller_id = v_seller) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_note IS NULL THEN
    DELETE FROM public.seller_order_notes WHERE order_id = p_order_id AND seller_id = v_seller;
  ELSE
    IF length(v_note) > 1000 THEN RAISE EXCEPTION 'Notes are limited to 1000 characters'; END IF;
    INSERT INTO public.seller_order_notes(order_id, seller_id, note, updated_at)
    VALUES (p_order_id, v_seller, v_note, now())
    ON CONFLICT (order_id, seller_id) DO UPDATE SET note = EXCLUDED.note, updated_at = now();
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.seller_dashboard_summary(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_sales_series(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_top_products(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_customer_insights(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_bulk_update_products(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_reply_to_review(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_set_goals(numeric, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_save_order_note(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.seller_dashboard_summary(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_sales_series(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_top_products(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_customer_insights(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_bulk_update_products(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_reply_to_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_set_goals(numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_save_order_note(uuid, text) TO authenticated;
