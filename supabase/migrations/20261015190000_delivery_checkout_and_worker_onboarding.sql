-- GamBasket checkout/delivery lifecycle, worker onboarding, and private verification files.
BEGIN;

-- Government identity documents must never be stored in public Cloudinary URLs.
ALTER TABLE public.worker_applications
  ADD COLUMN IF NOT EXISTS identity_document_path text;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES (
  'verification-documents',
  'verification-documents',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
ON CONFLICT(id) DO UPDATE
SET name='verification-documents',
    public=false,
    file_size_limit=5242880,
    allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','application/pdf']::text[];

DROP POLICY IF EXISTS verification_documents_owner_insert ON storage.objects;
CREATE POLICY verification_documents_owner_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='verification-documents'
  AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
);

DROP POLICY IF EXISTS verification_documents_owner_admin_read ON storage.objects;
CREATE POLICY verification_documents_owner_admin_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='verification-documents'
  AND (
    (storage.foldername(name))[1]=(SELECT auth.uid())::text
    OR public.is_gambasket_admin()
  )
);

-- Applicant rows go into the table reviewed by the operations console.
DROP POLICY IF EXISTS worker_applications_insert_self ON public.worker_applications;
CREATE POLICY worker_applications_insert_self
ON public.worker_applications FOR INSERT TO authenticated
WITH CHECK (
  user_id=(SELECT auth.uid())
  AND worker_type IN ('delivery_worker','marketplace_worker')
  AND status='pending'
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_application_one_pending_role_uidx
ON public.worker_applications(user_id,worker_type)
WHERE status='pending' AND user_id IS NOT NULL;

-- Drop a redundant unique index introduced while the seller uniqueness was being hardened.
DROP INDEX IF EXISTS public.stores_seller_id_uidx;

-- Internal order functions are allowed to alter stock and sales counters, but not listing content.
CREATE OR REPLACE FUNCTION public.guard_product_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_admin boolean := public.is_gambasket_admin();
  v_moderator boolean := public.has_role(auth.uid(),'marketplace_worker'::character varying);
  v_stock_delta integer;
  v_sales_delta integer;
BEGIN
  IF v_admin THEN RETURN NEW; END IF;

  IF TG_OP='INSERT' THEN
    IF auth.uid() IS NULL OR NEW.seller_id IS DISTINCT FROM auth.uid()
       OR NOT (public.has_role(auth.uid(),'seller'::character varying)
               OR public.has_role(auth.uid(),'supplier'::character varying)) THEN
      RAISE EXCEPTION 'An active seller or supplier may only create their own listings';
    END IF;
    NEW.status:='pending_review';
    NEW.rejection_reason:=NULL;
    NEW.is_featured:=false;
    NEW.featured_until:=NULL;
    NEW.views_count:=0;
    NEW.sales_count:=0;
    NEW.verification_status:='unverified';
    RETURN NEW;
  END IF;

  IF current_setting('app.gambasket_internal',true)='on'
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.seller_id IS NOT DISTINCT FROM OLD.seller_id
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.subcategory_id IS NOT DISTINCT FROM OLD.subcategory_id
     AND NEW.condition IS NOT DISTINCT FROM OLD.condition
     AND NEW.location IS NOT DISTINCT FROM OLD.location
     AND NEW.main_image IS NOT DISTINCT FROM OLD.main_image
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.rejection_reason IS NOT DISTINCT FROM OLD.rejection_reason
     AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
     AND NEW.wholesale_price IS NOT DISTINCT FROM OLD.wholesale_price
     AND NEW.minimum_order_quantity IS NOT DISTINCT FROM OLD.minimum_order_quantity
     AND NEW.retail_suggested_price IS NOT DISTINCT FROM OLD.retail_suggested_price
     AND NEW.fulfillment_type IS NOT DISTINCT FROM OLD.fulfillment_type
     AND NEW.listing_type IS NOT DISTINCT FROM OLD.listing_type
     AND NEW.min_order_quantity IS NOT DISTINCT FROM OLD.min_order_quantity
     AND NEW.wholesale_currency IS NOT DISTINCT FROM OLD.wholesale_currency
     AND NEW.wholesale_enabled IS NOT DISTINCT FROM OLD.wholesale_enabled
     AND NEW.featured_until IS NOT DISTINCT FROM OLD.featured_until
     AND NEW.promotion_id IS NOT DISTINCT FROM OLD.promotion_id
     AND NEW.searchable IS NOT DISTINCT FROM OLD.searchable
     AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status
     AND NEW.views_count IS NOT DISTINCT FROM OLD.views_count
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  -- Moderators can change the moderation status/reason only.
  IF v_moderator
     AND NEW.seller_id IS NOT DISTINCT FROM OLD.seller_id
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.currency IS NOT DISTINCT FROM OLD.currency
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.subcategory_id IS NOT DISTINCT FROM OLD.subcategory_id
     AND NEW.condition IS NOT DISTINCT FROM OLD.condition
     AND NEW.location IS NOT DISTINCT FROM OLD.location
     AND NEW.main_image IS NOT DISTINCT FROM OLD.main_image
     AND NEW.stock IS NOT DISTINCT FROM OLD.stock
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
     AND NEW.wholesale_price IS NOT DISTINCT FROM OLD.wholesale_price
     AND NEW.minimum_order_quantity IS NOT DISTINCT FROM OLD.minimum_order_quantity
     AND NEW.retail_suggested_price IS NOT DISTINCT FROM OLD.retail_suggested_price
     AND NEW.fulfillment_type IS NOT DISTINCT FROM OLD.fulfillment_type
     AND NEW.listing_type IS NOT DISTINCT FROM OLD.listing_type
     AND NEW.min_order_quantity IS NOT DISTINCT FROM OLD.min_order_quantity
     AND NEW.wholesale_currency IS NOT DISTINCT FROM OLD.wholesale_currency
     AND NEW.wholesale_enabled IS NOT DISTINCT FROM OLD.wholesale_enabled
     AND NEW.promotion_id IS NOT DISTINCT FROM OLD.promotion_id
     AND NEW.searchable IS NOT DISTINCT FROM OLD.searchable
     AND NEW.is_featured IS NOT DISTINCT FROM OLD.is_featured
     AND NEW.featured_until IS NOT DISTINCT FROM OLD.featured_until
     AND NEW.views_count IS NOT DISTINCT FROM OLD.views_count
     AND NEW.sales_count IS NOT DISTINCT FROM OLD.sales_count
     AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
     AND NEW.status IN ('approved','rejected','suspended','pending_review') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR OLD.seller_id IS DISTINCT FROM auth.uid() THEN
    IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
       OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
       OR NEW.featured_until IS DISTINCT FROM OLD.featured_until
       OR NEW.views_count IS DISTINCT FROM OLD.views_count
       OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.price IS DISTINCT FROM OLD.price
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.category_id IS DISTINCT FROM OLD.category_id
       OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
       OR NEW.condition IS DISTINCT FROM OLD.condition
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.main_image IS DISTINCT FROM OLD.main_image
       OR NEW.listing_type IS DISTINCT FROM OLD.listing_type
       OR NEW.wholesale_price IS DISTINCT FROM OLD.wholesale_price
       OR NEW.retail_suggested_price IS DISTINCT FROM OLD.retail_suggested_price
       OR NEW.minimum_order_quantity IS DISTINCT FROM OLD.minimum_order_quantity
       OR NEW.min_order_quantity IS DISTINCT FROM OLD.min_order_quantity
       OR NEW.wholesale_currency IS DISTINCT FROM OLD.wholesale_currency
       OR NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled
       OR NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type
       OR NEW.promotion_id IS DISTINCT FROM OLD.promotion_id
       OR NEW.searchable IS DISTINCT FROM OLD.searchable THEN
      RAISE EXCEPTION 'Only a seller or validated server operation may change listing fields';
    END IF;

    v_stock_delta:=OLD.stock-NEW.stock;
    v_sales_delta:=NEW.sales_count-OLD.sales_count;
    IF v_stock_delta IS DISTINCT FROM v_sales_delta OR v_stock_delta=0 THEN
      RAISE EXCEPTION 'Inventory changes must represent a matching sale or cancellation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (public.has_role(auth.uid(),'seller'::character varying)
          OR public.has_role(auth.uid(),'supplier'::character varying)) THEN
    RAISE EXCEPTION 'Seller or supplier role required';
  END IF;

  IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     OR NEW.is_featured IS DISTINCT FROM OLD.is_featured
     OR NEW.featured_until IS DISTINCT FROM OLD.featured_until
     OR NEW.views_count IS DISTINCT FROM OLD.views_count
     OR NEW.sales_count IS DISTINCT FROM OLD.sales_count
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
     OR NEW.promotion_id IS DISTINCT FROM OLD.promotion_id THEN
    RAISE EXCEPTION 'Moderation, ownership, supplier and counter fields are protected';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'A seller cannot approve or reject a listing';
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
     OR NEW.condition IS DISTINCT FROM OLD.condition
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.main_image IS DISTINCT FROM OLD.main_image
     OR NEW.listing_type IS DISTINCT FROM OLD.listing_type
     OR NEW.wholesale_price IS DISTINCT FROM OLD.wholesale_price
     OR NEW.retail_suggested_price IS DISTINCT FROM OLD.retail_suggested_price
     OR NEW.minimum_order_quantity IS DISTINCT FROM OLD.minimum_order_quantity
     OR NEW.min_order_quantity IS DISTINCT FROM OLD.min_order_quantity
     OR NEW.wholesale_currency IS DISTINCT FROM OLD.wholesale_currency
     OR NEW.wholesale_enabled IS DISTINCT FROM OLD.wholesale_enabled
     OR NEW.fulfillment_type IS DISTINCT FROM OLD.fulfillment_type
     OR NEW.searchable IS DISTINCT FROM OLD.searchable THEN
    NEW.status:='pending_review';
    NEW.rejection_reason:=NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

