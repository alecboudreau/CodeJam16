CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, repos TEXT, deadline TEXT,
  spec_text TEXT, created_at TEXT, locked_at TEXT, taskmap_locked INTEGER DEFAULT 0,
  taskmap_version INTEGER DEFAULT 0, pending_tasks TEXT);
CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, project_id TEXT, name TEXT,
  github_username TEXT, github_aliases TEXT DEFAULT '[]', discord_id TEXT, email TEXT,
  status TEXT DEFAULT 'none', blocked_by_id TEXT, status_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, description TEXT,
  points INTEGER, owner_id TEXT, paths TEXT, tracked INTEGER DEFAULT 1,
  completion REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS taskmap_agreements (project_id TEXT, member_id TEXT, at TEXT,
  PRIMARY KEY (project_id, member_id));
CREATE TABLE IF NOT EXISTS raw_commits (sha TEXT PRIMARY KEY, project_id TEXT, repo TEXT,
  author_login TEXT, co_authors TEXT, message TEXT, committed_at TEXT, files TEXT,
  diff TEXT, received_at TEXT);
CREATE TABLE IF NOT EXISTS judgments (sha TEXT PRIMARY KEY, project_id TEXT, author_ids TEXT,
  unmatched_login TEXT, task_id TEXT, kind TEXT, completion_delta REAL, confidence REAL,
  model TEXT, reason TEXT, checkin_id TEXT, dispute TEXT);
CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, project_id TEXT, started_at TEXT, finished_at TEXT);
CREATE TABLE IF NOT EXISTS trace_steps (checkin_id TEXT, ord INTEGER, step TEXT, summary TEXT,
  details TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, checkin_id TEXT, member_id TEXT, task_id TEXT,
  action TEXT, reason TEXT, ignored_count INTEGER, message TEXT, sent_at TEXT);
CREATE TABLE IF NOT EXISTS llm_calls (id TEXT PRIMARY KEY, project_id TEXT, checkin_id TEXT, purpose TEXT,
  model TEXT, input_tokens INTEGER, output_tokens INTEGER, usd REAL, wh REAL, at TEXT);
