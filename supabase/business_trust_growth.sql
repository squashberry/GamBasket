/*
  GamBasket business, trust & growth upgrade.
  Run after the existing schema/commerce/affiliate migrations.  This migration is
  deliberately additive and keeps retail checkout separate from supplier B2B work.
*/

create extension if not exists pgcrypto;

/* Roles and product capabilities ------------------------------------------------ */
insert into public.roles (id, name, description)
values ('supplier', 'Verified Supplier', 'Wholesale merchant for business buyers.')
on conflict (id) do update set name = excluded.name, description = excluded.description;

alter table public.products add column if not exists listing_type varchar(20) not null default 'retail';
alter table public.products add column if not exists min_order_quantity integer not null default 1;
alter table public.products add column if not exists wholesale_price numeric(14,2);
alter table public.products add column if not exists wholesale_currency varchar(10) default 'GMD';
alter table public.products add column if not exists wholesale_enabled boolean not null default false;
alter table public.products add column if not exists is_featured boolean not null default false;
alter table public.products add column if not exists featured_until timestamptz;
alter table public.products add column if not exists promotion_id uuid;
alter table public.products add column if not exists searchable boolean not null default true;
alter table public.products add column if not exists verification_status varchar(30) not null default 'unverified';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_listing_type_check') then
    alter table public.products add constraint products_listing_type_check
      check (listing_type in ('retail', 'wholesale', 'both'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_min_order_quantity_check') then
    alter table public.products add constraint products_min_order_quantity_check
      check (min_order_quantity >= 1);
  end if;
end $$;

/* Existing installations have supplier_profiles from Affiliate.sql.  Extend it. */
alter table public.supplier_profiles add column if not exists cover_url text;
alter table public.supplier_profiles add column if not exists website_slug varchar(120);
alter table public.supplier_profiles add column if not exists verification_status varchar(30) not null default 'unverified';
alter table public.supplier_profiles add column if not exists rating numeric(3,2) not null default 0;
alter table public.supplier_profiles add column if not exists total_reviews integer not null default 0;
alter table public.supplier_profiles add column if not exists response_rate numeric(5,2) not null default 0;
alter table public.supplier_profiles add column if not exists cancellation_rate numeric(5,2) not null default 0;
alter table public.supplier_profiles add column if not exists website_slug_normalized text generated always as (lower(website_slug)) stored;
create unique index if not exists supplier_profiles_website_slug_unique on public.supplier_profiles(website_slug_normalized) where website_slug is not null;

create table if not exists public.seller_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  business_name varchar(150), business_category varchar(100), description text,
  phone varchar(40), whatsapp varchar(40), location varchar(200), logo_url text, cover_url text,
  website_slug varchar(120) unique, verification_status varchar(30) not null default 'unverified',
  rating numeric(3,2) not null default 0, total_reviews integer not null default 0,
  total_sales numeric(14,2) not null default 0, response_rate numeric(5,2) not null default 0,
  cancellation_rate numeric(5,2) not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  role_type varchar(30) not null check (role_type in ('seller', 'supplier')),
  business_name varchar(150), business_category varchar(100), identity_document_url text,
  business_document_url text, additional_document_url text, notes text,
  status varchar(30) not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'needs_information')),
  submitted_at timestamptz not null default now(), reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id), review_notes text
);

create table if not exists public.trust_reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  target_product_id uuid references public.products(id) on delete set null,
  target_store_id uuid references public.stores(id) on delete set null,
  report_type varchar(50) not null, reason text not null, evidence text,
  status varchar(30) not null default 'open' check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  priority varchar(20) not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references public.profiles(id), resolution text, created_at timestamptz not null default now(), resolved_at timestamptz
);

create table if not exists public.account_actions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  action_type varchar(30) not null check (action_type in ('warning', 'suspend', 'ban', 'unsuspend', 'unban')),
  reason text not null, expires_at timestamptz, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);

create table if not exists public.marketplace_reviews (
  id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid references public.profiles(id) on delete set null, rating integer not null check (rating between 1 and 5),
  title varchar(120), body text, status varchar(20) not null default 'published' check (status in ('published', 'hidden')),
  seller_reply text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(order_id, product_id, buyer_id)
);

create table if not exists public.marketplace_disputes (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  opened_by uuid not null references public.profiles(id) on delete cascade, reason varchar(100) not null,
  description text, evidence text, status varchar(30) not null default 'open' check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  assigned_to uuid references public.profiles(id), resolution text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), resolved_at timestamptz
);

