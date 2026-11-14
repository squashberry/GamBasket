-- GamBasket seller wallet and marketplace finance foundation.
-- This migration establishes auditable financial records and seller withdrawal requests.
-- It deliberately does NOT enable ModemPay checkout or send real transfers yet.
BEGIN;

CREATE TABLE IF NOT EXISTS public.gambasket_finance_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  commission_rate numeric(5,2) NOT NULL DEFAULT 5.00
    CHECK (commission_rate >= 0 AND commission_rate <= 100),
  seller_release_window_hours integer NOT NULL DEFAULT 24
    CHECK (seller_release_window_hours BETWEEN 1 AND 168),
  refund_provider_window_hours integer NOT NULL DEFAULT 48
    CHECK (refund_provider_window_hours BETWEEN 1 AND 720),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gambasket_finance_settings (id, commission_rate, seller_release_window_hours, refund_provider_window_hours)
VALUES (1, 5.00, 24, 48)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.gambasket_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'modempay' CHECK (provider = 'modempay'),
  provider_intent_id text,
  provider_reference text,
  idempotency_key text NOT NULL UNIQUE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','pending','succeeded','failed','cancelled','partially_refunded','refunded')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz,
  UNIQUE (provider, provider_intent_id),
  UNIQUE (provider, provider_reference)
);

