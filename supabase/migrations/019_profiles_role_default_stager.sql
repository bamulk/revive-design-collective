-- The column default still pointed at the old 'employee' value after
-- mig 018 renamed the role. handle_new_user (the auth trigger) only
-- inserts (id, email, full_name) and relies on the column default
-- for role — so every new signup was being created with role='employee'
-- which violated the post-rename CHECK constraint, producing
-- "Database error saving new user" on the invite flow.
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'stager';
