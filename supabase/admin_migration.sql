begin;

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists banned_by uuid references public.profiles(id);
alter table public.profiles add column if not exists admin_notes text;

create table if not exists public.admin_settings (
    key text primary key,
    value jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles(id)
);
alter table public.admin_settings enable row level security;
drop policy if exists "admin settings access" on public.admin_settings;
create policy "admin settings access" on public.admin_settings for all to authenticated
using (exists (select 1 from public.user_roles where user_id = auth.uid() and role_id = 'admin' and is_active = true))
with check (exists (select 1 from public.user_roles where user_id = auth.uid() and role_id = 'admin' and is_active = true));

create table if not exists public.seller_plans (
    id uuid primary key default gen_random_uuid(), plan_key text not null unique, name text not null,
    monthly_fee numeric not null default 0, commission_rate numeric not null default 0,
    active_listing_limit integer not null default 1, website_enabled boolean not null default true,
    priority_support boolean not null default false, featured_listing_limit integer not null default 0,
    is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.seller_plans enable row level security;
drop policy if exists "admin seller plans access" on public.seller_plans;
create policy "admin seller plans access" on public.seller_plans for all to authenticated
using (exists (select 1 from public.user_roles where user_id = auth.uid() and role_id = 'admin' and is_active = true))
with check (exists (select 1 from public.user_roles where user_id = auth.uid() and role_id = 'admin' and is_active = true));
insert into public.seller_plans (plan_key,name,monthly_fee,commission_rate,active_listing_limit,website_enabled,priority_support,featured_listing_limit)
values ('starter','Starter',300,5,50,true,false,0),('business','Business',750,3.5,250,true,false,3),('professional','Professional',1500,2.5,1000,true,true,10),('quick_sell','Quick Sell',0,7,1,false,false,0)
on conflict (plan_key) do nothing;

create or replace function public.admin_write_log(p_action text,p_target_user uuid default null,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.user_roles where user_id = auth.uid() and role_id = 'admin' and is_active = true) then raise exception 'Not authorized'; end if;
    insert into public.activity_logs(user_id,action,metadata) values (auth.uid(),p_action,jsonb_build_object('target_user_id',p_target_user) || coalesce(p_metadata,'{}'::jsonb));
end;
$$;
grant execute on function public.admin_write_log(text,uuid,jsonb) to authenticated;

create or replace function public.admin_list_users() returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
    if not exists (select 1 from public.user_roles where user_id = auth.uid() and role_id = 'admin' and is_active = true) then raise exception 'Not authorized'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'first_name',p.first_name,'last_name',p.last_name,'email',p.email,'phone',p.phone,'country',p.country,'region',p.region,'area',p.area,'is_banned',p.is_banned,'ban_reason',p.ban_reason,'created_at',p.created_at,'roles',coalesce((select jsonb_agg(ur.role_id order by ur.role_id) from public.user_roles ur where ur.user_id=p.id and ur.is_active=true),'[]'::jsonb),'product_count',(select count(*) from public.products pr where pr.seller_id=p.id),'store_count',(select count(*) from public.stores s where s.seller_id=p.id),'website_count',(select count(*) from public.business_websites bw where bw.user_id=p.id),'order_count',(select count(*) from public.orders o where o.buyer_id=p.id or o.seller_id=p.id)) order by p.created_at desc),'[]'::jsonb) into result from public.profiles p;
    return result;
