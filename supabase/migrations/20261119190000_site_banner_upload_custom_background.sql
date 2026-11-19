-- Banner uploads and per-banner custom background colours.
BEGIN;

ALTER TABLE public.site_banners
  ADD COLUMN IF NOT EXISTS background_color text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.site_banners'::regclass
      AND conname = 'site_banners_background_color_hex'
  ) THEN
    ALTER TABLE public.site_banners
      ADD CONSTRAINT site_banners_background_color_hex
      CHECK (background_color IS NULL OR background_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END
$$;

-- Public reads are allowed; only signed-in JulaDirect admins can upload,
-- replace, or remove objects in this bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'site-banners',
  'site-banners',
  true,
  8388608,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 8388608,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[];

DROP POLICY IF EXISTS site_banners_public_object_read ON storage.objects;
CREATE POLICY site_banners_public_object_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'site-banners');

DROP POLICY IF EXISTS site_banners_admin_object_insert ON storage.objects;
CREATE POLICY site_banners_admin_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-banners' AND public.is_gambasket_admin());

DROP POLICY IF EXISTS site_banners_admin_object_update ON storage.objects;
CREATE POLICY site_banners_admin_object_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'site-banners' AND public.is_gambasket_admin())
  WITH CHECK (bucket_id = 'site-banners' AND public.is_gambasket_admin());

DROP POLICY IF EXISTS site_banners_admin_object_delete ON storage.objects;
CREATE POLICY site_banners_admin_object_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'site-banners' AND public.is_gambasket_admin());

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
      background_color, starts_at, ends_at, created_by
    ) VALUES (
      v_name, nullif(btrim(p_payload->>'kicker'), ''), v_head,
      nullif(btrim(p_payload->>'headline_right'), ''), nullif(btrim(p_payload->>'tagline'), ''),
      nullif(btrim(p_payload->>'body'), ''), nullif(btrim(p_payload->>'corner_label'), ''),
      nullif(btrim(p_payload->>'stat_value'), ''), nullif(btrim(p_payload->>'stat_label'), ''),
      nullif(btrim(p_payload->>'cta_label'), ''), nullif(btrim(p_payload->>'cta_url'), ''),
      nullif(btrim(p_payload->>'image_url'), ''),
      coalesce(nullif(p_payload->>'image_style', ''), 'cutout'),
      coalesce(nullif(p_payload->>'theme', ''), 'light'),
      nullif(btrim(p_payload->>'background_color'), ''),
      nullif(p_payload->>'starts_at', '')::timestamptz,
      nullif(p_payload->>'ends_at', '')::timestamptz,
      v_uid
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
      background_color = nullif(btrim(p_payload->>'background_color'), ''),
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

-- Give the currently live demo a calmer neutral base instead of the old blue.
UPDATE public.site_banners
SET background_color = '#EFE9DE',
    theme = 'light',
    updated_at = now()
WHERE id = '65e98e7f-4fc1-42db-9972-b289f691af26'::uuid
  AND name = 'JulaDirect sample — Made in The Gambia';

COMMIT;
