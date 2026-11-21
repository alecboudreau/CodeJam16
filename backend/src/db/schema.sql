CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, repos TEXT, deadline TEXT,
  spec_text TEXT, created_at TEXT, plan_active INTEGER DEFAULT 0,
  plan_version INTEGER DEFAULT 0, grace_period_hours INTEGER,
  grace_approved_by TEXT DEFAULT '[]', pending_plan TEXT, demo_now TEXT);
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, project_id TEXT, name TEXT,
  github_username TEXT, github_aliases TEXT DEFAULT '[]', discord_id TEXT, email TEXT,
  capacity_hours_per_week INTEGER, status TEXT DEFAULT 'none', blocked_by_id TEXT,
  status_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, description TEXT,
  points INTEGER, owner_id TEXT, paths TEXT, tracked INTEGER DEFAULT 1,
  depends_on TEXT DEFAULT '[]', completion REAL DEFAULT 0, approved_by TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, owner_id TEXT,
  due_at TEXT, target_completion REAL, criteria TEXT, status TEXT DEFAULT 'pending',
  approved_by TEXT DEFAULT '[]', missed_at TEXT, grace_ends_at TEXT);
CREATE TABLE IF NOT EXISTS raw_commits (sha TEXT PRIMARY KEY, project_id TEXT, repo TEXT,
  author_login TEXT, co_authors TEXT, message TEXT, committed_at TEXT, files TEXT,
  diff TEXT, received_at TEXT);
CREATE TABLE IF NOT EXISTS judgments (sha TEXT PRIMARY KEY, project_id TEXT, author_ids TEXT,
  unmatched_login TEXT, task_id TEXT, kind TEXT, completion_delta REAL, confidence REAL,
  model TEXT, reason TEXT, checkin_id TEXT);
CREATE TABLE IF NOT EXISTS disputes (id TEXT PRIMARY KEY, project_id TEXT, target_kind TEXT,
  target_id TEXT, checkpoint_id TEXT, member_id TEXT, note TEXT, file_paths TEXT,
  status TEXT DEFAULT 'open', before TEXT, after TEXT, reason TEXT, created_at TEXT,
  resolved_at TEXT);
CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, skipped INTEGER DEFAULT 0,
  started_at TEXT, finished_at TEXT);
CREATE TABLE IF NOT EXISTS trace_steps (checkin_id TEXT, ord INTEGER, step TEXT, summary TEXT,
  details TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, checkin_id TEXT, member_id TEXT, checkpoint_id TEXT,
  action TEXT, reason TEXT, message TEXT, sent_at TEXT);
CREATE TABLE IF NOT EXISTS llm_calls (id TEXT PRIMARY KEY, project_id TEXT, checkin_id TEXT, purpose TEXT,
  model TEXT, input_tokens INTEGER, output_tokens INTEGER, usd REAL, wh REAL, at TEXT);