end;
$$;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_get_user_bundle(p_user_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
    if not exists (select 1 from public.user_roles where user_id = auth.uid() and role_id = 'admin' and is_active = true) then raise exception 'Not authorized'; end if;
    select jsonb_build_object('profile',(select to_jsonb(p) from public.profiles p where p.id=p_user_id),'roles',coalesce((select jsonb_agg(to_jsonb(ur)) from public.user_roles ur where ur.user_id=p_user_id),'[]'::jsonb),'products',coalesce((select jsonb_agg(to_jsonb(pr) order by pr.created_at desc) from public.products pr where pr.seller_id=p_user_id),'[]'::jsonb),'stores',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from public.stores s where s.seller_id=p_user_id),'[]'::jsonb),'websites',coalesce((select jsonb_agg(to_jsonb(bw) order by bw.created_at desc) from public.business_websites bw where bw.user_id=p_user_id),'[]'::jsonb),'seller_applications',coalesce((select jsonb_agg(to_jsonb(sa) order by sa.created_at desc) from public.seller_applications sa where sa.user_id=p_user_id),'[]'::jsonb),'worker_applications',coalesce((select jsonb_agg(to_jsonb(wa) order by wa.created_at desc) from public.worker_applications wa where wa.user_id=p_user_id),'[]'::jsonb),'orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.orders o where o.buyer_id=p_user_id or o.seller_id=p_user_id),'[]'::jsonb),'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.reports r where r.reporter_id=p_user_id or r.target_id=p_user_id),'[]'::jsonb),'earnings',coalesce((select jsonb_agg(to_jsonb(et) order by et.created_at desc) from public.earning_transactions et where et.user_id=p_user_id),'[]'::jsonb),'wishlist_count',(select count(*) from public.wishlist_items wi where wi.user_id=p_user_id)) into result;
    return coalesce(result,'{}'::jsonb);
end;
$$;
grant execute on function public.admin_get_user_bundle(uuid) to authenticated;

create or replace function public.admin_set_user_role(p_user_id uuid,p_role_id text,p_enabled boolean) returns boolean language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.user_roles where user_id=auth.uid() and role_id='admin' and is_active=true) then raise exception 'Not authorized'; end if;
    if p_enabled then insert into public.user_roles(user_id,role_id,assigned_by,is_active) values(p_user_id,p_role_id,auth.uid(),true) on conflict(user_id,role_id) do update set is_active=true,assigned_by=auth.uid(); else update public.user_roles set is_active=false,assigned_by=auth.uid() where user_id=p_user_id and role_id=p_role_id; end if;
    perform public.admin_write_log(case when p_enabled then 'ROLE_GRANTED' else 'ROLE_REVOKED' end,p_user_id,jsonb_build_object('role_id',p_role_id)); return true;
end;
$$;
grant execute on function public.admin_set_user_role(uuid,text,boolean) to authenticated;

create or replace function public.admin_set_user_ban(p_user_id uuid,p_banned boolean,p_reason text default null) returns boolean language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.user_roles where user_id=auth.uid() and role_id='admin' and is_active=true) then raise exception 'Not authorized'; end if;
    update public.profiles set is_banned=p_banned,ban_reason=case when p_banned then nullif(trim(p_reason),'') else null end,banned_at=case when p_banned then now() else null end,banned_by=case when p_banned then auth.uid() else null end where id=p_user_id;
    perform public.admin_write_log(case when p_banned then 'USER_BANNED' else 'USER_UNBANNED' end,p_user_id,jsonb_build_object('reason',p_reason)); return true;
end;
$$;
grant execute on function public.admin_set_user_ban(uuid,boolean,text) to authenticated;

create or replace function public.admin_set_seller_plan(p_user_id uuid,p_plan_key text) returns boolean language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.user_roles where user_id=auth.uid() and role_id='admin' and is_active=true) then raise exception 'Not authorized'; end if;
    update public.stores set plan_key=p_plan_key,updated_at=now() where seller_id=p_user_id;
    perform public.admin_write_log('SELLER_PLAN_CHANGED',p_user_id,jsonb_build_object('plan_key',p_plan_key));
    return true;
end;
$$;
grant execute on function public.admin_set_seller_plan(uuid,text) to authenticated;

create index if not exists idx_profiles_is_banned on public.profiles(is_banned);
create index if not exists idx_products_seller_id on public.products(seller_id);
create index if not exists idx_worker_applications_user_id on public.worker_applications(user_id);
create index if not exists idx_seller_applications_user_id on public.seller_applications(user_id);
commit;
