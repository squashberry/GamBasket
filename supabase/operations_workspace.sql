-- Operations center support. Additive, idempotent, and intentionally does not
-- assign user roles from the browser or from application approval.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'worker_applications' AND policyname = 'Operations workers can view pending applications') THEN
        CREATE POLICY "Operations workers can view pending applications"
        ON public.worker_applications FOR SELECT TO authenticated
        USING (status = 'pending' AND (public.has_role(auth.uid(), 'marketplace_worker') OR public.has_role(auth.uid(), 'admin')));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'earning_transactions' AND policyname = 'Users can view own earning transactions') THEN
        CREATE POLICY "Users can view own earning transactions"
        ON public.earning_transactions FOR SELECT TO authenticated
        USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'Users can view own activity logs') THEN
        CREATE POLICY "Users can view own activity logs"
        ON public.activity_logs FOR SELECT TO authenticated
        USING (auth.uid() = actor_id OR public.has_role(auth.uid(), 'admin'));
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_product_listing(
    p_product_id UUID,
    p_status VARCHAR,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_product public.products%ROWTYPE;
    v_reward NUMERIC := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT (public.has_permission(auth.uid(), 'products.review') OR public.has_role(auth.uid(), 'admin')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product-review permission is required');
    END IF;
    IF p_status NOT IN ('approved', 'rejected') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid moderation decision');
    END IF;
    IF p_status = 'rejected' AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'A rejection reason is required');
    END IF;

    SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
    IF v_product IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product was not found');
    END IF;
    IF v_product.status <> 'pending_review' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This listing is no longer awaiting review');
    END IF;

    UPDATE public.products
    SET status = p_status,
        rejection_reason = CASE WHEN p_status = 'rejected' THEN trim(p_reason) ELSE NULL END,
        updated_at = NOW()
    WHERE id = p_product_id;

    SELECT reward_amount INTO v_reward
    FROM public.earning_rules
    WHERE role_name = 'marketplace_worker' AND action_type = 'product_review' AND is_active = TRUE
    LIMIT 1;

    IF COALESCE(v_reward, 0) > 0 THEN
        INSERT INTO public.earning_transactions (user_id, role_name, action_type, reference_id, amount, currency, status, description)
        VALUES (auth.uid(), 'marketplace_worker', 'product_review', p_product_id::text, v_reward, 'GMD', 'available',
            format('Product review: %s (%s)', v_product.title, p_status));
    END IF;

    INSERT INTO public.activity_logs (actor_id, action, target_type, target_id, metadata)
    VALUES (auth.uid(), 'product_moderated', 'product', p_product_id::text,
        jsonb_build_object('decision', p_status, 'reason', NULLIF(trim(COALESCE(p_reason, '')), '')));

    RETURN jsonb_build_object('success', true, 'status', p_status, 'reward_amount', COALESCE(v_reward, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.review_worker_application(
    p_application_id UUID,
    p_status VARCHAR,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_application public.worker_applications%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'marketplace_worker') OR public.has_role(auth.uid(), 'admin')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Operations authorization is required');
    END IF;
    IF p_status NOT IN ('approved', 'rejected') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid application decision');
    END IF;
    SELECT * INTO v_application FROM public.worker_applications WHERE id = p_application_id FOR UPDATE;
    IF v_application IS NULL OR v_application.status <> 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This application is no longer awaiting review');
    END IF;
    UPDATE public.worker_applications
    SET status = p_status, reviewed_by = auth.uid(), review_notes = p_notes, updated_at = NOW()
    WHERE id = p_application_id;
    INSERT INTO public.activity_logs (actor_id, action, target_type, target_id, metadata)
    VALUES (auth.uid(), 'worker_application_reviewed', 'worker_application', p_application_id::text, jsonb_build_object('decision', p_status));
    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_marketplace_report(
    p_report_id UUID,
    p_status VARCHAR,
    p_resolution TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_report public.reports%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR NOT (public.has_permission(auth.uid(), 'reports.review') OR public.has_role(auth.uid(), 'admin')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Report-review permission is required');
    END IF;
    IF p_status NOT IN ('investigating', 'resolved', 'dismissed') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid report status');
    END IF;
    SELECT * INTO v_report FROM public.reports WHERE id = p_report_id FOR UPDATE;
    IF v_report IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Report was not found');
    END IF;
    UPDATE public.reports
    SET status = p_status, reviewed_by = auth.uid(), resolution = COALESCE(NULLIF(trim(p_resolution), ''), resolution), updated_at = NOW()
    WHERE id = p_report_id;
    INSERT INTO public.activity_logs (actor_id, action, target_type, target_id, metadata)
    VALUES (auth.uid(), 'report_updated', 'report', p_report_id::text, jsonb_build_object('status', p_status));
    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_product_listing(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_worker_application(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_marketplace_report(UUID, VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderate_product_listing(UUID, VARCHAR, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_worker_application(UUID, VARCHAR, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_marketplace_report(UUID, VARCHAR, TEXT) TO authenticated;