-- New checkout is the single path that creates orders/order items and reserves stock.
CREATE OR REPLACE FUNCTION public.create_order(
  p_items jsonb,
  p_fulfillment_type character varying,
  p_delivery_address text DEFAULT NULL,
  p_delivery_region character varying DEFAULT NULL,
  p_delivery_area character varying DEFAULT NULL,
  p_delivery_phone character varying DEFAULT NULL,
  p_delivery_instructions text DEFAULT NULL,
  p_payment_method character varying DEFAULT 'cash_on_delivery',
  p_coupon_code character varying DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_buyer uuid := auth.uid();
  v_item jsonb;
  v_product record;
  v_order_id uuid;
  v_order_number varchar(50);
  v_seller_id uuid;
  v_pickup_location text;
  v_subtotal numeric(12,2) := 0;
  v_delivery_fee numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_total numeric(12,2);
  v_quantity integer;
  v_product_id uuid;
  v_coupon record;
  v_coupon_code varchar(50);
BEGIN
  IF v_buyer IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'CART_EMPTY'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS line(value)
    GROUP BY line.value->>'product_id'
    HAVING COUNT(*)>1
  ) THEN RAISE EXCEPTION 'DUPLICATE_PRODUCT_IN_CART'; END IF;
  IF p_fulfillment_type NOT IN ('delivery','pickup') THEN RAISE EXCEPTION 'INVALID_FULFILLMENT'; END IF;
  IF p_payment_method NOT IN ('cash_on_delivery','wave','qmoney','afrimoney') THEN RAISE EXCEPTION 'INVALID_PAYMENT_METHOD'; END IF;

  IF p_fulfillment_type='delivery' THEN
    IF NULLIF(trim(COALESCE(p_delivery_address,'')),'') IS NULL
       OR NULLIF(trim(COALESCE(p_delivery_area,'')),'') IS NULL
       OR NULLIF(trim(COALESCE(p_delivery_phone,'')),'') IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_DETAILS_REQUIRED';
    END IF;
    v_delivery_fee:=100;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id:=NULLIF(v_item->>'product_id','')::uuid;
    v_quantity:=(v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity<1 OR v_quantity>1000 THEN RAISE EXCEPTION 'INVALID_QUANTITY'; END IF;

    SELECT id,seller_id,title,price,stock,location,status
    INTO v_product
    FROM public.products
    WHERE id=v_product_id
    FOR UPDATE;

    IF NOT FOUND OR v_product.status<>'approved' THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE:%',v_product_id; END IF;
    IF v_product.seller_id IS NULL THEN RAISE EXCEPTION 'PRODUCT_SELLER_MISSING:%',v_product_id; END IF;
    IF v_product.stock<v_quantity THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK:%',v_product.title; END IF;

    IF v_seller_id IS NULL THEN
      v_seller_id:=v_product.seller_id;
      v_pickup_location:=NULLIF(trim(v_product.location),'');
    ELSIF v_seller_id IS DISTINCT FROM v_product.seller_id THEN
      RAISE EXCEPTION 'MULTIPLE_SELLERS_NOT_SUPPORTED';
    END IF;
    v_subtotal:=v_subtotal+(v_product.price*v_quantity);
  END LOOP;

  IF v_seller_id IS NULL THEN RAISE EXCEPTION 'PRODUCT_SELLER_MISSING'; END IF;
  SELECT COALESCE(
    (SELECT NULLIF(trim(s.location),'') FROM public.stores s WHERE s.seller_id=v_seller_id AND s.is_active=true LIMIT 1),
    v_pickup_location,
    'Seller pickup location'
  ) INTO v_pickup_location;

  v_coupon_code:=NULLIF(upper(trim(COALESCE(p_coupon_code,''))),'');
  IF v_coupon_code IS NOT NULL THEN
    SELECT * INTO v_coupon FROM public.coupons
    WHERE code=v_coupon_code AND is_active=true
      AND (starts_at IS NULL OR starts_at<=now())
      AND (ends_at IS NULL OR ends_at>=now())
      AND (usage_limit IS NULL OR usage_count<usage_limit)
    FOR UPDATE;
    IF NOT FOUND OR v_subtotal<v_coupon.minimum_order THEN RAISE EXCEPTION 'INVALID_COUPON'; END IF;
    IF v_coupon.discount_type='percentage' THEN
      v_discount:=v_subtotal*v_coupon.discount_value/100;
      IF v_coupon.maximum_discount IS NOT NULL THEN v_discount:=LEAST(v_discount,v_coupon.maximum_discount); END IF;
    ELSE
      v_discount:=LEAST(v_coupon.discount_value,v_subtotal);
    END IF;
    UPDATE public.coupons SET usage_count=usage_count+1,updated_at=now() WHERE id=v_coupon.id;
  END IF;

  v_total:=GREATEST(0,v_subtotal+v_delivery_fee-v_discount);
  v_order_number:='GB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  INSERT INTO public.orders(
    order_number,buyer_id,seller_id,fulfillment_type,delivery_address,delivery_region,delivery_area,
    delivery_phone,delivery_instructions,pickup_location,subtotal,delivery_fee,total,payment_status,payment_method,order_status
  ) VALUES (
    v_order_number,v_buyer,v_seller_id,p_fulfillment_type,p_delivery_address,p_delivery_region,p_delivery_area,
    p_delivery_phone,p_delivery_instructions,v_pickup_location,v_subtotal,v_delivery_fee,v_total,'pending',p_payment_method,'pending'
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items(order_id,product_id,title,price,quantity,subtotal)
  SELECT v_order_id,p.id,p.title,p.price,(line.value->>'quantity')::integer,
         p.price*(line.value->>'quantity')::integer
  FROM jsonb_array_elements(p_items) AS line(value)
  JOIN public.products p ON p.id=(line.value->>'product_id')::uuid;

  PERFORM set_config('app.gambasket_internal','on',true);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE public.products
    SET stock=stock-(v_item->>'quantity')::integer,
        sales_count=COALESCE(sales_count,0)+(v_item->>'quantity')::integer,
        updated_at=now()
    WHERE id=(v_item->>'product_id')::uuid;
  END LOOP;

  IF p_fulfillment_type='delivery' THEN
    INSERT INTO public.delivery_requests(
      order_id,pickup_location,delivery_destination,delivery_area,estimated_fee,status
    ) VALUES (
      v_order_id,v_pickup_location,p_delivery_address,p_delivery_area,v_delivery_fee,'awaiting_seller'
    );
  END IF;

  INSERT INTO public.order_status_history(order_id,to_status,changed_by,notes)
  VALUES(v_order_id,'pending',v_buyer,'Order placed by buyer');

  DELETE FROM public.cart_items WHERE user_id=v_buyer;

  INSERT INTO public.notifications(user_id,type,title,message,data)
  VALUES
    (v_buyer,'order','Order placed','Your GamBasket order '||v_order_number||' has been received.',jsonb_build_object('order_id',v_order_id)),
    (v_seller_id,'seller','New order received','A new GamBasket order '||v_order_number||' is waiting for review.',jsonb_build_object('order_id',v_order_id));

  RETURN jsonb_build_object(
    'id',v_order_id,'order_number',v_order_number,'subtotal',v_subtotal,'delivery_fee',v_delivery_fee,
    'discount',v_discount,'total',v_total,'payment_status','pending','order_status','pending'
  );
END;
$fn$;

-- Restock/counter rollback is part of cancellation, so a cancelled order cannot strand stock.
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE o public.orders%ROWTYPE; old_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO o FROM public.orders
  WHERE buyer_id=auth.uid() AND (order_number=p_order_number OR id::text=p_order_number)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF o.order_status NOT IN ('pending','confirmed') THEN
    RAISE EXCEPTION 'This order can no longer be cancelled by the buyer';
  END IF;

  old_status:=o.order_status;
  PERFORM set_config('app.gambasket_internal','on',true);
  UPDATE public.products p
  SET stock=p.stock+oi.quantity,
      sales_count=GREATEST(COALESCE(p.sales_count,0)-oi.quantity,0),
      updated_at=now()
  FROM public.order_items oi
  WHERE oi.order_id=o.id AND oi.product_id=p.id;

  UPDATE public.delivery_requests
  SET status='cancelled',updated_at=now()
  WHERE order_id=o.id AND status IN ('awaiting_seller','pending');

  UPDATE public.orders SET order_status='cancelled',cancellation_reason='Cancelled by buyer',updated_at=now()
  WHERE id=o.id RETURNING * INTO o;

  INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,notes)
  VALUES(o.id,old_status,'cancelled',auth.uid(),'Buyer cancelled order');

  INSERT INTO public.notifications(user_id,type,title,message,data)
  VALUES(o.seller_id,'order','Order cancelled','Order '||o.order_number||' was cancelled by the buyer.',jsonb_build_object('order_id',o.id));

  RETURN jsonb_build_object('id',o.id,'order_number',o.order_number,'order_status',o.order_status);
