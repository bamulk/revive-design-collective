-- A portal magic link created an auth user whose trigger-generated
-- profile defaulted to role 'stager' — a CLIENT landed in the staff
-- app with stager access. Two-part fix:
--
-- 1) profiles.role: nullable, no default. A profile without an
--    explicitly granted role has NO team access (the app layout and
--    is_internal_user() both require a team role).
ALTER TABLE profiles ALTER COLUMN role DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN role DROP DEFAULT;

-- 2) Only create profiles for invited team members. Employee invites
--    carry full_name in the user metadata; portal-created client
--    users don't, so they get no profiles row at all.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
begin
  if new.raw_user_meta_data ? 'full_name' then
    insert into public.profiles (id, email, full_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  end if;
  return new;
end; $$;
