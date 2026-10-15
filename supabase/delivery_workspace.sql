-- Courier workspace support. This migration is additive and safe to run more than once.
-- Coordinates remain optional: an address-only order is deliberately rendered as an
-- approximate area rather than pretending it has an exact customer pin.

ALTER TABLE public.delivery_requests
    ADD COLUMN IF NOT EXISTS pickup_lat NUMERIC,
    ADD COLUMN IF NOT EXISTS pickup_lng NUMERIC,
    ADD COLUMN IF NOT EXISTS dropoff_lat NUMERIC,
    ADD COLUMN IF NOT EXISTS dropoff_lng NUMERIC,
    ADD COLUMN IF NOT EXISTS out_for_delivery_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_delivery_requests_status_worker
    ON public.delivery_requests (status, assigned_worker_id);

-- Delivery workers may only advance a request assigned to them, one valid step at a
-- time. Using an RPC avoids relying on broad client-side UPDATE permissions.
CREATE OR REPLACE FUNCTION public.update_delivery_job_status(
    p_request_id UUID,
    p_status VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request public.delivery_requests%ROWTYPE;
    v_order_status VARCHAR;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'delivery_worker') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Courier authorization is required');
    END IF;

    SELECT * INTO v_request
    FROM public.delivery_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery request not found');
    END IF;

    IF v_request.assigned_worker_id <> auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'This delivery is assigned to another courier');
    END IF;

    IF (v_request.status = 'assigned' AND p_status = 'picked_up') THEN
        v_order_status := 'picked_up';
        UPDATE public.delivery_requests
        SET status = p_status, picked_up_at = NOW(), updated_at = NOW()
        WHERE id = p_request_id;
    ELSIF (v_request.status = 'picked_up' AND p_status = 'out_for_delivery') THEN
        v_order_status := 'out_for_delivery';
        UPDATE public.delivery_requests
        SET status = p_status, out_for_delivery_at = NOW(), updated_at = NOW()
        WHERE id = p_request_id;
    ELSIF (v_request.status = 'out_for_delivery' AND p_status = 'delivered') THEN
        v_order_status := 'delivered';
        UPDATE public.delivery_requests
        SET status = p_status, delivered_at = NOW(), updated_at = NOW()
        WHERE id = p_request_id;

        UPDATE public.delivery_profiles
        SET status = 'available',
            total_completed_deliveries = COALESCE(total_completed_deliveries, 0) + 1,
            updated_at = NOW()
        WHERE user_id = auth.uid();
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'That delivery transition is not allowed');
    END IF;

    UPDATE public.orders
    SET order_status = v_order_status, updated_at = NOW()
    WHERE id = v_request.order_id;

    INSERT INTO public.delivery_status_history (delivery_request_id, status, updated_by, notes)
    VALUES (p_request_id, p_status, auth.uid(), 'Updated by assigned courier');

    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.update_delivery_job_status(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_delivery_job_status(UUID, VARCHAR) TO authenticated;
