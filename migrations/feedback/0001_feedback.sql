CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('suggestion', 'error')),
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'fixed', 'closed')),
  note TEXT NOT NULL DEFAULT '',
  -- Validated, allowlisted payload. Receipt time is tracked separately.
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  CHECK ((kind = 'error' AND category IS NULL) OR
         (kind = 'suggestion' AND category IS NOT NULL AND category IN ('suggestion', 'problem', 'experience', 'other')))
);
CREATE INDEX feedback_time ON feedback(created_at DESC, id DESC);
CREATE INDEX feedback_status ON feedback(status);
