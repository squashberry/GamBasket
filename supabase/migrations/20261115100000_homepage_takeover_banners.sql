-- Homepage takeover banners.
-- One full-screen banner can be live at a time. While it is live the homepage
-- hides the other banners and the central search bar. Admins manage banners
-- through the RPCs below; direct client writes are revoked, following the
-- pattern used by the other admin workflows in this repository.
-- Additive and idempotent: safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS public.site_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  is_active boolean NOT NULL DEFAULT false,
  kicker text CHECK (kicker IS NULL OR char_length(kicker) <= 40),
  headline_left text NOT NULL CHECK (char_length(btrim(headline_left)) BETWEEN 1 AND 60),
  headline_right text CHECK (headline_right IS NULL OR char_length(headline_right) <= 60),
  tagline text CHECK (tagline IS NULL OR char_length(tagline) <= 60),
  body text CHECK (body IS NULL OR char_length(body) <= 280),
  corner_label text CHECK (corner_label IS NULL OR char_length(corner_label) <= 60),
  stat_value text CHECK (stat_value IS NULL OR char_length(stat_value) <= 16),
  stat_label text CHECK (stat_label IS NULL OR char_length(stat_label) <= 40),
  cta_label text CHECK (cta_label IS NULL OR char_length(cta_label) <= 30),
  -- Relative path (no colon, so javascript: and data: can never match) or https.
  cta_url text CHECK (cta_url IS NULL OR (char_length(cta_url) <= 300 AND (cta_url ~ '^https://[^[:space:]]+$' OR cta_url ~ '^[A-Za-z0-9_./?=&#%-]+$'))),
  image_url text CHECK (image_url IS NULL OR (char_length(image_url) <= 600 AND image_url ~ '^https://[^[:space:]]+$')),
  image_style text NOT NULL DEFAULT 'cutout' CHECK (image_style IN ('cutout', 'framed')),
  theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'blue')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_banners_schedule_order CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- At most one live banner, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS site_banners_single_live ON public.site_banners ((true)) WHERE is_active;

ALTER TABLE public.site_banners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_banners FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.site_banners TO anon, authenticated;

-- Visitors see only the live banner inside its schedule; admins see everything.
DROP POLICY IF EXISTS site_banners_public_live_read ON public.site_banners;
CREATE POLICY site_banners_public_live_read ON public.site_banners
FOR SELECT TO anon, authenticated
USING (
  public.is_gambasket_admin()
  OR (
    is_active
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
  )
);

-- Create or update a banner. Does not change is_active (use the toggle RPC).
CREATE OR REPLACE FUNCTION public.admin_save_site_banner(p_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text;
  v_head text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_gambasket_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid banner payload' USING ERRCODE = '22023';
  END IF;

  v_name := nullif(btrim(p_payload->>'name'), '');
  v_head := nullif(btrim(p_payload->>'headline_left'), '');
  IF v_name IS NULL OR v_head IS NULL THEN
    RAISE EXCEPTION 'A banner name and a main headline are required' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.site_banners (
      name, kicker, headline_left, headline_right, tagline, body, corner_label,
      stat_value, stat_label, cta_label, cta_url, image_url, image_style, theme,
      starts_at, ends_at, created_by
    ) VALUES (
      v_name, nullif(btrim(p_payload->>'kicker'), ''), v_head,
      nullif(btrim(p_payload->>'headline_right'), ''), nullif(btrim(p_payload->>'tagline'), ''),
      nullif(btrim(p_payload->>'body'), ''), nullif(btrim(p_payload->>'corner_label'), ''),
      nullif(btrim(p_payload->>'stat_value'), ''), nullif(btrim(p_payload->>'stat_label'), ''),
      nullif(btrim(p_payload->>'cta_label'), ''), nullif(btrim(p_payload->>'cta_url'), ''),
      nullif(btrim(p_payload->>'image_url'), ''),
      coalesce(nullif(p_payload->>'image_style', ''), 'cutout'), coalesce(nullif(p_payload->>'theme', ''), 'light'),
      nullif(p_payload->>'starts_at', '')::timestamptz, nullif(p_payload->>'ends_at', '')::timestamptz, v_uid
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.site_banners SET
      name = v_name,
      kicker = nullif(btrim(p_payload->>'kicker'), ''),
      headline_left = v_head,
      headline_right = nullif(btrim(p_payload->>'headline_right'), ''),
      tagline = nullif(btrim(p_payload->>'tagline'), ''),
      body = nullif(btrim(p_payload->>'body'), ''),
      corner_label = nullif(btrim(p_payload->>'corner_label'), ''),
      stat_value = nullif(btrim(p_payload->>'stat_value'), ''),
      stat_label = nullif(btrim(p_payload->>'stat_label'), ''),
      cta_label = nullif(btrim(p_payload->>'cta_label'), ''),
      cta_url = nullif(btrim(p_payload->>'cta_url'), ''),
      image_url = nullif(btrim(p_payload->>'image_url'), ''),
      image_style = coalesce(nullif(p_payload->>'image_style', ''), 'cutout'),
      theme = coalesce(nullif(p_payload->>'theme', ''), 'light'),
      starts_at = nullif(p_payload->>'starts_at', '')::timestamptz,
      ends_at = nullif(p_payload->>'ends_at', '')::timestamptz,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Banner not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- Turn a banner on (turning every other banner off) or off.
CREATE OR REPLACE FUNCTION public.admin_set_site_banner_active(p_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_gambasket_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.site_banners WHERE id = p_id) THEN
    RAISE EXCEPTION 'Banner not found' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(p_active, false) THEN
    UPDATE public.site_banners SET is_active = false, updated_at = now() WHERE is_active AND id <> p_id;
  END IF;
  UPDATE public.site_banners SET is_active = coalesce(p_active, false), updated_at = now() WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_site_banner(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_gambasket_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.site_banners WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_site_banner(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_site_banner_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_site_banner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_site_banner(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_site_banner_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_site_banner(uuid) TO authenticated;

COMMIT;
