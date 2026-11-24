CREATE TABLE feedback_digest_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  through_ms INTEGER NOT NULL,
  lease_id TEXT,
  lease_until_ms INTEGER,
  CHECK ((lease_id IS NULL) = (lease_until_ms IS NULL))
);