create table if not exists public.seller_promotions (
  id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.profiles(id) on delete cascade,
  title varchar(150) not null, description text, promotion_type varchar(30) not null check (promotion_type in ('percentage', 'fixed', 'free_delivery', 'flash_sale')),
  discount_value numeric(14,2) not null default 0 check (discount_value >= 0), minimum_order numeric(14,2) not null default 0,
  max_discount numeric(14,2), starts_at timestamptz not null, ends_at timestamptz not null,
  is_active boolean not null default true, created_at timestamptz not null default now(), check (ends_at > starts_at)
);
create table if not exists public.product_promotions (
  id uuid primary key default gen_random_uuid(), promotion_id uuid not null references public.seller_promotions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, unique(promotion_id, product_id)
);
create table if not exists public.marketplace_campaigns (
  id uuid primary key default gen_random_uuid(), name varchar(150) not null, slug varchar(180) unique, description text, banner_url text,
  campaign_type varchar(30) not null default 'marketplace', starts_at timestamptz not null, ends_at timestamptz not null,
  affiliate_commission_boost numeric(5,2) not null default 0, is_active boolean not null default true,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), check (ends_at > starts_at)
);
create table if not exists public.campaign_products (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.marketplace_campaigns(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, unique(campaign_id, product_id)
);
create table if not exists public.featured_products (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  placement varchar(50) not null default 'home', priority integer not null default 0, starts_at timestamptz not null default now(),
  ends_at timestamptz, status varchar(20) not null default 'active' check (status in ('active', 'inactive', 'expired')),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.wishlist_alerts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade, alert_type varchar(30) not null check (alert_type in ('price_drop', 'back_in_stock')),
  old_value numeric, new_value numeric, created_at timestamptz not null default now(), is_read boolean not null default false
);
create table if not exists public.growth_notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete cascade,
  campaign_id uuid references public.marketplace_campaigns(id) on delete cascade, type varchar(40) not null,
  title varchar(160) not null, message text not null, action_url text, is_read boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null,
  action varchar(100) not null, entity_type varchar(60), entity_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create index if not exists trust_reports_queue_idx on public.trust_reports(status, priority, created_at);
create index if not exists verification_requests_queue_idx on public.verification_requests(status, submitted_at);
create index if not exists marketplace_reviews_product_idx on public.marketplace_reviews(product_id, status);
create index if not exists marketplace_disputes_queue_idx on public.marketplace_disputes(status, created_at);
create index if not exists featured_products_active_idx on public.featured_products(placement, priority desc) where status = 'active';
create index if not exists growth_notifications_user_idx on public.growth_notifications(user_id, created_at desc);

/* Security helpers, policies and safe server-side operations -------------------- */
create or replace function public.is_gambasket_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.has_role(auth.uid(), 'admin'), false) $$;

alter table public.seller_profiles enable row level security;
alter table public.supplier_profiles enable row level security;
alter table public.verification_requests enable row level security;
alter table public.trust_reports enable row level security;
alter table public.account_actions enable row level security;
alter table public.marketplace_reviews enable row level security;
alter table public.marketplace_disputes enable row level security;
alter table public.seller_promotions enable row level security;
alter table public.product_promotions enable row level security;
alter table public.marketplace_campaigns enable row level security;
alter table public.campaign_products enable row level security;
alter table public.featured_products enable row level security;
alter table public.wishlist_alerts enable row level security;
alter table public.growth_notifications enable row level security;
alter table public.platform_audit_logs enable row level security;

