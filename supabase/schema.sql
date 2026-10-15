-- ============================================================================
-- GAMBASKET — POSTGRESQL PRODUCTION DATABASE SCHEMA
-- Marketplace Platform for The Gambia
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ROLES & PERMISSIONS ARCHITECTURE (Multi-Capability Support)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.roles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed predefined roles
INSERT INTO public.roles (id, name, description) VALUES
    ('buyer', 'Buyer', 'Standard marketplace buyer capable of browsing, ordering, wishlists, and messaging sellers.'),
    ('seller', 'Approved Seller', 'Authorized merchant capable of managing stores, publishing products, and fulfilling orders.'),
    ('delivery_worker', 'Delivery Worker', 'Courier capable of viewing delivery requests, accepting assignments, and updating delivery status.'),
    ('marketplace_worker', 'Marketplace Operations Worker', 'Moderator capable of reviewing products, seller submissions, and reports.'),
    ('admin', 'Administrator', 'Full system control across all marketplace entities, roles, and settings.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.permissions (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT
);

-- Seed granular permissions
INSERT INTO public.permissions (id, name, category, description) VALUES
    ('wishlist.manage', 'Manage Wishlist', 'buyer', 'Can add and remove items from wishlist'),
    ('orders.create', 'Create Orders', 'buyer', 'Can checkout and place orders'),
    ('orders.view_own', 'View Own Orders', 'buyer', 'Can view own orders and status history'),
    ('messages.create', 'Send Messages', 'buyer', 'Can message sellers in-app'),
    ('messages.view_own', 'View Own Messages', 'buyer', 'Can view conversations participated in'),
    
    ('products.create', 'Create Products', 'seller', 'Can draft and submit products for review'),
    ('products.edit_own', 'Edit Own Products', 'seller', 'Can edit owned product listings and inventory'),
    ('products.delete_own', 'Delete Own Products', 'seller', 'Can delete/archive owned product listings'),
    ('orders.view_store', 'View Store Orders', 'seller', 'Can view incoming orders for own store'),
    ('orders.process_store', 'Process Store Orders', 'seller', 'Can mark orders as processing/ready'),
    ('store.manage', 'Manage Store Profile', 'seller', 'Can update store details and settings'),

    ('deliveries.view_available', 'View Available Jobs', 'delivery', 'Can see nearby unassigned delivery requests'),
    ('deliveries.accept', 'Accept Delivery Jobs', 'delivery', 'Can accept available delivery requests atomically'),
    ('deliveries.update_status', 'Update Delivery Status', 'delivery', 'Can mark orders picked up, out for delivery, delivered'),
    ('deliveries.view_assigned', 'View Assigned Deliveries', 'delivery', 'Can view details of assigned delivery jobs'),

    ('products.review', 'Review Products', 'moderation', 'Can inspect newly submitted products'),
    ('products.approve', 'Approve Products', 'moderation', 'Can approve products to make them public'),
    ('products.reject', 'Reject Products', 'moderation', 'Can reject product submissions with reason'),
    ('reports.review', 'Review Reports', 'moderation', 'Can investigate customer and seller reports'),
    ('sellers.review', 'Review Seller Applications', 'moderation', 'Can inspect seller applications'),

    ('users.manage', 'Manage Users', 'admin', 'Can view and modify user records and capabilities'),
    ('roles.manage', 'Manage Roles & Capabilities', 'admin', 'Can grant and revoke roles'),
    ('promotions.manage', 'Manage Promotions & Popups', 'admin', 'Can create and schedule popups/promotions'),
    ('notifications.manage', 'Send System Notifications', 'admin', 'Can broadcast system notifications'),
    ('system.manage', 'Full System Administration', 'admin', 'Unrestricted administrative access')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id VARCHAR(50) REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(100) REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Seed role to permissions mapping
