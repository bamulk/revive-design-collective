-- Idempotency stamp for the Trello photo import. The UNIQUE index
-- lets the importer skip attachments it has already saved on a
-- re-run (helpful if the script gets interrupted halfway through).
ALTER TABLE public.stage_photos
  ADD COLUMN IF NOT EXISTS trello_attachment_id text;

CREATE UNIQUE INDEX IF NOT EXISTS stage_photos_trello_attachment_id_key
  ON public.stage_photos(trello_attachment_id)
  WHERE trello_attachment_id IS NOT NULL;