drop policy if exists "business seller public read" on public.seller_profiles;
create policy "business seller public read" on public.seller_profiles for select to anon, authenticated using (is_active or user_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business seller owner manage" on public.seller_profiles;
create policy "business seller owner manage" on public.seller_profiles for all to authenticated using (user_id = auth.uid() or public.is_gambasket_admin()) with check (user_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business supplier public read" on public.supplier_profiles;
create policy "business supplier public read" on public.supplier_profiles for select to anon, authenticated using (is_active or user_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business supplier owner manage" on public.supplier_profiles;
create policy "business supplier owner manage" on public.supplier_profiles for all to authenticated using (user_id = auth.uid() or public.is_gambasket_admin()) with check (user_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business verification queue" on public.verification_requests;
create policy "business verification queue" on public.verification_requests for select to authenticated using (user_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business reports visible to reporter" on public.trust_reports;
create policy "business reports visible to reporter" on public.trust_reports for select to authenticated using (reporter_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business reviews public read" on public.marketplace_reviews;
create policy "business reviews public read" on public.marketplace_reviews for select to anon, authenticated using (status = 'published' or buyer_id = auth.uid() or seller_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business disputes participants read" on public.marketplace_disputes;
create policy "business disputes participants read" on public.marketplace_disputes for select to authenticated using (opened_by = auth.uid() or exists (select 1 from public.orders o where o.id = order_id and o.seller_id = auth.uid()) or public.is_gambasket_admin());
drop policy if exists "business seller promotions public read" on public.seller_promotions;
create policy "business seller promotions public read" on public.seller_promotions for select to anon, authenticated using (is_active or seller_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business product promotions public read" on public.product_promotions;
create policy "business product promotions public read" on public.product_promotions for select to anon, authenticated using (true);
drop policy if exists "business campaigns public read" on public.marketplace_campaigns;
create policy "business campaigns public read" on public.marketplace_campaigns for select to anon, authenticated using (is_active or public.is_gambasket_admin());
drop policy if exists "business campaign products public read" on public.campaign_products;
create policy "business campaign products public read" on public.campaign_products for select to anon, authenticated using (true);
drop policy if exists "business featured public read" on public.featured_products;
create policy "business featured public read" on public.featured_products for select to anon, authenticated using (status = 'active' or public.is_gambasket_admin());
drop policy if exists "business wishlist alerts own read" on public.wishlist_alerts;
create policy "business wishlist alerts own read" on public.wishlist_alerts for select to authenticated using (user_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business growth notifications own read" on public.growth_notifications;
create policy "business growth notifications own read" on public.growth_notifications for select to authenticated using (user_id = auth.uid() or public.is_gambasket_admin());
drop policy if exists "business growth notifications own update" on public.growth_notifications;
create policy "business growth notifications own update" on public.growth_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "business audit admin read" on public.platform_audit_logs;
create policy "business audit admin read" on public.platform_audit_logs for select to authenticated using (public.is_gambasket_admin());

drop policy if exists "Suppliers can create wholesale products" on public.products;
create policy "Suppliers can create wholesale products" on public.products for insert to authenticated
  with check (auth.uid() = seller_id and public.has_role(auth.uid(), 'supplier') and listing_type in ('wholesale', 'both'));

create or replace function public.validate_business_product()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.listing_type in ('wholesale', 'both') then
    if not public.has_role(new.seller_id, 'supplier') then raise exception 'Supplier role required for wholesale listings'; end if;
    if coalesce(new.min_order_quantity, 1) < 1 then raise exception 'Minimum order quantity must be at least 1'; end if;
    if new.wholesale_price is null or new.wholesale_price < 0 then raise exception 'Wholesale price is required for wholesale listings'; end if;
    new.wholesale_enabled := true;
  else
    new.wholesale_enabled := false;
    new.min_order_quantity := 1;
  end if;
  return new;
end $$;
drop trigger if exists business_product_validation on public.products;
create trigger business_product_validation before insert or update of listing_type, min_order_quantity, wholesale_price on public.products for each row execute function public.validate_business_product();

create or replace function public.submit_verification_request(p_role_type varchar, p_business_name varchar, p_business_category varchar, p_identity_document_url text default null, p_business_document_url text default null, p_additional_document_url text default null, p_notes text default null)
returns public.verification_requests language plpgsql security definer set search_path = public as $$
declare result public.verification_requests;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_role_type not in ('seller', 'supplier') then raise exception 'Unsupported verification role'; end if;
  if exists (select 1 from public.verification_requests where user_id = auth.uid() and role_type = p_role_type and status in ('pending', 'needs_information')) then raise exception 'A verification request is already in progress'; end if;
  insert into public.verification_requests(user_id, role_type, business_name, business_category, identity_document_url, business_document_url, additional_document_url, notes)
  values(auth.uid(), p_role_type, nullif(trim(p_business_name), ''), nullif(trim(p_business_category), ''), p_identity_document_url, p_business_document_url, p_additional_document_url, p_notes) returning * into result;
  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id) values(auth.uid(), 'verification_submitted', 'verification_request', result.id);
  return result;
end $$;

create or replace function public.create_trust_report(p_target_user_id uuid default null, p_target_product_id uuid default null, p_target_store_id uuid default null, p_report_type varchar default 'other', p_reason text default '', p_evidence text default null)
returns public.trust_reports language plpgsql security definer set search_path = public as $$
declare result public.trust_reports;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A report reason is required'; end if;
  if p_target_user_id is null and p_target_product_id is null and p_target_store_id is null then raise exception 'Choose an item, store, or account to report'; end if;
  insert into public.trust_reports(reporter_id,target_user_id,target_product_id,target_store_id,report_type,reason,evidence)
  values(auth.uid(),p_target_user_id,p_target_product_id,p_target_store_id,coalesce(nullif(trim(p_report_type),''),'other'),trim(p_reason),p_evidence) returning * into result;
  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id) values(auth.uid(), 'report_submitted', 'trust_report', result.id);
  return result;
end $$;

create or replace function public.submit_marketplace_review(p_order_id uuid, p_product_id uuid, p_rating integer, p_title varchar default null, p_body text default null)
returns public.marketplace_reviews language plpgsql security definer set search_path = public as $$
declare result public.marketplace_reviews; v_seller_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5'; end if;
  select o.seller_id into v_seller_id from public.orders o join public.order_items oi on oi.order_id = o.id where o.id = p_order_id and o.buyer_id = auth.uid() and oi.product_id = p_product_id and o.order_status in ('delivered','completed') limit 1;
  if v_seller_id is null then raise exception 'Reviews are available only after a completed purchase'; end if;
  insert into public.marketplace_reviews(order_id, product_id, buyer_id, seller_id, rating, title, body) values(p_order_id,p_product_id,auth.uid(),v_seller_id,p_rating,nullif(trim(p_title),''),nullif(trim(p_body),'')) returning * into result;
  return result;
end $$;

create or replace function public.open_marketplace_dispute(p_order_id uuid, p_reason varchar, p_description text default null, p_evidence text default null)
returns public.marketplace_disputes language plpgsql security definer set search_path = public as $$
declare result public.marketplace_disputes;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.orders where id = p_order_id and (buyer_id = auth.uid() or seller_id = auth.uid())) then raise exception 'You are not a participant in this order'; end if;
  insert into public.marketplace_disputes(order_id,opened_by,reason,description,evidence) values(p_order_id,auth.uid(),nullif(trim(p_reason),''),p_description,p_evidence) returning * into result;
  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id) values(auth.uid(), 'dispute_opened', 'marketplace_dispute', result.id);
  return result;
end $$;

create or replace function public.create_seller_promotion(p_title varchar, p_description text, p_type varchar, p_discount numeric, p_minimum numeric, p_starts timestamptz, p_ends timestamptz)
returns public.seller_promotions language plpgsql security definer set search_path = public as $$
declare result public.seller_promotions;
begin
  if not public.has_role(auth.uid(), 'seller') then raise exception 'Seller role required'; end if;
  if p_type not in ('percentage','fixed','free_delivery','flash_sale') or p_ends <= p_starts then raise exception 'Invalid promotion details'; end if;
  insert into public.seller_promotions(seller_id,title,description,promotion_type,discount_value,minimum_order,starts_at,ends_at) values(auth.uid(),nullif(trim(p_title),''),p_description,p_type,greatest(coalesce(p_discount,0),0),greatest(coalesce(p_minimum,0),0),p_starts,p_ends) returning * into result;
  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id) values(auth.uid(), 'promotion_created', 'seller_promotion', result.id);
  return result;
end $$;

create or replace function public.admin_set_verification(p_request_id uuid, p_status varchar, p_notes text default null)
returns public.verification_requests language plpgsql security definer set search_path = public as $$
declare result public.verification_requests;
begin
  if not public.is_gambasket_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('approved','rejected','needs_information') then raise exception 'Invalid verification status'; end if;
  update public.verification_requests set status=p_status,reviewed_at=now(),reviewed_by=auth.uid(),review_notes=p_notes where id=p_request_id and status in ('pending','needs_information') returning * into result;
  if result.id is null then raise exception 'Verification request is unavailable'; end if;
  if p_status = 'approved' then
    insert into public.user_roles(user_id,role_id,assigned_by,is_active) values(result.user_id,result.role_type,auth.uid(),true) on conflict(user_id,role_id) do update set is_active=true,assigned_by=excluded.assigned_by;
    if result.role_type = 'supplier' then
      insert into public.supplier_profiles(user_id,business_name,business_category,verification_status) values(result.user_id,coalesce(result.business_name,'Supplier'),result.business_category,'verified') on conflict(user_id) do update set verification_status='verified', business_name=coalesce(excluded.business_name, public.supplier_profiles.business_name), updated_at=now();
    else
      insert into public.seller_profiles(user_id,business_name,business_category,verification_status) values(result.user_id,coalesce(result.business_name,'Seller'),result.business_category,'verified') on conflict(user_id) do update set verification_status='verified', business_name=coalesce(excluded.business_name, public.seller_profiles.business_name), updated_at=now();
    end if;
  elsif result.role_type = 'supplier' then
    insert into public.supplier_profiles(user_id,business_name,business_category,verification_status) values(result.user_id,coalesce(result.business_name,'Supplier'),result.business_category,'rejected') on conflict(user_id) do update set verification_status='rejected', updated_at=now();
  elsif result.role_type = 'seller' then
    insert into public.seller_profiles(user_id,business_name,business_category,verification_status) values(result.user_id,coalesce(result.business_name,'Seller'),result.business_category,'rejected') on conflict(user_id) do update set verification_status='rejected', updated_at=now();
  end if;
  insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'verification_'||p_status,'verification_request',result.id,jsonb_build_object('user_id',result.user_id,'role_type',result.role_type));
  return result;
end $$;

create or replace function public.admin_account_action(p_user_id uuid, p_action varchar, p_reason text, p_expires_at timestamptz default null)
returns public.account_actions language plpgsql security definer set search_path = public as $$
declare result public.account_actions;
begin
  if not public.is_gambasket_admin() then raise exception 'Administrator access required'; end if;
  if p_action not in ('warning','suspend','ban','unsuspend','unban') or nullif(trim(p_reason),'') is null then raise exception 'Valid action and reason required'; end if;
  insert into public.account_actions(user_id,action_type,reason,expires_at,created_by) values(p_user_id,p_action,trim(p_reason),p_expires_at,auth.uid()) returning * into result;
  if p_action in ('suspend','ban') then update public.profiles set is_active=false,updated_at=now() where id=p_user_id; elsif p_action in ('unsuspend','unban') then update public.profiles set is_active=true,updated_at=now() where id=p_user_id; end if;
  insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'account_'||p_action,'profile',p_user_id,jsonb_build_object('reason',trim(p_reason),'expires_at',p_expires_at));
  return result;
end $$;

create or replace function public.admin_feature_product(p_product_id uuid, p_placement varchar, p_priority integer default 0, p_ends_at timestamptz default null)
returns public.featured_products language plpgsql security definer set search_path = public as $$
declare result public.featured_products;
begin
  if not public.is_gambasket_admin() then raise exception 'Administrator access required'; end if;
  insert into public.featured_products(product_id,placement,priority,ends_at,created_by) values(p_product_id,coalesce(nullif(trim(p_placement),''),'home'),coalesce(p_priority,0),p_ends_at,auth.uid()) returning * into result;
  update public.products set is_featured=true,featured_until=p_ends_at,updated_at=now() where id=p_product_id;
  insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'product_featured','product',p_product_id);
  return result;
end $$;

create or replace function public.admin_send_growth_notification(p_user_id uuid, p_title varchar, p_message text, p_type varchar default 'campaign', p_action_url text default null)
returns public.growth_notifications language plpgsql security definer set search_path = public as $$
declare result public.growth_notifications;
begin
  if not public.is_gambasket_admin() then raise exception 'Administrator access required'; end if;
  insert into public.growth_notifications(user_id,type,title,message,action_url) values(p_user_id,coalesce(nullif(trim(p_type),''),'campaign'),nullif(trim(p_title),''),nullif(trim(p_message),''),p_action_url) returning * into result;
  insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'growth_notification_sent','growth_notification',result.id);
  return result;
