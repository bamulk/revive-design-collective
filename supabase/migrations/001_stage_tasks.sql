-- Checklist items for each stage.
-- Run this in your Supabase SQL editor.

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

alter table public.stage_tasks enable row level security;

drop policy if exists "stage_tasks_authed_all" on public.stage_tasks;
create policy "stage_tasks_authed_all" on public.stage_tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