INSERT INTO public.role_permissions (role_id, permission_id) VALUES
    ('buyer', 'wishlist.manage'),
    ('buyer', 'orders.create'),
    ('buyer', 'orders.view_own'),
    ('buyer', 'messages.create'),
    ('buyer', 'messages.view_own'),
    
    ('seller', 'products.create'),
    ('seller', 'products.edit_own'),
    ('seller', 'products.delete_own'),
    ('seller', 'orders.view_store'),
    ('seller', 'orders.process_store'),
    ('seller', 'store.manage'),

    ('delivery_worker', 'deliveries.view_available'),
    ('delivery_worker', 'deliveries.accept'),
    ('delivery_worker', 'deliveries.update_status'),
    ('delivery_worker', 'deliveries.view_assigned'),

    ('marketplace_worker', 'products.review'),
    ('marketplace_worker', 'products.approve'),
    ('marketplace_worker', 'products.reject'),
    ('marketplace_worker', 'reports.review'),
    ('marketplace_worker', 'sellers.review'),

    ('admin', 'users.manage'),
    ('admin', 'roles.manage'),
    ('admin', 'promotions.manage'),
    ('admin', 'notifications.manage'),
    ('admin', 'system.manage')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. USER PROFILES & USER ROLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50),
    country VARCHAR(100) DEFAULT 'The Gambia' NOT NULL CHECK (country = 'The Gambia'),
    region VARCHAR(100),
    area VARCHAR(100),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role_id VARCHAR(50) REFERENCES public.roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES public.profiles(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

-- ============================================================================
-- 3. SELLER & WORKER PROFILES AND APPLICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.seller_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    business_name VARCHAR(150) NOT NULL,
    business_category VARCHAR(100) NOT NULL,
    business_description TEXT NOT NULL,
    what_they_sell TEXT NOT NULL,
    store_location VARCHAR(150) NOT NULL,
    store_image_url TEXT,
    documents_url TEXT,
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    reviewed_by UUID REFERENCES public.profiles(id),
    review_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    logo_url TEXT,
    banner_url TEXT,
    location VARCHAR(150),
    phone VARCHAR(50),
    rating NUMERIC(3,2) DEFAULT 5.0,
    total_sales NUMERIC(12,2) DEFAULT 0.0,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.worker_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    worker_type VARCHAR(50) NOT NULL CHECK (worker_type IN ('seller', 'delivery_worker', 'marketplace_worker')),
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    location VARCHAR(150) NOT NULL,
    delivery_areas TEXT[],
    vehicle_type VARCHAR(50),
    profile_image_url TEXT,
    experience_notes TEXT,
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    reviewed_by UUID REFERENCES public.profiles(id),
    review_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    phone VARCHAR(50) NOT NULL,
    vehicle_type VARCHAR(50) NOT NULL CHECK (vehicle_type IN ('Motorcycle', 'Car', 'Van', 'Bicycle', 'Other')),
    delivery_areas TEXT[] DEFAULT '{}',
    current_location VARCHAR(150),
    status VARCHAR(30) DEFAULT 'offline' CHECK (status IN ('offline', 'available', 'delivering', 'suspended')),
    is_verified BOOLEAN DEFAULT FALSE,
    rating NUMERIC(3,2) DEFAULT 5.0,
    total_completed_deliveries INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 4. CATEGORIES & PRODUCTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    icon_name VARCHAR(50) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed standard categories
INSERT INTO public.categories (id, name, icon_name, sort_order) VALUES
    ('All', 'All', 'grid', 0),
    ('Phones', 'Phones', 'phone', 1),
    ('Fashion', 'Fashion', 'shirt', 2),
    ('Electronics', 'Electronics', 'laptop', 3),
    ('Home', 'Home', 'house', 4),
    ('Beauty', 'Beauty', 'sparkle', 5)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.subcategories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id VARCHAR(50) REFERENCES public.categories(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(5) DEFAULT 'GMD' NOT NULL,
    category_id VARCHAR(50) REFERENCES public.categories(id) ON DELETE SET NULL,
    subcategory_id UUID REFERENCES public.subcategories(id) ON DELETE SET NULL,
    condition VARCHAR(50) DEFAULT 'New' CHECK (condition IN ('New', 'Like New', 'Refurbished', 'Used - Good', 'Used - Fair')),
    stock INTEGER DEFAULT 1 NOT NULL CHECK (stock >= 0),
    location VARCHAR(150) NOT NULL,
    main_image TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'pending_review' CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended')),
    rejection_reason TEXT,
    views_count INTEGER DEFAULT 0,
    sales_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 5. WISHLISTS & CARTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wishlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1 NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

-- ============================================================================
-- 6. ORDERS, CHECKOUT & DELIVERY AUTOMATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    buyer_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    seller_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    fulfillment_type VARCHAR(20) NOT NULL CHECK (fulfillment_type IN ('delivery', 'pickup')),
    delivery_address TEXT,
    delivery_region VARCHAR(100),
    delivery_area VARCHAR(100),
    delivery_phone VARCHAR(50),
    delivery_instructions TEXT,
    pickup_location TEXT,
    subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    delivery_fee NUMERIC(12,2) DEFAULT 0.00 NOT NULL CHECK (delivery_fee >= 0),
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    currency VARCHAR(5) DEFAULT 'GMD' NOT NULL,
    payment_status VARCHAR(30) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    payment_method VARCHAR(50) DEFAULT 'cash_on_delivery',
    order_status VARCHAR(40) DEFAULT 'pending' CHECK (order_status IN (
        'pending',
        'confirmed',
        'processing',
        'ready_for_delivery',
        'delivery_assigned',
        'picked_up',
        'out_for_delivery',
        'delivered',
        'ready_for_pickup',
        'completed',
        'cancelled'
    )),
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    subtotal NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    from_status VARCHAR(40),
    to_status VARCHAR(40) NOT NULL,
    changed_by UUID REFERENCES public.profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    pickup_location TEXT NOT NULL,
    delivery_destination TEXT NOT NULL,
    delivery_area VARCHAR(100),
    estimated_fee NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled')),
    assigned_worker_id UUID REFERENCES public.profiles(id),
    assigned_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_request_id UUID REFERENCES public.delivery_requests(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL,
    updated_by UUID REFERENCES public.profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 7. IN-APP MESSAGING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    message_text TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 8. NOTIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'system' CHECK (type IN ('welcome', 'order', 'delivery', 'wishlist', 'explore', 'message', 'seller', 'worker', 'system')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 9. WORK-BASED EARNINGS & PAYOUT ARCHITECTURE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.earning_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(50) NOT NULL,
    action_type VARCHAR(100) NOT NULL,
    reward_amount NUMERIC(10,2) NOT NULL CHECK (reward_amount >= 0),
    currency VARCHAR(5) DEFAULT 'GMD' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(role_name, action_type)
);

CREATE TABLE IF NOT EXISTS public.earning_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    role_name VARCHAR(50) NOT NULL,
    action_type VARCHAR(100) NOT NULL,
    reference_id TEXT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    currency VARCHAR(5) DEFAULT 'GMD' NOT NULL,
    status VARCHAR(30) DEFAULT 'available' CHECK (status IN ('pending', 'available', 'paid_out', 'cancelled')),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    role_name VARCHAR(50) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('wave', 'qmoney', 'afrimoney', 'bank_transfer', 'cash')),
    phone_or_account VARCHAR(100) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processing', 'completed', 'rejected')),
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 10. REVIEWS & REPORTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    reviewer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_type VARCHAR(30) NOT NULL CHECK (target_type IN ('product', 'seller', 'user', 'message')),
    target_id UUID NOT NULL,
    reason VARCHAR(150) NOT NULL,
    description TEXT,
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'investigating', 'resolved', 'dismissed')),
    reviewed_by UUID REFERENCES public.profiles(id),
    resolution TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 10. PROMOTIONS & POPUPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    image_url TEXT,
    cta_text VARCHAR(100),
    cta_action VARCHAR(100),
    cta_payload TEXT,
    target_audience VARCHAR(50) DEFAULT 'all' CHECK (target_audience IN ('all', 'buyers', 'sellers', 'delivery_workers', 'marketplace_workers')),
    frequency VARCHAR(50) DEFAULT 'once_per_day' CHECK (frequency IN ('once_per_session', 'once_per_day', 'once_per_campaign', 'every_visit')),
    is_active BOOLEAN DEFAULT TRUE,
    mobile_enabled BOOLEAN DEFAULT TRUE,
    desktop_enabled BOOLEAN DEFAULT TRUE,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    impressions_count INTEGER DEFAULT 0,
    clicks_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.promotion_impressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID REFERENCES public.promotions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 11. INDEXES FOR PERFORMANCE & FAST QUERIES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_products_seller ON public.products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_price ON public.products(price);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON public.orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON public.orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(order_status);