end $$;

create or replace function public.admin_create_campaign(p_name varchar, p_slug varchar, p_description text, p_banner_url text, p_starts_at timestamptz, p_ends_at timestamptz, p_affiliate_commission_boost numeric default 0)
returns public.marketplace_campaigns language plpgsql security definer set search_path = public as $$
declare result public.marketplace_campaigns;
begin
  if not public.is_gambasket_admin() then raise exception 'Administrator access required'; end if;
  if nullif(trim(p_name),'') is null or p_ends_at <= p_starts_at then raise exception 'A campaign name and valid dates are required'; end if;
  insert into public.marketplace_campaigns(name,slug,description,banner_url,starts_at,ends_at,affiliate_commission_boost,created_by)
  values(trim(p_name),nullif(lower(trim(p_slug)),''),p_description,p_banner_url,p_starts_at,p_ends_at,greatest(coalesce(p_affiliate_commission_boost,0),0),auth.uid()) returning * into result;
  insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'campaign_created','marketplace_campaign',result.id);
  return result;
end $$;

create or replace function public.admin_resolve_trust_report(p_report_id uuid, p_status varchar, p_resolution text default null)
returns public.trust_reports language plpgsql security definer set search_path = public as $$
declare result public.trust_reports;
begin
  if not public.is_gambasket_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('resolved','dismissed','in_review') then raise exception 'Invalid report status'; end if;
  update public.trust_reports set status=p_status, assigned_to=auth.uid(), resolution=p_resolution, resolved_at=case when p_status in ('resolved','dismissed') then now() else null end where id=p_report_id returning * into result;
  if result.id is null then raise exception 'Report not found'; end if;
  insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'report_'||p_status,'trust_report',result.id);
  return result;