END;
$fn$;

-- Seller actions are limited to seller-side transitions; only the courier RPC can
-- advance an assigned delivery through pickup, transit and delivery.
CREATE OR REPLACE FUNCTION public.seller_update_order_status(p_order_id uuid,p_next_status text,p_reason text DEFAULT NULL)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE o public.orders%ROWTYPE; old_status text; allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT public.is_gambasket_admin()
     AND (o.seller_id IS DISTINCT FROM auth.uid() OR NOT public.has_role(auth.uid(),'seller'::character varying)) THEN
    RAISE EXCEPTION 'Seller access required';
  END IF;

  old_status:=o.order_status;
  allowed:=CASE old_status
    WHEN 'pending' THEN p_next_status IN ('confirmed','cancelled')
    WHEN 'confirmed' THEN p_next_status IN ('processing','cancelled')
    WHEN 'processing' THEN p_next_status IN ('ready_for_pickup','ready_for_delivery','cancelled')
    WHEN 'ready_for_delivery' THEN p_next_status='cancelled'
    WHEN 'ready_for_pickup' THEN p_next_status IN ('completed','delivered','cancelled')
    WHEN 'delivered' THEN p_next_status='completed'
    ELSE false
  END;
  IF NOT COALESCE(allowed,false) THEN RAISE EXCEPTION 'Invalid order status transition: % -> %',old_status,p_next_status; END IF;
  IF o.fulfillment_type='delivery' AND p_next_status IN ('completed','delivered') THEN
    RAISE EXCEPTION 'Delivery orders must be completed through the delivery-worker workflow';
  END IF;

  IF p_next_status='cancelled' THEN
    p_reason:=COALESCE(NULLIF(trim(p_reason),''),'Cancelled by seller');
    PERFORM set_config('app.gambasket_internal','on',true);
    UPDATE public.products p
    SET stock=p.stock+oi.quantity,
        sales_count=GREATEST(COALESCE(p.sales_count,0)-oi.quantity,0),
        updated_at=now()
    FROM public.order_items oi
    WHERE oi.order_id=o.id AND oi.product_id=p.id;

    UPDATE public.delivery_requests
    SET status='cancelled',updated_at=now()
    WHERE order_id=o.id AND status IN ('awaiting_seller','pending');
  END IF;

  UPDATE public.orders SET order_status=p_next_status,
    cancellation_reason=CASE WHEN p_next_status='cancelled' THEN p_reason ELSE cancellation_reason END,
    updated_at=now()
  WHERE id=p_order_id RETURNING * INTO o;

  IF p_next_status='ready_for_delivery' THEN
    INSERT INTO public.delivery_requests(order_id,pickup_location,delivery_destination,delivery_area,estimated_fee,status)
    VALUES(o.id,COALESCE(o.pickup_location,'Seller pickup location'),COALESCE(o.delivery_address,'Delivery destination'),
      o.delivery_area,COALESCE(o.delivery_fee,100),'pending')
    ON CONFLICT(order_id) DO UPDATE
      SET status='pending',updated_at=now()
      WHERE public.delivery_requests.status IN ('awaiting_seller','pending');
  END IF;

  INSERT INTO public.order_status_history(order_id,from_status,to_status,changed_by,notes)
  VALUES(o.id,old_status,p_next_status,auth.uid(),NULLIF(trim(p_reason),''));

  RETURN o;
