-- When a project first went missing, so forgetting can wait out a rename or a detached volume
-- instead of deleting a project's notes and decisions on a single unlucky observation.
ALTER TABLE projects ADD COLUMN missing_since TEXT;

-- Existing missing rows have no recorded start. Treat them as missing from now rather than
-- backdating them, so the upgrade cannot make a project immediately eligible to be forgotten.
UPDATE projects SET missing_since = updated_at WHERE is_missing = 1 AND missing_since IS NULL;
