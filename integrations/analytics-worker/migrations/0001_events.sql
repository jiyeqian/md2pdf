CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  minute TEXT NOT NULL,
  event TEXT NOT NULL,
  version TEXT NOT NULL,
  deployment TEXT NOT NULL,
  properties TEXT NOT NULL,
  country TEXT NOT NULL
);
CREATE INDEX events_minute_event ON events(minute, event);

CREATE TABLE daily_counts (day TEXT PRIMARY KEY, total INTEGER NOT NULL);
CREATE TRIGGER event_daily_count AFTER INSERT ON events
BEGIN
  INSERT INTO daily_counts(day, total) VALUES (substr(NEW.minute, 1, 10), 1)
  ON CONFLICT(day) DO UPDATE SET total = total + 1;
END;