END;
$fn$;

-- Delivery operations may update verified courier records internally, not through direct client writes.
CREATE OR REPLACE FUNCTION public.guard_delivery_profile_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
  IF current_setting('app.gambasket_internal',true)='on' THEN RETURN NEW; END IF;
  IF public.is_gambasket_admin() THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You may only update your own delivery profile';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.rating IS DISTINCT FROM OLD.rating
     OR NEW.total_completed_deliveries IS DISTINCT FROM OLD.total_completed_deliveries
     OR NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
     OR NEW.delivery_areas IS DISTINCT FROM OLD.delivery_areas
     OR NEW.current_location IS DISTINCT FROM OLD.current_location THEN
    RAISE EXCEPTION 'Courier identity, verification and performance fields are protected';
  END IF;
  IF NEW.status NOT IN ('available','offline','delivering') THEN RAISE EXCEPTION 'Invalid courier availability state'; END IF;
  IF NEW.status='delivering' AND NOT EXISTS (
    SELECT 1 FROM public.delivery_requests dr
    WHERE dr.assigned_worker_id=auth.uid() AND dr.status IN ('assigned','picked_up','out_for_delivery')
  ) THEN RAISE EXCEPTION 'A courier can only enter delivering state after claiming a job'; END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_set_verification(p_request_id uuid,p_status character varying,p_notes text DEFAULT NULL)
