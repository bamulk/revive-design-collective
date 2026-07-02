-- Backfilled into the repo from the live DB (applied via MCP as
-- 040_activity_log). Written idempotently so a clean
-- `supabase db reset` rebuilds the live schema. Repo docs only.

-- Append-only audit feed surfaced in the admin Activity center.
-- Each row snapshots actor + stage metadata at write time so deletes
-- don't blank out the history.
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                                  -- 'stage_status_change' | 'stage_created' | 'stage_deleted' | 'photo_added' | 'payment_recorded'
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,                                     -- snapshot for display
  actor_email text,                                    -- snapshot for display
  stage_id uuid references public.stages(id) on delete set null,
  stage_address text,                                  -- snapshot
  details jsonb not null default '{}'::jsonb,          -- kind-specific extras
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_idx
  on public.activity_log(created_at desc);
create index if not exists activity_log_stage_id_idx
  on public.activity_log(stage_id);

alter table public.activity_log enable row level security;

-- Internal-RW only; portal clients should never see this feed.
drop policy if exists activity_log_internal_all on public.activity_log;
create policy activity_log_internal_all on public.activity_log
  for all to authenticated
  using (public.is_internal_user())
  with check (public.is_internal_user());
