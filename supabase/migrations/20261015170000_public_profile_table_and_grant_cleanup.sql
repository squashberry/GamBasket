-- Remove the public-profile security-definer view flagged by the advisor.
-- Use an RLS-protected table containing only fields intentionally safe for public display.
BEGIN;

DROP VIEW IF EXISTS public.public_profiles;

CREATE TABLE IF NOT EXISTS public.public_profiles (
  id uuid PRIMARY KEY,
  first_name character varying,
  last_name character varying,
  avatar_url text,
  country character varying,
  region character varying,
  area character varying
);

ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated;
DROP POLICY IF EXISTS public_profiles_read_safe_fields ON public.public_profiles;
CREATE POLICY public_profiles_read_safe_fields
  ON public.public_profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

INSERT INTO public.public_profiles (id, first_name, last_name, avatar_url, country, region, area)
SELECT id, first_name, last_name, avatar_url, country, region, area
FROM public.profiles
ON CONFLICT (id) DO UPDATE
SET first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    avatar_url = EXCLUDED.avatar_url,
    country = EXCLUDED.country,
    region = EXCLUDED.region,
    area = EXCLUDED.area;

CREATE OR REPLACE FUNCTION public.sync_public_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profiles WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.public_profiles (id, first_name, last_name, avatar_url, country, region, area)
  VALUES (NEW.id, NEW.first_name, NEW.last_name, NEW.avatar_url, NEW.country, NEW.region, NEW.area)
  ON CONFLICT (id) DO UPDATE
  SET first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      avatar_url = EXCLUDED.avatar_url,
      country = EXCLUDED.country,
      region = EXCLUDED.region,
      area = EXCLUDED.area;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_public_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_public_profile ON public.profiles;
CREATE TRIGGER trg_sync_public_profile
AFTER INSERT OR UPDATE OF first_name, last_name, avatar_url, country, region, area OR DELETE
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_public_profile();

-- Harden the two remaining legacy functions with mutable search_path settings.
ALTER FUNCTION public.handle_new_user() SET search_path TO '';
ALTER FUNCTION public.set_updated_at() SET search_path TO '';

-- Messages need INSERT for a signed-in participant and SELECT via RLS; callers cannot
-- rewrite or delete another participant's message after it has been sent.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.messages TO authenticated;

-- Worker applications are submitted by the applicant; reviews happen via guarded RPCs.
REVOKE UPDATE, DELETE ON TABLE public.worker_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.worker_applications TO authenticated;

COMMIT;
