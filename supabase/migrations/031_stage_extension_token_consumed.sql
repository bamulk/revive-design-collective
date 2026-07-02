-- When the client confirms or declines an extension on /x/{token},
-- we used to NULL out stages.extension_token. That left the page
-- unable to find the stage on the next request (the "thanks for your
-- response" confirmation never rendered — users saw a 404).
--
-- New column: extension_token_consumed. On a successful extend or
-- destage choice, we MOVE the token from extension_token into here
-- instead of nulling it. The /x page looks up by either column;
-- server actions still only fire when the active column matches.
ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS extension_token_consumed text;

CREATE INDEX IF NOT EXISTS stages_extension_token_consumed_idx
  ON public.stages (extension_token_consumed)
  WHERE extension_token_consumed IS NOT NULL;