CREATE INDEX IF NOT EXISTS gambasket_payments_order_idx
  ON public.gambasket_payments(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gambasket_payments_buyer_idx
  ON public.gambasket_payments(buyer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.gambasket_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'modempay' CHECK (provider = 'modempay'),
  provider_event_id text NOT NULL,
  payment_id uuid REFERENCES public.gambasket_payments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored','failed')),
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.seller_payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('wave','afrimoney')),
  account_number text NOT NULL CHECK (account_number ~ '^\\+?[0-9]{6,18}$'),
  beneficiary_name text NOT NULL CHECK (length(trim(beneficiary_name)) BETWEEN 2 AND 120),
  verification_status text NOT NULL DEFAULT 'pending_verification'
    CHECK (verification_status IN ('pending_verification','active','rejected','disabled')),
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_payout_methods_owner_idx
  ON public.seller_payout_methods(seller_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS seller_payout_methods_one_primary_idx
  ON public.seller_payout_methods(seller_id)
  WHERE is_primary = true AND verification_status = 'active';

CREATE TABLE IF NOT EXISTS public.seller_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payout_method_id uuid NOT NULL REFERENCES public.seller_payout_methods(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
  request_source text NOT NULL DEFAULT 'manual' CHECK (request_source IN ('manual','automatic')),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','processing','succeeded','failed','cancelled','reversed')),
  idempotency_key text NOT NULL,
  provider_reference text,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, idempotency_key),
  UNIQUE (provider_reference)
);

CREATE INDEX IF NOT EXISTS seller_payout_requests_owner_idx
  ON public.seller_payout_requests(seller_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS seller_payout_requests_queue_idx
  ON public.seller_payout_requests(status, requested_at);

CREATE TABLE IF NOT EXISTS public.seller_payout_events (
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

CREATE TABLE IF NOT EXISTS public.seller_wallet_preferences (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  auto_payout_enabled boolean NOT NULL DEFAULT false,
  auto_payout_threshold numeric(14,2) NOT NULL DEFAULT 0
    CHECK (auto_payout_threshold >= 0),
  payout_method_id uuid REFERENCES public.seller_payout_methods(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT auto_payout_enabled OR (auto_payout_threshold > 0 AND payout_method_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.order_refund_cases (
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

CREATE INDEX IF NOT EXISTS order_refund_cases_order_idx
  ON public.order_refund_cases(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_refund_cases_parties_idx
  ON public.order_refund_cases(buyer_id, seller_id, status);

CREATE TABLE IF NOT EXISTS public.order_refund_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_case_id uuid NOT NULL REFERENCES public.order_refund_cases(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'modempay' CHECK (provider = 'modempay'),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id)
);

-- The buyer OTP hash is private backend data. Clients never receive the hash or write confirmation timestamps.
CREATE TABLE IF NOT EXISTS public.delivery_otp_confirmations (
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

CREATE TABLE IF NOT EXISTS public.seller_wallet_ledger_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  source_type text NOT NULL
    CHECK (source_type IN ('payment','delivery_release','payout_request','payout_success','payout_failure','refund','admin_adjustment')),
  source_id uuid,
  description text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.seller_wallet_ledger_batches(id) ON DELETE RESTRICT,
  account_code text NOT NULL CHECK (account_code IN (
    'gateway_clearing',
    'seller_pending',
    'seller_available',
    'seller_payout_in_transit',
    'seller_reserve',
    'platform_commission',
    'delivery_payable'
  )),
  account_owner_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency text NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
  order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.gambasket_payments(id) ON DELETE RESTRICT,
  payout_request_id uuid REFERENCES public.seller_payout_requests(id) ON DELETE RESTRICT,
  refund_case_id uuid REFERENCES public.order_refund_cases(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  CHECK (
    (account_code IN ('seller_pending','seller_available','seller_payout_in_transit','seller_reserve') AND account_owner_id IS NOT NULL)
    OR
    (account_code IN ('gateway_clearing','platform_commission','delivery_payable') AND account_owner_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS seller_wallet_ledger_owner_idx
  ON public.seller_wallet_ledger_entries(account_owner_id, account_code, created_at DESC);
CREATE INDEX IF NOT EXISTS seller_wallet_ledger_batch_idx
  ON public.seller_wallet_ledger_entries(batch_id);
CREATE INDEX IF NOT EXISTS seller_wallet_ledger_order_idx
  ON public.seller_wallet_ledger_entries(order_id)
  WHERE order_id IS NOT NULL;

COMMENT ON TABLE public.seller_wallet_ledger_batches IS
  'Immutable, idempotent financial journal batches. Each batch must balance before commit.';
COMMENT ON TABLE public.seller_wallet_ledger_entries IS
  'Append-only double-entry journal. Seller wallet balances are credits minus debits in seller liability accounts.';
COMMENT ON TABLE public.delivery_otp_confirmations IS
  'Private delivery proof. OTP hashes and confirmation timestamps are accessible only to trusted backend operations.';

CREATE OR REPLACE FUNCTION public.assert_gambasket_ledger_batch_balanced()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_batch_id uuid;
  v_entry_count integer;
  v_debits numeric(16,2);
  v_credits numeric(16,2);
BEGIN
  IF TG_TABLE_NAME = 'seller_wallet_ledger_batches' THEN
    v_batch_id := NEW.id;
  ELSE
    v_batch_id := NEW.batch_id;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_entry_count, v_debits, v_credits
  FROM public.seller_wallet_ledger_entries
  WHERE batch_id = v_batch_id;

  IF v_entry_count < 2 OR v_debits <> v_credits THEN
    RAISE EXCEPTION 'Unbalanced GamBasket ledger batch: % (entries %, debits %, credits %)',
      v_batch_id, v_entry_count, v_debits, v_credits
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS seller_wallet_batch_balanced ON public.seller_wallet_ledger_batches;
CREATE CONSTRAINT TRIGGER seller_wallet_batch_balanced
AFTER INSERT ON public.seller_wallet_ledger_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_gambasket_ledger_batch_balanced();

DROP TRIGGER IF EXISTS seller_wallet_entries_balanced ON public.seller_wallet_ledger_entries;
CREATE CONSTRAINT TRIGGER seller_wallet_entries_balanced
AFTER INSERT ON public.seller_wallet_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_gambasket_ledger_batch_balanced();

CREATE OR REPLACE FUNCTION public.reject_gambasket_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'GamBasket financial ledger records are immutable';
END;
$fn$;

DROP TRIGGER IF EXISTS seller_wallet_batches_immutable ON public.seller_wallet_ledger_batches;
CREATE TRIGGER seller_wallet_batches_immutable
BEFORE UPDATE OR DELETE ON public.seller_wallet_ledger_batches
FOR EACH ROW EXECUTE FUNCTION public.reject_gambasket_ledger_mutation();

DROP TRIGGER IF EXISTS seller_wallet_entries_immutable ON public.seller_wallet_ledger_entries;
CREATE TRIGGER seller_wallet_entries_immutable
BEFORE UPDATE OR DELETE ON public.seller_wallet_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.reject_gambasket_ledger_mutation();

ALTER TABLE public.gambasket_finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gambasket_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gambasket_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_payout_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_payout_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_wallet_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_refund_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_refund_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_otp_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_wallet_ledger_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_wallet_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gambasket_finance_settings_read ON public.gambasket_finance_settings;
CREATE POLICY gambasket_finance_settings_read
ON public.gambasket_finance_settings FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS gambasket_payments_party_read ON public.gambasket_payments;
CREATE POLICY gambasket_payments_party_read
ON public.gambasket_payments FOR SELECT TO authenticated
USING (
  buyer_id = (SELECT auth.uid())
  OR public.is_gambasket_admin()
  OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = gambasket_payments.order_id AND o.seller_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS gambasket_payment_events_admin_read ON public.gambasket_payment_events;
CREATE POLICY gambasket_payment_events_admin_read
ON public.gambasket_payment_events FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

DROP POLICY IF EXISTS seller_payout_methods_owner_read ON public.seller_payout_methods;
CREATE POLICY seller_payout_methods_owner_read
ON public.seller_payout_methods FOR SELECT TO authenticated
USING (seller_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

DROP POLICY IF EXISTS seller_payout_requests_owner_read ON public.seller_payout_requests;
CREATE POLICY seller_payout_requests_owner_read
ON public.seller_payout_requests FOR SELECT TO authenticated
USING (seller_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

DROP POLICY IF EXISTS seller_payout_events_admin_read ON public.seller_payout_events;
CREATE POLICY seller_payout_events_admin_read
ON public.seller_payout_events FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

DROP POLICY IF EXISTS seller_wallet_preferences_owner_read ON public.seller_wallet_preferences;
CREATE POLICY seller_wallet_preferences_owner_read
ON public.seller_wallet_preferences FOR SELECT TO authenticated
USING (seller_id = (SELECT auth.uid()) OR public.is_gambasket_admin());

DROP POLICY IF EXISTS order_refund_cases_party_read ON public.order_refund_cases;
CREATE POLICY order_refund_cases_party_read
ON public.order_refund_cases FOR SELECT TO authenticated
USING (
  buyer_id = (SELECT auth.uid())
  OR seller_id = (SELECT auth.uid())
  OR public.is_gambasket_admin()
);

DROP POLICY IF EXISTS order_refund_events_admin_read ON public.order_refund_events;
CREATE POLICY order_refund_events_admin_read
ON public.order_refund_events FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

-- OTP rows are intentionally not exposed to authenticated clients, including the buyer and courier.
-- Access is reserved for narrowly scoped backend RPCs and service operations.

DROP POLICY IF EXISTS seller_wallet_batches_admin_read ON public.seller_wallet_ledger_batches;
CREATE POLICY seller_wallet_batches_admin_read
ON public.seller_wallet_ledger_batches FOR SELECT TO authenticated
USING (public.is_gambasket_admin());

DROP POLICY IF EXISTS seller_wallet_entries_owner_read ON public.seller_wallet_ledger_entries;
CREATE POLICY seller_wallet_entries_owner_read
ON public.seller_wallet_ledger_entries FOR SELECT TO authenticated
USING (
  account_owner_id = (SELECT auth.uid())
  OR public.is_gambasket_admin()
);

REVOKE ALL ON TABLE public.gambasket_finance_settings,
  public.gambasket_payments,
  public.gambasket_payment_events,
  public.seller_payout_methods,
  public.seller_payout_requests,
  public.seller_payout_events,
  public.seller_wallet_preferences,
  public.order_refund_cases,
  public.order_refund_events,
  public.delivery_otp_confirmations,
  public.seller_wallet_ledger_batches,
  public.seller_wallet_ledger_entries
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.gambasket_finance_settings,
  public.gambasket_payments,
  public.seller_payout_methods,
  public.seller_payout_requests,
  public.seller_wallet_preferences,
  public.order_refund_cases,
  public.seller_wallet_ledger_entries
TO authenticated;

CREATE OR REPLACE FUNCTION public.seller_get_wallet_summary()
RETURNS TABLE (
  pending_balance numeric,
  available_balance numeric,
  payout_in_transit numeric,
  withdrawn_total numeric,
  currency text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT
    COALESCE(SUM(e.credit - e.debit) FILTER (WHERE e.account_code = 'seller_pending'), 0)::numeric(14,2),
    COALESCE(SUM(e.credit - e.debit) FILTER (WHERE e.account_code = 'seller_available'), 0)::numeric(14,2),
    COALESCE(SUM(e.credit - e.debit) FILTER (WHERE e.account_code = 'seller_payout_in_transit'), 0)::numeric(14,2),
    COALESCE((
      SELECT SUM(p.amount)
      FROM public.seller_payout_requests p
      WHERE p.seller_id = (SELECT auth.uid()) AND p.status = 'succeeded'
    ), 0)::numeric(14,2),
    'GMD'::text
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id = (SELECT auth.uid());
$fn$;

CREATE OR REPLACE FUNCTION public.seller_add_payout_method(
  p_network text,
  p_account_number text,
  p_beneficiary_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
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
  IF v_network NOT IN ('wave','afrimoney') THEN
    RAISE EXCEPTION 'Unsupported payout network';
  END IF;
  IF v_account !~ '^\\+?[0-9]{6,18}$' THEN
    RAISE EXCEPTION 'Enter a valid mobile-money account number';
  END IF;
  IF length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Enter the beneficiary name';
  END IF;

  INSERT INTO public.seller_payout_methods (
    seller_id, network, account_number, beneficiary_name, is_primary, verification_status
  ) VALUES (
    v_user, v_network, v_account, v_name, false, 'pending_verification'
  )
  RETURNING id INTO v_method_id;

  RETURN v_method_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.seller_update_wallet_preferences(
  p_auto_payout_enabled boolean,
  p_auto_payout_threshold numeric,
  p_payout_method_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT public.has_role(v_user, 'seller'::character varying) THEN
    RAISE EXCEPTION 'Seller account required';
  END IF;

  IF p_auto_payout_enabled THEN
    IF COALESCE(p_auto_payout_threshold, 0) <= 0 THEN
      RAISE EXCEPTION 'Automatic payout threshold must be greater than zero';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.seller_payout_methods m
      WHERE m.id = p_payout_method_id
        AND m.seller_id = v_user
        AND m.verification_status = 'active'
    ) THEN
      RAISE EXCEPTION 'Choose an approved payout method before enabling automatic payouts';
    END IF;
  END IF;

  INSERT INTO public.seller_wallet_preferences (
    seller_id, auto_payout_enabled, auto_payout_threshold, payout_method_id
  ) VALUES (
    v_user, COALESCE(p_auto_payout_enabled, false),
    GREATEST(COALESCE(p_auto_payout_threshold, 0), 0),
    p_payout_method_id
  )
  ON CONFLICT (seller_id) DO UPDATE SET
    auto_payout_enabled = EXCLUDED.auto_payout_enabled,
    auto_payout_threshold = EXCLUDED.auto_payout_threshold,
    payout_method_id = EXCLUDED.payout_method_id,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'auto_payout_enabled', COALESCE(p_auto_payout_enabled, false),
    'auto_payout_threshold', GREATEST(COALESCE(p_auto_payout_threshold, 0), 0)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.seller_request_payout(
  p_amount numeric,
  p_payout_method_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
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
  IF length(v_key) < 12 OR length(v_key) > 128 THEN
    RAISE EXCEPTION 'A valid payout idempotency key is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  SELECT * INTO v_existing
  FROM public.seller_payout_requests
  WHERE seller_id = v_user AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.amount <> v_amount OR v_existing.payout_method_id <> p_payout_method_id THEN
      RAISE EXCEPTION 'Payout idempotency key was already used for a different request';
    END IF;
    RETURN jsonb_build_object(
      'success', true, 'payout_id', v_existing.id,
      'status', v_existing.status, 'amount', v_existing.amount,
      'idempotent_replay', true
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.seller_payout_methods m
    WHERE m.id = p_payout_method_id
      AND m.seller_id = v_user
      AND m.verification_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Choose an approved payout method';
  END IF;

  SELECT COALESCE(SUM(e.credit - e.debit), 0)::numeric(14,2)
  INTO v_available
  FROM public.seller_wallet_ledger_entries e
  WHERE e.account_owner_id = v_user AND e.account_code = 'seller_available';

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_BALANCE';
  END IF;

  INSERT INTO public.seller_payout_requests (
    seller_id, payout_method_id, amount, request_source, status, idempotency_key
  ) VALUES (
    v_user, p_payout_method_id, v_amount, 'manual', 'requested', v_key
  )
  RETURNING id INTO v_payout_id;

  INSERT INTO public.seller_wallet_ledger_batches (
    idempotency_key, source_type, source_id, description, created_by
  ) VALUES (
    'payout-reservation:' || v_key,
    'payout_request',
    v_payout_id,
    'Reserve seller funds for payout request',
    v_user
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.seller_wallet_ledger_entries (
    batch_id, account_code, account_owner_id, debit, currency, payout_request_id
  ) VALUES (
    v_batch_id, 'seller_available', v_user, v_amount, 'GMD', v_payout_id
  );

  INSERT INTO public.seller_wallet_ledger_entries (
    batch_id, account_code, account_owner_id, credit, currency, payout_request_id
  ) VALUES (
    v_batch_id, 'seller_payout_in_transit', v_user, v_amount, 'GMD', v_payout_id
  );

  RETURN jsonb_build_object(
    'success', true, 'payout_id', v_payout_id,
    'status', 'requested', 'amount', v_amount,
    'available_balance_after_request', v_available - v_amount,
    'idempotent_replay', false
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.assert_gambasket_ledger_batch_balanced() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_gambasket_ledger_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_get_wallet_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_add_payout_method(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_update_wallet_preferences(boolean,numeric,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_request_payout(numeric,uuid,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.seller_get_wallet_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_add_payout_method(text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_update_wallet_preferences(boolean,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_request_payout(numeric,uuid,text) TO authenticated;

COMMIT;
