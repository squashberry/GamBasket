-- Buyer refund case records and private courier + buyer delivery proof.
-- Confirmation and refund execution RPCs will be wired to signed provider events in the next phase.
BEGIN;

CREATE TABLE public.order_refund_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.gambasket_payments(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_amount numeric(14,2) NOT NULL CHECK (requested_amount > 0),
  currency text NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 80),
  description text,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','under_review','approved','rejected','provider_pending','succeeded','failed','withdrawn')),
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX order_refund_cases_order_idx
  ON public.order_refund_cases(order_id, created_at DESC);
CREATE INDEX order_refund_cases_parties_idx
  ON public.order_refund_cases(buyer_id, seller_id, status);

CREATE TABLE public.order_refund_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_case_id uuid NOT NULL REFERENCES public.order_refund_cases(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'modempay' CHECK (provider = 'modempay'),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider, provider_event_id)
);

-- The OTP hash is backend-only; never expose it to a buyer, courier or seller client.
CREATE TABLE public.delivery_otp_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  delivery_request_id uuid REFERENCES public.delivery_requests(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  courier_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  otp_hash bytea NOT NULL CHECK (octet_length(otp_hash) = 32),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 10),
  courier_marked_delivered_at timestamptz,
  buyer_confirmed_at timestamptz,
  dispute_until timestamptz,
  released_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at),
  CHECK (released_at IS NULL OR buyer_confirmed_at IS NOT NULL),
  CHECK (released_at IS NULL OR courier_marked_delivered_at IS NOT NULL)
);

COMMENT ON TABLE public.delivery_otp_confirmations IS
  'Private proof of delivery. OTP hashes and confirmation timestamps are written only by trusted backend functions.';

ALTER TABLE public.order_refund_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_refund_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_otp_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_refund_cases_party_read
ON public.order_refund_cases FOR SELECT TO authenticated
USING (
  buyer_id = (SELECT auth.uid())
  OR seller_id = (SELECT auth.uid())
  OR public.is_gambasket_admin()
);

CREATE POLICY order_refund_events_admin_read
ON public.order_refund_events FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

-- No client policy exists for delivery_otp_confirmations by design.
REVOKE ALL ON TABLE public.order_refund_cases, public.order_refund_events,
  public.delivery_otp_confirmations FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.order_refund_cases, public.order_refund_events TO authenticated;

COMMIT;