RETURNS public.verification_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE r public.verification_requests%ROWTYPE; profile_phone text; profile_location text;
BEGIN
  IF NOT public.is_gambasket_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
  IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid verification status'; END IF;
  SELECT * INTO r FROM public.verification_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verification request not found'; END IF;
  IF r.role_type NOT IN ('seller','supplier') THEN RAISE EXCEPTION 'Only seller and supplier verification requests can assign roles'; END IF;

  UPDATE public.verification_requests
  SET status=p_status,reviewed_at=now(),reviewed_by=auth.uid(),review_notes=p_notes
  WHERE id=p_request_id RETURNING * INTO r;

  SELECT phone,COALESCE(NULLIF(area,''),NULLIF(region,''),'The Gambia')
  INTO profile_phone,profile_location
  FROM public.profiles WHERE id=r.user_id;

  IF p_status='approved' THEN
    INSERT INTO public.user_roles(user_id,role_id,assigned_by,is_active)
    VALUES(r.user_id,r.role_type,auth.uid(),true)
    ON CONFLICT(user_id,role_id) DO UPDATE SET is_active=true,assigned_by=auth.uid();

    IF r.role_type='seller' THEN
      UPDATE public.seller_profiles
      SET business_name=COALESCE(NULLIF(r.business_name,''),business_name),
          business_category=COALESCE(NULLIF(r.business_category,''),business_category),
          phone=COALESCE(profile_phone,phone),
          location=COALESCE(profile_location,location),
          verification_status='verified',is_active=true,updated_at=now()
      WHERE user_id=r.user_id;
      IF NOT FOUND THEN
        INSERT INTO public.seller_profiles(user_id,business_name,business_category,phone,location,verification_status,is_active)
        VALUES(r.user_id,COALESCE(NULLIF(r.business_name,''),'Independent Seller'),r.business_category,profile_phone,profile_location,'verified',true);
      END IF;
    ELSE
      UPDATE public.supplier_profiles
      SET business_name=COALESCE(NULLIF(r.business_name,''),business_name),
          business_category=COALESCE(NULLIF(r.business_category,''),business_category),
          phone=COALESCE(profile_phone,phone),
          location=COALESCE(profile_location,location),
          is_verified=true,is_active=true,updated_at=now()
      WHERE user_id=r.user_id;
      IF NOT FOUND THEN
        INSERT INTO public.supplier_profiles(user_id,business_name,business_category,phone,location,is_verified,is_active)
        VALUES(r.user_id,COALESCE(NULLIF(r.business_name,''),'Verified Supplier'),r.business_category,profile_phone,profile_location,true,true);
      END IF;
    END IF;
  ELSE
    IF r.role_type='seller' THEN
      UPDATE public.seller_profiles SET verification_status='rejected',updated_at=now() WHERE user_id=r.user_id;
    ELSE
      UPDATE public.supplier_profiles SET is_verified=false,updated_at=now() WHERE user_id=r.user_id;
    END IF;
  END IF;

  INSERT INTO public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),'verification_'||p_status,'verification_request',r.id,jsonb_build_object('role',r.role_type,'user_id',r.user_id));
  RETURN r;
