-- Postgres schema (Supabase). Same columns as the original SQLite schema (README §9); lists and
-- objects are stored as JSON text, timestamps as ISO text. `seq` replaces SQLite's implicit rowid
-- where rows are listed in insertion order.
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, repos TEXT, deadline TEXT,
  spec_text TEXT, created_at TEXT, plan_active INTEGER DEFAULT 0,
  plan_version INTEGER DEFAULT 0, grace_period_hours INTEGER,
  grace_approved_by TEXT DEFAULT '[]', pending_plan TEXT, demo_now TEXT);
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, seq BIGSERIAL, project_id TEXT, name TEXT,
  github_username TEXT, github_aliases TEXT DEFAULT '[]', discord_id TEXT, email TEXT,
  capacity_hours_per_week INTEGER, status TEXT DEFAULT 'none', blocked_by_id TEXT,
  status_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, seq BIGSERIAL, project_id TEXT, title TEXT, description TEXT,
  points INTEGER, owner_id TEXT, paths TEXT, tracked INTEGER DEFAULT 1,
  depends_on TEXT DEFAULT '[]', completion DOUBLE PRECISION DEFAULT 0, approved_by TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, seq BIGSERIAL, project_id TEXT, task_id TEXT, owner_id TEXT,
  due_at TEXT, target_completion DOUBLE PRECISION, criteria TEXT, status TEXT DEFAULT 'pending',
  approved_by TEXT DEFAULT '[]', missed_at TEXT, grace_ends_at TEXT);
CREATE TABLE IF NOT EXISTS raw_commits (sha TEXT PRIMARY KEY, project_id TEXT, repo TEXT,
  author_login TEXT, co_authors TEXT, message TEXT, committed_at TEXT, files TEXT,
  diff TEXT, received_at TEXT);
CREATE TABLE IF NOT EXISTS judgments (sha TEXT PRIMARY KEY, project_id TEXT, author_ids TEXT,
  unmatched_login TEXT, task_id TEXT, kind TEXT, completion_delta DOUBLE PRECISION, confidence DOUBLE PRECISION,
  model TEXT, reason TEXT, checkin_id TEXT);
CREATE TABLE IF NOT EXISTS disputes (id TEXT PRIMARY KEY, project_id TEXT, target_kind TEXT,
  target_id TEXT, checkpoint_id TEXT, member_id TEXT, note TEXT, file_paths TEXT,
  status TEXT DEFAULT 'open', before TEXT, after TEXT, reason TEXT, created_at TEXT,
  resolved_at TEXT);
-- started_at follows the project's clock (the demo clock when set); real_started_at is wall-clock time,
-- used to tell a running check-in from one whose serverless function died.
CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, skipped INTEGER DEFAULT 0,
  started_at TEXT, finished_at TEXT, real_started_at TEXT);
CREATE TABLE IF NOT EXISTS trace_steps (checkin_id TEXT, ord INTEGER, step TEXT, summary TEXT,
  details TEXT, at TEXT);
-- sent_at = delivered to the in-app Inbox (starts the cooldown); discord_sent = also delivered on Discord.
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, seq BIGSERIAL, checkin_id TEXT, member_id TEXT, checkpoint_id TEXT,
  action TEXT, reason TEXT, message TEXT, sent_at TEXT, discord_sent INTEGER DEFAULT 0);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS discord_sent INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS llm_calls (id TEXT PRIMARY KEY, project_id TEXT, checkin_id TEXT, purpose TEXT,
  model TEXT, input_tokens INTEGER, output_tokens INTEGER, usd DOUBLE PRECISION, wh DOUBLE PRECISION, at TEXT);

CREATE INDEX IF NOT EXISTS members_project ON members (project_id);
CREATE INDEX IF NOT EXISTS members_discord ON members (discord_id);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks (project_id);
CREATE INDEX IF NOT EXISTS checkpoints_project ON checkpoints (project_id);
CREATE INDEX IF NOT EXISTS raw_commits_project ON raw_commits (project_id);
CREATE INDEX IF NOT EXISTS judgments_project ON judgments (project_id);
CREATE INDEX IF NOT EXISTS checkins_project ON checkins (project_id);
CREATE INDEX IF NOT EXISTS trace_steps_checkin ON trace_steps (checkin_id);
CREATE INDEX IF NOT EXISTS decisions_checkin ON decisions (checkin_id);
CREATE INDEX IF NOT EXISTS llm_calls_project ON llm_calls (project_id);

-- Supabase exposes tables through its public REST API to anyone with the publishable key (which is
-- public: it's in the web app). Row-level security with no policies blocks that API entirely.
-- Our backend connects as the database owner, which bypasses RLS, so it keeps full access.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE judgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE trace_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
