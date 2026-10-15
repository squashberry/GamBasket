create table if not exists public.business_websites (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    business_name varchar(120) not null,
    slug varchar(100) not null unique,
    description text,
    location varchar(200),
    phone varchar(30),
    whatsapp varchar(30),
    logo_url text,
    cover_url text,
    palette varchar(30) not null default 'blue',
    template varchar(40) not null default 'aurora',
    opening_hours text,
    status varchar(20) not null default 'published' check (status in ('draft','published','disabled')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    published_at timestamptz
);
create index if not exists business_websites_user_idx on public.business_websites(user_id);
create index if not exists business_websites_slug_idx on public.business_websites(slug);
create or replace function public.touch_business_website() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists business_websites_touch on public.business_websites;
create trigger business_websites_touch before update on public.business_websites for each row execute function public.touch_business_website();
alter table public.business_websites enable row level security;
drop policy if exists "business websites owner select" on public.business_websites;
create policy "business websites owner select" on public.business_websites for select to authenticated using (user_id = auth.uid());
drop policy if exists "business websites owner insert" on public.business_websites;
create policy "business websites owner insert" on public.business_websites for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "business websites owner update" on public.business_websites;
create policy "business websites owner update" on public.business_websites for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "business websites owner delete" on public.business_websites;
create policy "business websites owner delete" on public.business_websites for delete to authenticated using (user_id = auth.uid());
drop policy if exists "published business websites public access" on public.business_websites;
create policy "published business websites public access" on public.business_websites for select to anon, authenticated using (status = 'published');
insert into storage.buckets (id,name,public) values ('business-sites','business-sites',true) on conflict (id) do update set public = true;
drop policy if exists "business site image upload" on storage.objects;
create policy "business site image upload" on storage.objects for insert to authenticated with check (bucket_id = 'business-sites' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "business site image update" on storage.objects;
create policy "business site image update" on storage.objects for update to authenticated using (bucket_id = 'business-sites' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'business-sites' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "business site image delete" on storage.objects;
create policy "business site image delete" on storage.objects for delete to authenticated using (bucket_id = 'business-sites' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "business site image public read" on storage.objects;
create policy "business site image public read" on storage.objects for select to public using (bucket_id = 'business-sites');
