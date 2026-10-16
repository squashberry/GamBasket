-- Explicitly deny direct client access to internal/legacy accounting and campaign tables.
-- SECURITY DEFINER routines and service-role jobs continue to use the internal records.
BEGIN;

REVOKE ALL ON TABLE public.affiliate_commissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.campaign_products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.earning_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payout_requests FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS deny_client_access ON public.affiliate_commissions;
DROP POLICY IF EXISTS deny_client_access ON public.campaign_products;
DROP POLICY IF EXISTS deny_client_access ON public.earning_rules;
DROP POLICY IF EXISTS deny_client_access ON public.payout_requests;

CREATE POLICY deny_client_access ON public.affiliate_commissions
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_client_access ON public.campaign_products
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_client_access ON public.earning_rules
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_client_access ON public.payout_requests
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMIT;
