-- Cache the path of the OLDEST stage_photo per stage so list pages
-- can render thumbnails without scanning the whole stage_photos
-- table (~5k rows today). Maintained by trigger on insert + delete.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS first_photo_storage_path text;

CREATE OR REPLACE FUNCTION public.refresh_stage_first_photo(p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_path text;
BEGIN
  SELECT storage_path
    INTO next_path
    FROM public.stage_photos
    WHERE stage_id = p_stage_id
    ORDER BY created_at ASC
    LIMIT 1;
  UPDATE public.stages
    SET first_photo_storage_path = next_path
    WHERE id = p_stage_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_photos_first_photo_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_stage_first_photo(OLD.stage_id);
    RETURN OLD;
  ELSE
    PERFORM public.refresh_stage_first_photo(NEW.stage_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS stage_photos_first_photo_aiud ON public.stage_photos;
CREATE TRIGGER stage_photos_first_photo_aiud
AFTER INSERT OR DELETE ON public.stage_photos
FOR EACH ROW EXECUTE FUNCTION public.stage_photos_first_photo_trigger();

-- One-time backfill.
UPDATE public.stages s
SET first_photo_storage_path = sp.storage_path
FROM (
  SELECT DISTINCT ON (stage_id) stage_id, storage_path
  FROM public.stage_photos
  ORDER BY stage_id, created_at ASC
) sp
WHERE s.id = sp.stage_id
  AND s.first_photo_storage_path IS DISTINCT FROM sp.storage_path;
