-- Run this in your Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ============ profiles (employees) ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone text,
  role text not null default 'employee' check (role in ('admin','employee')),
  created_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============ clients ============
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============ stages ============
create table if not exists public.stages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  address text not null,
  amount numeric(12,2) not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled','staged','destaged','completed','cancelled')),
  stage_date date,
  destage_date date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists stages_client_idx on public.stages(client_id);
create index if not exists stages_status_idx on public.stages(status);

-- ============ stage_photos ============
create table if not exists public.stage_photos (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  storage_path text not null,
  caption text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stage_photos_stage_idx on public.stage_photos(stage_id);

-- ============ stage_tasks (checklist items) ============
create table if not exists public.stage_tasks (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists stage_tasks_stage_idx on public.stage_tasks(stage_id);
create index if not exists stage_tasks_position_idx on public.stage_tasks(stage_id, position);

-- ============ RLS ============
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.stages enable row level security;
alter table public.stage_photos enable row level security;
alter table public.stage_tasks enable row level security;

-- helper: is admin
create or replace function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- profiles policies
drop policy if exists "profiles_select_all_authed" on public.profiles;
create policy "profiles_select_all_authed" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert" on public.profiles
  for insert with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete" on public.profiles
  for delete using (public.is_admin());

-- clients policies (any authed user can CRUD)
drop policy if exists "clients_authed_all" on public.clients;
create policy "clients_authed_all" on public.clients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- stages policies
drop policy if exists "stages_authed_all" on public.stages;
create policy "stages_authed_all" on public.stages
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- stage_photos policies
drop policy if exists "stage_photos_authed_all" on public.stage_photos;
create policy "stage_photos_authed_all" on public.stage_photos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- stage_tasks policies
drop policy if exists "stage_tasks_authed_all" on public.stage_tasks;
create policy "stage_tasks_authed_all" on public.stage_tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============ storage bucket for photos ============
insert into storage.buckets (id, name, public)
values ('stage-photos', 'stage-photos', false)
on conflict (id) do nothing;

drop policy if exists "stage_photos_read" on storage.objects;
create policy "stage_photos_read" on storage.objects
  for select using (bucket_id = 'stage-photos' and auth.role() = 'authenticated');

drop policy if exists "stage_photos_write" on storage.objects;
create policy "stage_photos_write" on storage.objects
  for insert with check (bucket_id = 'stage-photos' and auth.role() = 'authenticated');

drop policy if exists "stage_photos_delete" on storage.objects;
create policy "stage_photos_delete" on storage.objects
  for delete using (bucket_id = 'stage-photos' and auth.role() = 'authenticated');
