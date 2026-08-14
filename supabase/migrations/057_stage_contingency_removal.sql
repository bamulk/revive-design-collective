-- Admin-entered date when the buyer's contingencies are removed on a
-- stage's sale — surfaced on the stage page and the dashboard's
-- "Contingency removals" section.
ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS contingency_removal_date date;
