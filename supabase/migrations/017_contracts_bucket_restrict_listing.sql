-- Drop the broad SELECT policy on the contracts bucket. The bucket
-- is already 'public' so object URLs still resolve for anyone with
-- the link — this policy just allowed listing/enumerating every file.
DROP POLICY IF EXISTS contracts_public_read ON storage.objects;
