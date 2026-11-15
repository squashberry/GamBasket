-- JulaDirect <-> SquashberryPro external storefront commerce bridge.
-- Only the JulaDirect service role can read or mutate these records.
create table if not exists public.juladirect_store_connections (
  seller_user_id uuid primary key references auth.users(id) on delete cascade,
  pro_user_id uuid unique,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  link_code_hash text unique,
  link_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.juladirect_store_sites (
  site_id text primary key,
  pro_user_id uuid not null,
  seller_user_id uuid not null references auth.users(id) on delete cascade,
  site_slug text not null,
  site_name text not null default 'Store website',
  public_url text not null,
  is_published boolean not null default false,
  product_ids uuid[] not null default '{}'::uuid[],
  jula_checkout_enabled boolean not null default false,
  whatsapp_checkout_enabled boolean not null default false,
  whatsapp_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint juladirect_store_sites_checkout_method_check
    check (not (jula_checkout_enabled = false and whatsapp_checkout_enabled = false)
      or cardinality(product_ids) = 0)
);

create index if not exists juladirect_store_sites_seller_idx
  on public.juladirect_store_sites (seller_user_id, updated_at desc);
create index if not exists juladirect_store_sites_pro_owner_idx
  on public.juladirect_store_sites (pro_user_id, updated_at desc);
create index if not exists juladirect_store_sites_published_idx
  on public.juladirect_store_sites (site_id)
  where is_published = true;

create table if not exists public.juladirect_store_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.juladirect_store_sites(site_id) on delete cascade,
  token_hash text not null unique,
  cart jsonb not null check (jsonb_typeof(cart) = 'array'),
  buyer_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ordered', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists juladirect_store_checkout_sessions_expiry_idx
  on public.juladirect_store_checkout_sessions (expires_at);
create index if not exists juladirect_store_checkout_sessions_site_idx
  on public.juladirect_store_checkout_sessions (site_id, created_at desc);

alter table public.juladirect_store_connections enable row level security;
alter table public.juladirect_store_sites enable row level security;
alter table public.juladirect_store_checkout_sessions enable row level security;

revoke all on public.juladirect_store_connections from public, anon, authenticated;
revoke all on public.juladirect_store_sites from public, anon, authenticated;
revoke all on public.juladirect_store_checkout_sessions from public, anon, authenticated;
grant all on public.juladirect_store_connections to service_role;
grant all on public.juladirect_store_sites to service_role;
grant all on public.juladirect_store_checkout_sessions to service_role;

comment on table public.juladirect_store_connections is
  'Secure one-to-one seller identity links between JulaDirect and SquashberryPro. Link codes are stored only as hashes.';
comment on table public.juladirect_store_sites is
  'Published SquashberryPro store sites mapped to a JulaDirect seller and selected JulaDirect product IDs.';
comment on table public.juladirect_store_checkout_sessions is
  'Short-lived, single-use basket handoff sessions for JulaDirect hosted checkout. No stock is reserved until create_order succeeds.';
