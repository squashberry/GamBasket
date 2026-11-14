-- Seller wallet preferences, payout destinations and withdrawal reservations.
-- Provider transfers are still disabled until signed payout callbacks are implemented.
BEGIN;

CREATE TABLE public.seller_payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('wave','afrimoney')),
  account_number text NOT NULL CHECK (account_number ~ '^[+]?[0-9]{6,18}$'),
  beneficiary_name text NOT NULL CHECK (length(trim(beneficiary_name)) BETWEEN 2 AND 120),
  verification_status text NOT NULL DEFAULT 'pending_verification'
    CHECK (verification_status IN ('pending_verification','active','rejected','disabled')),
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX seller_payout_methods_owner_idx
  ON public.seller_payout_methods(seller_id, created_at DESC);
CREATE UNIQUE INDEX seller_payout_methods_one_primary_idx
  ON public.seller_payout_methods(seller_id)
  WHERE is_primary = true AND verification_status = 'active';

CREATE TABLE public.seller_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payout_method_id uuid NOT NULL REFERENCES public.seller_payout_methods(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
  request_source text NOT NULL DEFAULT 'manual' CHECK (request_source IN ('manual','automatic')),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','processing','succeeded','failed','cancelled','reversed')),
  idempotency_key text NOT NULL,
  provider_reference text UNIQUE,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, idempotency_key)
);

CREATE INDEX seller_payout_requests_owner_idx
  ON public.seller_payout_requests(seller_id, requested_at DESC);
CREATE INDEX seller_payout_requests_queue_idx
  ON public.seller_payout_requests(status, requested_at);

CREATE TABLE public.seller_payout_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_request_id uuid NOT NULL REFERENCES public.seller_payout_requests(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'modempay' CHECK (provider = 'modempay'),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id)
);

ALTER TABLE public.seller_wallet_ledger_entries
  ADD COLUMN payout_request_id uuid REFERENCES public.seller_payout_requests(id) ON DELETE RESTRICT;
CREATE INDEX seller_wallet_ledger_payout_idx
  ON public.seller_wallet_ledger_entries(payout_request_id)
  WHERE payout_request_id IS NOT NULL;

CREATE TABLE public.seller_wallet_preferences (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  auto_payout_enabled boolean NOT NULL DEFAULT false,
  auto_payout_threshold numeric(14,2) NOT NULL DEFAULT 0 CHECK (auto_payout_threshold >= 0),
  payout_method_id uuid REFERENCES public.seller_payout_methods(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT auto_payout_enabled OR (auto_payout_threshold > 0 AND payout_method_id IS NOT NULL))
);

