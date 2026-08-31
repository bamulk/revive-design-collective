-- Which rooms/areas this stage covers. Picked as checkboxes on the New
-- Stage form (and editable on the stage page); stored as a jsonb array
-- of keys from STAGED_ROOMS in src/lib/staged-rooms.ts.
alter table public.stages
  add column if not exists staged_rooms jsonb not null default '[]'::jsonb;
