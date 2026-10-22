-- Legacy rows stay unlinked and cannot be used to infer visitor counts.
ALTER TABLE events ADD COLUMN site TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE events ADD COLUMN visitor_id TEXT;
CREATE INDEX events_visitor ON events(visitor_id) WHERE visitor_id IS NOT NULL;
