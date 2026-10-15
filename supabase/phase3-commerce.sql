-- GamBasket Phase 3 commerce migration.
-- Run after schema.sql. Uses the existing orders/cart_items/products tables.

CREATE TABLE IF NOT EXISTS public.coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value >= 0),
    minimum_order NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (minimum_order >= 0),
    maximum_discount NUMERIC(12,2),
    usage_limit INTEGER,
    usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (maximum_discount IS NULL OR maximum_discount >= 0),
    CHECK (usage_limit IS NULL OR usage_limit >= 0),
    CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active coupons are not directly readable" ON public.coupons;
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
CREATE POLICY "Active coupons are not directly readable" ON public.coupons FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage coupons" ON public.coupons FOR ALL
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.validate_coupon(p_code VARCHAR, p_subtotal NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_coupon RECORD;
    v_discount NUMERIC(12,2);
BEGIN
    SELECT * INTO v_coupon
    FROM public.coupons
    WHERE code = upper(trim(p_code))
      AND is_active = TRUE
      AND (starts_at IS NULL OR starts_at <= NOW())
      AND (ends_at IS NULL OR ends_at >= NOW())
      AND (usage_limit IS NULL OR usage_count < usage_limit);
    IF NOT FOUND OR p_subtotal < v_coupon.minimum_order THEN RETURN NULL; END IF;
    IF v_coupon.discount_type = 'percentage' THEN
        v_discount := p_subtotal * v_coupon.discount_value / 100;
        IF v_coupon.maximum_discount IS NOT NULL THEN v_discount := LEAST(v_discount, v_coupon.maximum_discount); END IF;
    ELSE
        v_discount := LEAST(v_coupon.discount_value, p_subtotal);
    END IF;
    RETURN jsonb_build_object('code', v_coupon.code, 'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value, 'discount_amount', v_discount);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_coupon(VARCHAR, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_coupon(VARCHAR, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_order(
    p_items JSONB,
    p_fulfillment_type VARCHAR,
    p_delivery_address TEXT DEFAULT NULL,
    p_delivery_region VARCHAR DEFAULT NULL,
    p_delivery_area VARCHAR DEFAULT NULL,
    p_delivery_phone VARCHAR DEFAULT NULL,
    p_delivery_instructions TEXT DEFAULT NULL,
    p_payment_method VARCHAR DEFAULT 'cash_on_delivery',
    p_coupon_code VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_buyer UUID := auth.uid();
    v_item JSONB;
    v_product RECORD;
    v_order_id UUID;
    v_order_number VARCHAR(50);
    v_seller_id UUID;
    v_subtotal NUMERIC(12,2) := 0;
    v_delivery_fee NUMERIC(12,2) := 0;
    v_discount NUMERIC(12,2) := 0;
    v_total NUMERIC(12,2);
    v_quantity INTEGER;
    v_product_id UUID;
    v_coupon RECORD;
    v_coupon_code VARCHAR(50);
BEGIN
    IF v_buyer IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'CART_EMPTY';
    END IF;
    IF p_fulfillment_type NOT IN ('delivery', 'pickup') THEN
        RAISE EXCEPTION 'INVALID_FULFILLMENT';
    END IF;
    IF p_payment_method NOT IN ('cash_on_delivery', 'wave', 'qmoney', 'afrimoney') THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
    END IF;
    IF p_fulfillment_type = 'delivery' THEN
        IF NULLIF(trim(coalesce(p_delivery_address, '')), '') IS NULL
           OR NULLIF(trim(coalesce(p_delivery_area, '')), '') IS NULL
           OR NULLIF(trim(coalesce(p_delivery_phone, '')), '') IS NULL THEN
            RAISE EXCEPTION 'DELIVERY_DETAILS_REQUIRED';
        END IF;
        v_delivery_fee := 100;
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
        v_quantity := (v_item->>'quantity')::INTEGER;
        IF v_quantity IS NULL OR v_quantity < 1 THEN
            RAISE EXCEPTION 'INVALID_QUANTITY';
        END IF;

        SELECT id, seller_id, title, price, stock, location, status
        INTO v_product
        FROM public.products
        WHERE id = v_product_id
        FOR UPDATE;

        IF NOT FOUND OR v_product.status <> 'approved' THEN
            RAISE EXCEPTION 'PRODUCT_UNAVAILABLE:%', v_product_id;
        END IF;
        IF v_product.stock < v_quantity THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK:%', v_product.title;
        END IF;
        IF v_seller_id IS NULL THEN
            v_seller_id := v_product.seller_id;
        ELSIF v_seller_id IS DISTINCT FROM v_product.seller_id THEN
            RAISE EXCEPTION 'MULTIPLE_SELLERS_NOT_SUPPORTED';
        END IF;
        v_subtotal := v_subtotal + (v_product.price * v_quantity);
    END LOOP;

    v_coupon_code := NULLIF(upper(trim(coalesce(p_coupon_code, ''))), '');
    IF v_coupon_code IS NOT NULL THEN
        SELECT * INTO v_coupon
        FROM public.coupons
        WHERE code = v_coupon_code
          AND is_active = TRUE
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
          AND (usage_limit IS NULL OR usage_count < usage_limit)
        FOR UPDATE;
        IF NOT FOUND OR v_subtotal < v_coupon.minimum_order THEN
            RAISE EXCEPTION 'INVALID_COUPON';
        END IF;
        IF v_coupon.discount_type = 'percentage' THEN
            v_discount := v_subtotal * v_coupon.discount_value / 100;
            IF v_coupon.maximum_discount IS NOT NULL THEN
                v_discount := LEAST(v_discount, v_coupon.maximum_discount);
            END IF;
        ELSE
            v_discount := LEAST(v_coupon.discount_value, v_subtotal);
        END IF;
        UPDATE public.coupons SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = v_coupon.id;
    END IF;

    v_total := GREATEST(0, v_subtotal + v_delivery_fee - v_discount);
    v_order_number := 'GB-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 10));

    INSERT INTO public.orders (
        order_number, buyer_id, seller_id, fulfillment_type, delivery_address,
        delivery_region, delivery_area, delivery_phone, delivery_instructions,
        pickup_location, subtotal, delivery_fee, total, payment_status, payment_method, order_status
    ) VALUES (
        v_order_number, v_buyer, v_seller_id, p_fulfillment_type, p_delivery_address,
        p_delivery_region, p_delivery_area, p_delivery_phone, p_delivery_instructions,
        CASE WHEN p_fulfillment_type = 'pickup' THEN 'Seller store location' ELSE NULL END,
        v_subtotal, v_delivery_fee, v_total, 'pending', p_payment_method, 'pending'
    ) RETURNING id INTO v_order_id;

    INSERT INTO public.order_items (order_id, product_id, title, price, quantity, subtotal)
    SELECT v_order_id, p.id, p.title, p.price, (item.value->>'quantity')::INTEGER,
           p.price * (item.value->>'quantity')::INTEGER
    FROM jsonb_array_elements(p_items) item
    JOIN public.products p ON p.id = (item.value->>'product_id')::UUID;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        UPDATE public.products
        SET stock = stock - (v_item->>'quantity')::INTEGER,
            sales_count = sales_count + (v_item->>'quantity')::INTEGER,
            updated_at = NOW()
        WHERE id = (v_item->>'product_id')::UUID;
    END LOOP;

    INSERT INTO public.order_status_history (order_id, to_status, changed_by, notes)
    VALUES (v_order_id, 'pending', v_buyer, 'Order placed by buyer');

    DELETE FROM public.cart_items WHERE user_id = v_buyer;

    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES
        (v_buyer, 'order', 'Order placed', 'Your GamBasket order ' || v_order_number || ' has been received.', jsonb_build_object('order_id', v_order_id)),
        (v_seller_id, 'seller', 'New order received', 'A new GamBasket order ' || v_order_number || ' is waiting for review.', jsonb_build_object('order_id', v_order_id));

    RETURN jsonb_build_object(
        'id', v_order_id,
        'order_number', v_order_number,
        'subtotal', v_subtotal,
        'delivery_fee', v_delivery_fee,
        'discount', v_discount,
        'total', v_total,
        'payment_status', 'pending',
        'order_status', 'pending'
    );
END;
$$;

DROP POLICY IF EXISTS "Buyers can create orders" ON public.orders;
DROP POLICY IF EXISTS "Buyers can insert order items" ON public.order_items;
DROP POLICY IF EXISTS "Authorized users can insert order status history" ON public.order_status_history;

CREATE POLICY "Only the order RPC creates orders" ON public.orders FOR INSERT
    WITH CHECK (false);
CREATE POLICY "Only the order RPC creates order items" ON public.order_items FOR INSERT
    WITH CHECK (false);
CREATE POLICY "Seller or admin can add order history" ON public.order_status_history FOR INSERT
    WITH CHECK (auth.uid() = (SELECT seller_id FROM public.orders WHERE id = order_status_history.order_id)
        OR public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON FUNCTION public.create_order(JSONB, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order(JSONB, VARCHAR, TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO authenticated;