CREATE INDEX IF NOT EXISTS idx_delivery_requests_status ON public.delivery_requests(status);
CREATE INDEX IF NOT EXISTS idx_delivery_requests_worker ON public.delivery_requests(assigned_worker_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);

-- ============================================================================
-- 12. ATOMIC STORED PROCEDURES & SECURE DATABASE FUNCTIONS
-- ============================================================================

-- Function to handle new user registration automatically
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_first_name text;
    v_last_name text;
    v_phone text;
    v_region text;
    v_area text;
BEGIN
    -- Extract first name from standard signup or OAuth metadata (Google given_name / full_name)
    v_first_name := coalesce(
        new.raw_user_meta_data->>'first_name',
        new.raw_user_meta_data->>'given_name',
        nullif(split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 1), ''),
        'User'
    );
    -- Extract last name from standard signup or OAuth metadata (Google family_name / full_name)
    v_last_name := coalesce(
        new.raw_user_meta_data->>'last_name',
        new.raw_user_meta_data->>'family_name',
        nullif(trim(substr(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), length(v_first_name) + 1)), ''),
        ''
    );
    v_phone := new.raw_user_meta_data->>'phone';
    v_region := coalesce(new.raw_user_meta_data->>'region', 'Greater Banjul');
    v_area := coalesce(new.raw_user_meta_data->>'area', '');

    INSERT INTO public.profiles (
        id,
        first_name,
        last_name,
        email,
        phone,
        country,
        region,
        area
    ) VALUES (
        new.id,
        v_first_name,
        v_last_name,
        new.email,
        v_phone,
        'The Gambia',
        v_region,
        v_area
    )
    ON CONFLICT (id) DO UPDATE SET
        first_name = CASE WHEN public.profiles.first_name IS NULL OR public.profiles.first_name = 'User' THEN EXCLUDED.first_name ELSE public.profiles.first_name END,
        last_name = CASE WHEN public.profiles.last_name IS NULL OR public.profiles.last_name = '' THEN EXCLUDED.last_name ELSE public.profiles.last_name END,
        email = EXCLUDED.email,
        phone = coalesce(public.profiles.phone, EXCLUDED.phone),
        updated_at = NOW();

    -- Grant default buyer role
    INSERT INTO public.user_roles (user_id, role_id)
    VALUES (new.id, 'buyer')
    ON CONFLICT (user_id, role_id) DO NOTHING;

    -- Add a welcome notification
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
        new.id,
        'welcome',
        'Welcome to GamBasket',
        'Discover products and verified suppliers from across The Gambia.'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to hook auth.users signup to public.profiles
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper function: Check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(p_user_id UUID, p_role VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = p_user_id AND role_id = p_role AND is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function: Check if user has a specific permission
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id UUID, p_permission VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.user_roles ur
        JOIN public.role_permissions rp ON ur.role_id = rp.role_id
        WHERE ur.user_id = p_user_id 
          AND ur.is_active = TRUE 
          AND (rp.permission_id = p_permission OR ur.role_id = 'admin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- CRITICAL ATOMIC FUNCTION: Atomic Delivery Job Claiming
-- Prevents race conditions when multiple drivers click "Accept" simultaneously
CREATE OR REPLACE FUNCTION public.claim_delivery_job(
    p_request_id UUID,
    p_worker_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_request RECORD;
    v_worker_status VARCHAR;
BEGIN
    -- Verify worker is authorized and available
    SELECT status INTO v_worker_status
    FROM public.delivery_profiles
    WHERE user_id = p_worker_id AND is_verified = TRUE;

    IF v_worker_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Worker profile not found or not verified');
    END IF;

    -- Lock the specific delivery request row with FOR UPDATE
    SELECT * INTO v_request
    FROM public.delivery_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery request not found');
    END IF;

    IF v_request.status != 'pending' OR v_request.assigned_worker_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery already assigned to another driver');
    END IF;

    -- Atomically assign the job
    UPDATE public.delivery_requests
    SET 
        status = 'assigned',
        assigned_worker_id = p_worker_id,
        assigned_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id;

    -- Update the order status
    UPDATE public.orders
    SET 
        order_status = 'delivery_assigned',
        updated_at = NOW()
    WHERE id = v_request.order_id;

    -- Update worker status to delivering
    UPDATE public.delivery_profiles
    SET 
        status = 'delivering',
        updated_at = NOW()
    WHERE user_id = p_worker_id;

    -- Record status history
    INSERT INTO public.delivery_status_history (delivery_request_id, status, updated_by, notes)
    VALUES (p_request_id, 'assigned', p_worker_id, 'Claimed by delivery worker');

    -- Notify the buyer
    INSERT INTO public.notifications (user_id, type, title, message)
    SELECT 
        buyer_id,
        'delivery',
        'Delivery Driver Assigned',
        'A delivery driver has accepted your order and is on the way to pick it up.'
    FROM public.orders
    WHERE id = v_request.order_id;

    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Delivery job assigned successfully',
        'order_id', v_request.order_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 13. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_impressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 1. Profiles
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 2. User Roles & Permissions
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Only admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Roles are viewable by authenticated users" ON public.roles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Permissions are viewable by authenticated users" ON public.permissions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Role permissions are viewable by authenticated users" ON public.role_permissions FOR SELECT USING (auth.role() = 'authenticated');

-- 3. Categories & Subcategories
CREATE POLICY "Categories are viewable by everyone" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Subcategories are viewable by everyone" ON public.subcategories FOR SELECT USING (true);
CREATE POLICY "Admins can manage categories" ON public.categories FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- 4. Products & Images
CREATE POLICY "Approved products are viewable by everyone" ON public.products FOR SELECT 
    USING (status = 'approved' OR auth.uid() = seller_id OR public.has_permission(auth.uid(), 'products.review') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Sellers can create products" ON public.products FOR INSERT 
    WITH CHECK (auth.uid() = seller_id AND public.has_role(auth.uid(), 'seller'));
CREATE POLICY "Sellers can update own products" ON public.products FOR UPDATE 
    USING (auth.uid() = seller_id OR public.has_permission(auth.uid(), 'products.review') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Sellers can delete own products" ON public.products FOR DELETE 
    USING (auth.uid() = seller_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Product images are viewable by everyone" ON public.product_images FOR SELECT USING (true);
CREATE POLICY "Sellers can manage product images" ON public.product_images FOR ALL 
    USING (EXISTS (SELECT 1 FROM public.products WHERE id = product_images.product_id AND seller_id = auth.uid()));

-- 5. Stores & Seller Applications
CREATE POLICY "Stores are viewable by everyone" ON public.stores FOR SELECT USING (is_active = true OR auth.uid() = seller_id);
CREATE POLICY "Sellers can update own store" ON public.stores FOR UPDATE USING (auth.uid() = seller_id);

CREATE POLICY "Users can view own seller applications" ON public.seller_applications FOR SELECT 
    USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'sellers.review') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can create seller application" ON public.seller_applications FOR INSERT 
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Moderators can update seller applications" ON public.seller_applications FOR UPDATE 
    USING (public.has_permission(auth.uid(), 'sellers.review') OR public.has_role(auth.uid(), 'admin'));

-- 6. Worker Applications & Delivery Profiles
CREATE POLICY "Users can view own worker applications" ON public.worker_applications FOR SELECT 
    USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can create worker application" ON public.worker_applications FOR INSERT 
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can update worker applications" ON public.worker_applications FOR UPDATE 
    USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Delivery profiles viewable by authorized users" ON public.delivery_profiles FOR SELECT 
    USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Delivery workers can update own profile" ON public.delivery_profiles FOR UPDATE 
    USING (auth.uid() = user_id);

-- 7. Wishlist & Cart
CREATE POLICY "Users can manage own wishlist" ON public.wishlist_items FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own cart" ON public.cart_items FOR ALL USING (auth.uid() = user_id);

-- 8. Orders & Order Items
CREATE POLICY "Users can view own orders (buyer or seller)" ON public.orders FOR SELECT 
    USING (auth.uid() = buyer_id OR auth.uid() = seller_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Buyers can create orders" ON public.orders FOR INSERT WITH CHECK (auth.uid() = buyer_id);
CREATE POLICY "Participants and admins can update orders" ON public.orders FOR UPDATE 
    USING (auth.uid() = buyer_id OR auth.uid() = seller_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Order items viewable by order participants" ON public.order_items FOR SELECT 
    USING (EXISTS (SELECT 1 FROM public.orders WHERE id = order_items.order_id AND (buyer_id = auth.uid() OR seller_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))));
CREATE POLICY "Buyers can insert order items" ON public.order_items FOR INSERT 
    WITH CHECK (EXISTS (SELECT 1 FROM public.orders WHERE id = order_items.order_id AND buyer_id = auth.uid()));

CREATE POLICY "Order status history viewable by order participants" ON public.order_status_history FOR SELECT 
    USING (EXISTS (SELECT 1 FROM public.orders WHERE id = order_status_history.order_id AND (buyer_id = auth.uid() OR seller_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))));
CREATE POLICY "Authorized users can insert order status history" ON public.order_status_history FOR INSERT 
    WITH CHECK (auth.role() = 'authenticated');

-- 9. Delivery Requests & Assignments
CREATE POLICY "Eligible delivery workers can view pending requests" ON public.delivery_requests FOR SELECT 
    USING (
        status = 'pending' AND public.has_role(auth.uid(), 'delivery_worker')
        OR assigned_worker_id = auth.uid() 
        OR EXISTS (SELECT 1 FROM public.orders WHERE id = delivery_requests.order_id AND (buyer_id = auth.uid() OR seller_id = auth.uid()))
        OR public.has_role(auth.uid(), 'admin')
    );
CREATE POLICY "Delivery status history viewable by participants" ON public.delivery_status_history FOR SELECT 
    USING (auth.role() = 'authenticated');

-- 10. Conversations & Messages
CREATE POLICY "Participants can view conversation" ON public.conversations FOR SELECT 
    USING (EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = conversations.id AND user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated users can create conversations" ON public.conversations FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Participants can view conversation members" ON public.conversation_participants FOR SELECT 
    USING (EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id = conversation_participants.conversation_id AND cp.user_id = auth.uid()));
CREATE POLICY "Users can join conversations" ON public.conversation_participants FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Participants can view messages" ON public.messages FOR SELECT 
    USING (EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Participants can send messages" ON public.messages FOR INSERT 
    WITH CHECK (auth.uid() = sender_id AND EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()));

-- 11. Notifications
CREATE POLICY "Users can manage own notifications" ON public.notifications FOR ALL USING (auth.uid() = user_id);

-- 12. Reviews & Reports
CREATE POLICY "Reviews are viewable by everyone" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Buyers can submit reviews" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- 13. Reports
CREATE POLICY "Users can view own reports" ON public.reports FOR SELECT 
    USING (auth.uid() = reporter_id OR public.has_permission(auth.uid(), 'reports.review') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can submit reports" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Moderators can update reports" ON public.reports FOR UPDATE 
    USING (public.has_permission(auth.uid(), 'reports.review') OR public.has_role(auth.uid(), 'admin'));

-- 14. Promotions & Activity Logs
CREATE POLICY "Active promotions viewable by everyone" ON public.promotions FOR SELECT USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage promotions" ON public.promotions FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Promotion impressions insertable" ON public.promotion_impressions FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can view activity logs" ON public.activity_logs FOR ALL USING (public.has_role(auth.uid(), 'admin'));