end $$;

create or replace function public.admin_resolve_marketplace_dispute(p_dispute_id uuid, p_status varchar, p_resolution text default null)
returns public.marketplace_disputes language plpgsql security definer set search_path = public as $$
declare result public.marketplace_disputes;
begin
  if not public.is_gambasket_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('resolved','dismissed','in_review') then raise exception 'Invalid dispute status'; end if;
  update public.marketplace_disputes set status=p_status, assigned_to=auth.uid(), resolution=p_resolution, updated_at=now(), resolved_at=case when p_status in ('resolved','dismissed') then now() else null end where id=p_dispute_id returning * into result;
  if result.id is null then raise exception 'Dispute not found'; end if;
  insert into public.platform_audit_logs(actor_id,action,entity_type,entity_id) values(auth.uid(),'dispute_'||p_status,'marketplace_dispute',result.id);
  return result;
end $$;

create or replace function public.create_wishlist_growth_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price and new.price < old.price then
    insert into public.wishlist_alerts(user_id,product_id,alert_type,old_value,new_value)
      select user_id,new.id,'price_drop',old.price,new.price from public.wishlist_items where product_id=new.id;
    insert into public.growth_notifications(user_id,type,title,message,action_url)
      select user_id,'price_drop','Price drop','A product in your wishlist is now cheaper.','product.html?id=' || new.id from public.wishlist_items where product_id=new.id;
  end if;
  if coalesce(old.stock,0) <= 0 and coalesce(new.stock,0) > 0 then
    insert into public.wishlist_alerts(user_id,product_id,alert_type,old_value,new_value)
      select user_id,new.id,'back_in_stock',old.stock,new.stock from public.wishlist_items where product_id=new.id;
    insert into public.growth_notifications(user_id,type,title,message,action_url)
      select user_id,'back_in_stock','Back in stock','A product in your wishlist is available again.','product.html?id=' || new.id from public.wishlist_items where product_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists business_wishlist_growth_alerts on public.products;
create trigger business_wishlist_growth_alerts after update of price, stock on public.products for each row execute function public.create_wishlist_growth_alerts();

grant execute on function public.submit_verification_request(varchar,varchar,varchar,text,text,text,text), public.create_trust_report(uuid,uuid,uuid,varchar,text,text), public.submit_marketplace_review(uuid,uuid,integer,varchar,text), public.open_marketplace_dispute(uuid,varchar,text,text), public.create_seller_promotion(varchar,text,varchar,numeric,numeric,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_set_verification(uuid,varchar,text), public.admin_account_action(uuid,varchar,text,timestamptz), public.admin_feature_product(uuid,varchar,integer,timestamptz), public.admin_send_growth_notification(uuid,varchar,text,varchar,text) to authenticated;
grant execute on function public.admin_create_campaign(varchar,varchar,text,text,timestamptz,timestamptz,numeric), public.admin_resolve_trust_report(uuid,varchar,text), public.admin_resolve_marketplace_dispute(uuid,varchar,text) to authenticated;