ALTER TABLE public.seller_payout_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_payout_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_wallet_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY seller_payout_methods_owner_read
ON public.seller_payout_methods FOR SELECT TO authenticated
USING (seller_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

CREATE POLICY seller_payout_requests_owner_read
ON public.seller_payout_requests FOR SELECT TO authenticated
USING (seller_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

CREATE POLICY seller_payout_events_admin_read
ON public.seller_payout_events FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

CREATE POLICY seller_wallet_preferences_owner_read
ON public.seller_wallet_preferences FOR SELECT TO authenticated
USING (seller_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

REVOKE ALL ON TABLE public.seller_payout_methods, public.seller_payout_requests,
  public.seller_payout_events, public.seller_wallet_preferences
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.seller_payout_methods, public.seller_payout_requests,
  public.seller_payout_events, public.seller_wallet_preferences TO authenticated;

CREATE FUNCTION public.seller_get_wallet_summary()
RETURNS TABLE (
  pending_balance numeric,
  available_balance numeric,
  payout_in_transit numeric,
  withdrawn_total numeric,
  currency text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT
    COALESCE(SUM(e.credit - e.debit) FILTER (WHERE e.account_code = 'seller_pending'), 0)::numeric(14,2),
    COALESCE(SUM(e.credit - e.debit) FILTER (WHERE e.account_code = 'seller_available'), 0)::numeric(14,2),
    COALESCE(SUM(e.credit - e.debit) FILTER (WHERE e.account_code = 'seller_payout_in_transit'), 0)::numeric(14,2),
    COALESCE((
      SELECT SUM(p.amount) FROM public.seller_payout_requests p
      WHERE p.seller_id = (SELECT auth.uid()) AND p.status = 'succeeded'
    ), 0)::numeric(14,2),
    'GMD'::text
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id = (SELECT auth.uid());
$fn$;

CREATE FUNCTION public.seller_add_payout_method(
  p_network text, p_account_number text, p_beneficiary_name text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_network text := lower(trim(COALESCE(p_network, '')));
  v_account text := regexp_replace(trim(COALESCE(p_account_number, '')), '[[:space:]-]', '', 'g');
  v_name text := trim(COALESCE(p_beneficiary_name, ''));
  v_method_id uuid;
BEGIN
  IF v_user IS NULL OR NOT public.has_role(v_user, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Verified seller account required';
  END IF;
  IF v_network NOT IN ('wave','afrimoney') THEN RAISE EXCEPTION 'Unsupported payout network'; END IF;
  IF v_account !~ '^[+]?[0-9]{6,18}$' THEN RAISE EXCEPTION 'Enter a valid mobile-money number'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 120 THEN RAISE EXCEPTION 'Enter the beneficiary name'; END IF;

  INSERT INTO public.seller_payout_methods(seller_id, network, account_number, beneficiary_name)
  VALUES (v_user, v_network, v_account, v_name)
  RETURNING id INTO v_method_id;
  RETURN v_method_id;
END;
$fn$;

CREATE FUNCTION public.seller_update_wallet_preferences(
  p_auto_payout_enabled boolean,
  p_auto_payout_threshold numeric,
  p_payout_method_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT public.has_role(v_user, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller account required';
  END IF;
  IF COALESCE(p_auto_payout_enabled, false) THEN
    IF COALESCE(p_auto_payout_threshold, 0) <= 0 THEN
      RAISE EXCEPTION 'Automatic payout threshold must be greater than zero';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.seller_payout_methods m
      WHERE m.id = p_payout_method_id AND m.seller_id = v_user AND m.verification_status = 'active'
    ) THEN RAISE EXCEPTION 'Choose an approved payout method first'; END IF;
  END IF;

  INSERT INTO public.seller_wallet_preferences(
    seller_id, auto_payout_enabled, auto_payout_threshold, payout_method_id
  ) VALUES (
    v_user, COALESCE(p_auto_payout_enabled, false),
    GREATEST(COALESCE(p_auto_payout_threshold, 0), 0), p_payout_method_id
  )
  ON CONFLICT (seller_id) DO UPDATE SET
    auto_payout_enabled = EXCLUDED.auto_payout_enabled,
    auto_payout_threshold = EXCLUDED.auto_payout_threshold,
    payout_method_id = EXCLUDED.payout_method_id,
    updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$fn$;

CREATE FUNCTION public.seller_request_payout(
  p_amount numeric, p_payout_method_id uuid, p_idempotency_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_amount numeric(14,2) := round(COALESCE(p_amount, 0), 2);
  v_available numeric(14,2);
  v_existing public.seller_payout_requests%ROWTYPE;
  v_payout_id uuid;
  v_batch_id uuid;
  v_key text := trim(COALESCE(p_idempotency_key, ''));
BEGIN
  IF v_user IS NULL OR NOT public.has_role(v_user, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller account required';
  END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Payout amount must be greater than zero'; END IF;
  IF length(v_key) < 12 OR length(v_key) > 128 THEN RAISE EXCEPTION 'Valid idempotency key required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  SELECT * INTO v_existing FROM public.seller_payout_requests
  WHERE seller_id = v_user AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.amount <> v_amount OR v_existing.payout_method_id <> p_payout_method_id THEN
      RAISE EXCEPTION 'Idempotency key reused for a different payout';
    END IF;
    RETURN jsonb_build_object('success', true, 'payout_id', v_existing.id,
      'status', v_existing.status, 'amount', v_existing.amount, 'idempotent_replay', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.seller_payout_methods m
    WHERE m.id = p_payout_method_id AND m.seller_id = v_user AND m.verification_status = 'active'
  ) THEN RAISE EXCEPTION 'Choose an approved payout method'; END IF;

  SELECT COALESCE(SUM(e.credit - e.debit), 0)::numeric(14,2)
  INTO v_available FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id = v_user AND e.account_code = 'seller_available';
  IF v_amount > v_available THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_BALANCE'; END IF;

  INSERT INTO public.seller_payout_requests(
    seller_id, payout_method_id, amount, request_source, status, idempotency_key
  ) VALUES (v_user, p_payout_method_id, v_amount, 'manual', 'requested', v_key)
  RETURNING id INTO v_payout_id;

  INSERT INTO public.seller_wallet_ledger_batches(
    idempotency_key, source_type, source_id, description, created_by
  ) VALUES ('payout-reservation:' || v_key, 'payout_request', v_payout_id,
    'Reserve available seller funds for withdrawal', v_user)
  RETURNING id INTO v_batch_id;

  INSERT INTO public.seller_wallet_ledger_entries(
    batch_id, account_code, account_owner_id, debit, currency, payout_request_id
  ) VALUES (v_batch_id, 'seller_available', v_user, v_amount, 'GMD', v_payout_id);

  INSERT INTO public.seller_wallet_ledger_entries(
    batch_id, account_code, account_owner_id, credit, currency, payout_request_id
  ) VALUES (v_batch_id, 'seller_payout_in_transit', v_user, v_amount, 'GMD', v_payout_id);

  RETURN jsonb_build_object('success', true, 'payout_id', v_payout_id,
    'status', 'requested', 'amount', v_amount,
    'available_balance_after_request', v_available - v_amount, 'idempotent_replay', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.seller_get_wallet_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_add_payout_method(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_update_wallet_preferences(boolean,numeric,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_request_payout(numeric,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_get_wallet_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_add_payout_method(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_update_wallet_preferences(boolean,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_request_payout(numeric,uuid,text) TO authenticated;

COMMIT;
