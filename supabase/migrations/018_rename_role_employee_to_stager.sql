-- Rename the non-admin role from "employee" to "stager" to match
-- how Revive Design Collective actually refers to these team members.
--
-- Order matters: drop the CHECK constraint first so the UPDATE can
-- succeed, then add the new constraint that only allows the new value.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

UPDATE public.profiles SET role = 'stager' WHERE role = 'employee';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'stager'::text]));
