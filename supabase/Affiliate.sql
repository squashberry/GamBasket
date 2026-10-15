-- ============================================================
-- GAMBASKET
-- AFFILIATE + SUPPLIER FOUNDATION
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. ADD SUPPLIER ROLE
-- ============================================================

insert into public.roles (id, name, description)
values (
    'supplier',
    'Supplier / Wholesaler',
    'Wholesale business capable of supplying products to GamBasket sellers.'
)
on conflict (id) do nothing;


-- ============================================================
-- 2. AFFILIATE PROFILES
-- ============================================================

create table if not exists public.affiliate_profiles (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null unique
        references public.profiles(id) on delete cascade,

    affiliate_code varchar(40) not null unique,

    display_name varchar(120),

    is_active boolean not null default true,

    total_clicks bigint not null default 0,
    total_orders bigint not null default 0,
    total_sales numeric(14,2) not null default 0,
    total_commission numeric(14,2) not null default 0,
    pending_commission numeric(14,2) not null default 0,
    paid_commission numeric(14,2) not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 3. AFFILIATE LINKS
-- ============================================================

create table if not exists public.affiliate_links (
    id uuid primary key default gen_random_uuid(),

    affiliate_id uuid not null
        references public.affiliate_profiles(id) on delete cascade,

    product_id uuid not null
        references public.products(id) on delete cascade,

    referral_code varchar(80) not null unique,

    clicks bigint not null default 0,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique(affiliate_id, product_id)
);


-- ============================================================
-- 4. AFFILIATE CLICKS
-- ============================================================

create table if not exists public.affiliate_clicks (
    id uuid primary key default gen_random_uuid(),

    affiliate_id uuid not null
        references public.affiliate_profiles(id) on delete cascade,

    affiliate_link_id uuid
        references public.affiliate_links(id) on delete set null,

    product_id uuid
        references public.products(id) on delete set null,

    visitor_token text,

    created_at timestamptz not null default now()
);


-- ============================================================
-- 5. AFFILIATE ATTRIBUTION
-- ============================================================

create table if not exists public.affiliate_attributions (
    id uuid primary key default gen_random_uuid(),

    affiliate_id uuid not null
        references public.affiliate_profiles(id) on delete cascade,

    affiliate_link_id uuid
        references public.affiliate_links(id) on delete set null,

    product_id uuid
        references public.products(id) on delete set null,

    visitor_token text,

    attributed_at timestamptz not null default now(),

    expires_at timestamptz
);


-- ============================================================
-- 6. ADD AFFILIATE DATA TO ORDERS
-- ============================================================

alter table public.orders
    add column if not exists affiliate_id uuid
        references public.affiliate_profiles(id) on delete set null;

alter table public.orders
    add column if not exists affiliate_link_id uuid
        references public.affiliate_links(id) on delete set null;

alter table public.orders
    add column if not exists affiliate_commission numeric(14,2)
        default 0;

alter table public.orders
    add column if not exists affiliate_commission_rate numeric(6,3)
        default 0;

alter table public.orders
    add column if not exists affiliate_commission_status varchar(30)
        default 'none';

alter table public.orders
    add column if not exists affiliate_approved_at timestamptz;

alter table public.orders
    add column if not exists affiliate_paid_at timestamptz;


-- ============================================================
-- 7. SELLER AFFILIATE SETTINGS
-- ============================================================

create table if not exists public.seller_affiliate_settings (
    id uuid primary key default gen_random_uuid(),

    seller_id uuid not null
        references public.profiles(id) on delete cascade,

    enabled boolean not null default false,

    default_commission_rate numeric(6,3) not null default 5,

    attribution_days integer not null default 30,

    allow_any_affiliate boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique(seller_id)
);


-- ============================================================
-- 8. PRODUCT AFFILIATE SETTINGS
-- ============================================================

create table if not exists public.product_affiliate_settings (
    id uuid primary key default gen_random_uuid(),

    product_id uuid not null unique
        references public.products(id) on delete cascade,

    enabled boolean not null default false,

    commission_rate numeric(6,3),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 9. AFFILIATE COMMISSIONS
-- ============================================================

create table if not exists public.affiliate_commissions (
    id uuid primary key default gen_random_uuid(),

    affiliate_id uuid not null
        references public.affiliate_profiles(id) on delete cascade,

    order_id uuid not null
        references public.orders(id) on delete cascade,

    seller_id uuid
        references public.profiles(id) on delete set null,

    product_id uuid
        references public.products(id) on delete set null,

    order_amount numeric(14,2) not null default 0,

    commission_rate numeric(6,3) not null default 0,

    commission_amount numeric(14,2) not null default 0,

    status varchar(30) not null default 'pending',

    seller_payment_method varchar(40),

    seller_payment_reference text,

    approved_at timestamptz,

    paid_at timestamptz,

    created_at timestamptz not null default now()
);


-- ============================================================
-- 10. AFFILIATE PAYOUT REQUESTS
-- ============================================================

create table if not exists public.affiliate_payout_requests (
    id uuid primary key default gen_random_uuid(),

    affiliate_id uuid not null
        references public.affiliate_profiles(id) on delete cascade,

    amount numeric(14,2) not null,

    payment_method varchar(40) not null,

    payment_account varchar(120) not null,

    status varchar(30) not null default 'requested',

    admin_notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 11. SUPPLIER BUSINESS PROFILES
-- ============================================================

create table if not exists public.supplier_profiles (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null unique
        references public.profiles(id) on delete cascade,

    business_name varchar(150) not null,

    description text,

    business_category varchar(120),

    phone varchar(40),

    whatsapp varchar(40),

    location varchar(180),

    logo_url text,

    banner_url text,

    is_verified boolean not null default false,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 12. SUPPLIER PRODUCT DATA
-- ============================================================

alter table public.products
    add column if not exists supplier_id uuid
        references public.supplier_profiles(id) on delete set null;

alter table public.products
    add column if not exists wholesale_price numeric(14,2);

alter table public.products
    add column if not exists minimum_order_quantity integer default 1;

alter table public.products
    add column if not exists retail_suggested_price numeric(14,2);

alter table public.products
    add column if not exists fulfillment_type varchar(30) default 'seller_stock';


-- ============================================================
-- 13. SUPPLIER ORDERS
-- ============================================================

create table if not exists public.supplier_orders (
    id uuid primary key default gen_random_uuid(),

    order_id uuid not null
        references public.orders(id) on delete cascade,

    supplier_id uuid not null
        references public.supplier_profiles(id) on delete restrict,

    seller_id uuid not null
        references public.profiles(id) on delete restrict,

    status varchar(40) not null default 'pending',

    supplier_total numeric(14,2) not null default 0,

    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 14. INDEXES
-- ============================================================

create index if not exists idx_affiliate_profiles_user
    on public.affiliate_profiles(user_id);

create index if not exists idx_affiliate_links_affiliate
    on public.affiliate_links(affiliate_id);

create index if not exists idx_affiliate_links_product
    on public.affiliate_links(product_id);

create index if not exists idx_affiliate_clicks_affiliate
    on public.affiliate_clicks(affiliate_id);

create index if not exists idx_affiliate_clicks_product
    on public.affiliate_clicks(product_id);

create index if not exists idx_orders_affiliate
    on public.orders(affiliate_id);

create index if not exists idx_affiliate_commissions_affiliate
    on public.affiliate_commissions(affiliate_id);

create index if not exists idx_affiliate_commissions_order
    on public.affiliate_commissions(order_id);

create index if not exists idx_supplier_products
    on public.products(supplier_id);

create index if not exists idx_supplier_orders_supplier
    on public.supplier_orders(supplier_id);


-- ============================================================
-- 15. UPDATED_AT FUNCTION
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


drop trigger if exists trg_affiliate_profiles_updated
on public.affiliate_profiles;

create trigger trg_affiliate_profiles_updated
before update on public.affiliate_profiles
for each row execute function public.set_updated_at();


drop trigger if exists trg_affiliate_links_updated
on public.affiliate_links;

create trigger trg_affiliate_links_updated
before update on public.affiliate_links
for each row execute function public.set_updated_at();


drop trigger if exists trg_supplier_profiles_updated
on public.supplier_profiles;

create trigger trg_supplier_profiles_updated
before update on public.supplier_profiles
for each row execute function public.set_updated_at();


drop trigger if exists trg_supplier_orders_updated
on public.supplier_orders;

create trigger trg_supplier_orders_updated
before update on public.supplier_orders
for each row execute function public.set_updated_at();


-- ============================================================
-- 16. ENABLE RLS
-- ============================================================

alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_links enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.seller_affiliate_settings enable row level security;
alter table public.product_affiliate_settings enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_payout_requests enable row level security;
alter table public.supplier_profiles enable row level security;
alter table public.supplier_orders enable row level security;


-- ============================================================
-- 17. AFFILIATE PROFILE POLICIES
-- ============================================================

drop policy if exists "affiliate profile owner read"
on public.affiliate_profiles;

create policy "affiliate profile owner read"
on public.affiliate_profiles
for select
to authenticated
using (user_id = auth.uid());


drop policy if exists "affiliate profile owner update"
on public.affiliate_profiles;

create policy "affiliate profile owner update"
on public.affiliate_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());


-- ============================================================
-- 18. AFFILIATE LINKS
-- ============================================================

drop policy if exists "affiliate links owner read"
on public.affiliate_links;

create policy "affiliate links owner read"
on public.affiliate_links
for select
to authenticated
using (
    affiliate_id in (
        select id
        from public.affiliate_profiles
        where user_id = auth.uid()
    )
);


drop policy if exists "affiliate links owner insert"
on public.affiliate_links;

create policy "affiliate links owner insert"
on public.affiliate_links
for insert
to authenticated
with check (
    affiliate_id in (
        select id
        from public.affiliate_profiles
        where user_id = auth.uid()
    )
);


-- ============================================================
-- 19. SELLER AFFILIATE SETTINGS
-- ============================================================

drop policy if exists "seller affiliate settings owner"
on public.seller_affiliate_settings;

create policy "seller affiliate settings owner"
on public.seller_affiliate_settings
for all
to authenticated
using (seller_id = auth.uid())
with check (seller_id = auth.uid());


-- ============================================================
-- 20. PRODUCT AFFILIATE SETTINGS
-- ============================================================

drop policy if exists "product affiliate public read"
on public.product_affiliate_settings;

create policy "product affiliate public read"
on public.product_affiliate_settings
for select
to anon, authenticated
using (true);


-- ============================================================
-- 21. SUPPLIER PROFILES
-- ============================================================

drop policy if exists "supplier public read"
on public.supplier_profiles;

create policy "supplier public read"
on public.supplier_profiles
for select
to anon, authenticated
using (is_active = true);


drop policy if exists "supplier owner manage"
on public.supplier_profiles;

create policy "supplier owner manage"
on public.supplier_profiles
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());


-- ============================================================
-- 22. SUPPLIER ORDERS
-- ============================================================

drop policy if exists "supplier order supplier read"
on public.supplier_orders;

create policy "supplier order supplier read"
on public.supplier_orders
for select
to authenticated
using (
    supplier_id in (
        select id
        from public.supplier_profiles
        where user_id = auth.uid()
    )
);


-- ============================================================
-- 23. AFFILIATE PROFILE CREATION FUNCTION
-- ============================================================

create or replace function public.create_affiliate_profile()
returns public.affiliate_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    existing public.affiliate_profiles;
    created public.affiliate_profiles;
    generated_code text;
begin

    select *
    into existing
    from public.affiliate_profiles
    where user_id = auth.uid();

    if existing.id is not null then
        return existing;
    end if;

    generated_code :=
        'GB-' ||
        upper(substr(
            encode(gen_random_bytes(5), 'hex'),
            1,
            8
        ));

    insert into public.affiliate_profiles (
        user_id,
        affiliate_code,
        display_name
    )
    values (
        auth.uid(),
        generated_code,
        'GamBasket Affiliate'
    )
    returning *
    into created;

    return created;
end;
$$;

grant execute
on function public.create_affiliate_profile()
to authenticated;