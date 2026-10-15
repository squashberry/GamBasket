-- Restrict verification document references to the applicant's own private folder.
BEGIN;

DROP POLICY IF EXISTS verification_documents_owner_admin_read ON storage.objects;
CREATE POLICY verification_documents_owner_reviewer_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='verification-documents'
  AND (
    (storage.foldername(name))[1]=(SELECT auth.uid())::text
    OR public.is_gambasket_admin()
    OR public.has_role((SELECT auth.uid()),'marketplace_worker'::character varying)
  )
);

CREATE OR REPLACE FUNCTION public.guard_verification_document_paths()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user_prefix text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  v_user_prefix := auth.uid()::text || '/';

  IF TG_TABLE_NAME='worker_applications' THEN
    IF NEW.identity_document_path IS NULL
       OR left(NEW.identity_document_path,length(v_user_prefix))<>v_user_prefix THEN
      RAISE EXCEPTION 'The identity document must be inside your own private folder';
    END IF;
  ELSIF TG_TABLE_NAME='verification_requests' THEN
    IF NEW.identity_document_url IS NOT NULL
       AND left(NEW.identity_document_url,length(v_user_prefix))<>v_user_prefix THEN
      RAISE EXCEPTION 'The identity document must be inside your own private folder';
    END IF;
    IF NEW.business_document_url IS NOT NULL
       AND left(NEW.business_document_url,length(v_user_prefix))<>v_user_prefix THEN
      RAISE EXCEPTION 'The business document must be inside your own private folder';
    END IF;
    IF NEW.additional_document_url IS NOT NULL
       AND left(NEW.additional_document_url,length(v_user_prefix))<>v_user_prefix THEN
      RAISE EXCEPTION 'The additional document must be inside your own private folder';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_worker_application_document_path ON public.worker_applications;
CREATE TRIGGER trg_guard_worker_application_document_path
BEFORE INSERT OR UPDATE OF identity_document_path ON public.worker_applications
FOR EACH ROW EXECUTE FUNCTION public.guard_verification_document_paths();

DROP TRIGGER IF EXISTS trg_guard_verification_document_paths ON public.verification_requests;
CREATE TRIGGER trg_guard_verification_document_paths
BEFORE INSERT OR UPDATE OF identity_document_url,business_document_url,additional_document_url
ON public.verification_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_verification_document_paths();

DROP POLICY IF EXISTS worker_applications_insert_self ON public.worker_applications;
CREATE POLICY worker_applications_insert_self
ON public.worker_applications FOR INSERT TO authenticated
WITH CHECK (
  user_id=(SELECT auth.uid())
  AND worker_type IN ('delivery_worker','marketplace_worker')
  AND status='pending'
  AND identity_document_path IS NOT NULL
  AND identity_document_path LIKE ((SELECT auth.uid())::text || '/%')
);

COMMIT;