END;
$fn$;

-- Application review grants real roles only after approval; non-admin moderators
-- cannot approve another marketplace moderator, preventing peer privilege escalation.
CREATE OR REPLACE FUNCTION public.review_worker_application(
  p_application_id uuid,
  p_status character varying,
  p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
  a public.worker_applications%ROWTYPE;
  reward numeric;
  reward_currency character varying;
  reward_description text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_gambasket_admin()
    OR public.has_role(auth.uid(),'marketplace_worker'::character varying)
  ) THEN RAISE EXCEPTION 'Marketplace moderation access required'; END IF;
  IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid application decision'; END IF;

  SELECT * INTO a FROM public.worker_applications WHERE id=p_application_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found or already reviewed'; END IF;
  IF a.worker_type NOT IN ('delivery_worker','marketplace_worker') THEN
    RAISE EXCEPTION 'Seller verification requests must be reviewed through the verification queue';
  END IF;
  IF p_status='approved' AND a.worker_type='marketplace_worker' AND NOT public.is_gambasket_admin() THEN
    RAISE EXCEPTION 'Only a GamBasket administrator can approve marketplace moderators';
  END IF;

  UPDATE public.worker_applications SET status=p_status,reviewed_by=auth.uid(),review_notes=p_notes,updated_at=now()
  WHERE id=p_application_id RETURNING * INTO a;

  IF p_status='approved' THEN
    INSERT INTO public.user_roles(user_id,role_id,assigned_by,is_active)
    VALUES(a.user_id,a.worker_type,auth.uid(),true)
    ON CONFLICT(user_id,role_id) DO UPDATE SET is_active=true,assigned_by=auth.uid();

    IF a.worker_type='delivery_worker' THEN
      PERFORM set_config('app.gambasket_internal','on',true);
      UPDATE public.delivery_profiles
      SET phone=a.phone,vehicle_type=COALESCE(NULLIF(a.vehicle_type,''),'motorcycle'),
          delivery_areas=COALESCE(a.delivery_areas,ARRAY[a.location]::text[]),
          current_location=a.location,status='offline',is_verified=true,updated_at=now()
      WHERE user_id=a.user_id;
      IF NOT FOUND THEN
        INSERT INTO public.delivery_profiles(user_id,phone,vehicle_type,delivery_areas,current_location,status,is_verified)
        VALUES(a.user_id,a.phone,COALESCE(NULLIF(a.vehicle_type,''),'motorcycle'),
          COALESCE(a.delivery_areas,ARRAY[a.location]::text[]),a.location,'offline',true);
      END IF;
    END IF;
  END IF;

  INSERT INTO public.activity_logs(actor_id,action,target_type,target_id,metadata)
  VALUES(auth.uid(),'worker_application_'||p_status,'worker_application',p_application_id::text,
    jsonb_build_object('applicant_id',a.user_id,'worker_type',a.worker_type,'notes',p_notes));

  IF public.has_role(auth.uid(),'marketplace_worker'::character varying) THEN
    SELECT reward_amount,currency,earning_rules.description
    INTO reward,reward_currency,reward_description
    FROM public.earning_rules
    WHERE role_name='marketplace_worker' AND action_type='review_worker_application' AND is_active=true;
    IF FOUND AND COALESCE(reward,0)>0 AND NOT EXISTS(
      SELECT 1 FROM public.earning_transactions
      WHERE user_id=auth.uid() AND role_name='marketplace_worker'
        AND action_type='review_worker_application' AND reference_id=p_application_id::text
    ) THEN
      INSERT INTO public.earning_transactions(user_id,role_name,action_type,reference_id,amount,currency,status,description)
      VALUES(auth.uid(),'marketplace_worker','review_worker_application',p_application_id::text,reward,
        COALESCE(reward_currency,'GMD'),'available',COALESCE(reward_description,'Worker application review'));
    END IF;
  END IF;

  RETURN jsonb_build_object('success',true,'application_id',p_application_id,'status',p_status,'worker_type',a.worker_type);
END;
$fn$;

REVOKE ALL ON FUNCTION public.submit_verification_request(character varying,character varying,character varying,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_verification_request(character varying,character varying,character varying,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.review_worker_application(uuid,character varying,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_worker_application(uuid,character varying,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_order(jsonb,character varying,text,character varying,character varying,character varying,text,character varying,character varying) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,character varying,text,character varying,character varying,character varying,text,character varying,character varying) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_order(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(text) TO authenticated;
REVOKE ALL ON FUNCTION public.seller_update_order_status(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.seller_update_order_status(uuid,text,text) TO authenticated;

COMMIT;
