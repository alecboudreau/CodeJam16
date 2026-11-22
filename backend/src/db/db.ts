// Postgres (Supabase) helpers (owner: Person A). Row <-> shared-type mappers for every table (README §8, §9).
// Every helper is async. Inside tx(...), helpers automatically run on that transaction's connection.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import type {
  Checkpoint,
  CheckpointStatus,
  Decision,
  Dispute,
  Judgment,
  Member,
  MemberInput,
  MemberStatus,
  PlanDraft,
  Project,
  Task,
  TraceStep,
} from "@enforcer/shared";
import { config, rules } from "../config";

type Sql = postgres.Sql;
let pool: Sql | undefined;
const txStore = new AsyncLocalStorage<postgres.TransactionSql>();

function sqlClient(): Sql {
  if (!pool) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL isn't set (Supabase → Connect → Transaction pooler)");
    // prepare: false is required by Supabase's transaction pooler (port 6543).
    // DB_SCHEMA (tests only) keeps everything in a separate Postgres schema that can be dropped afterwards.
    const schema = process.env.DB_SCHEMA;
    pool = postgres(config.databaseUrl, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      onnotice: () => {},
      ...(schema ? { connection: { search_path: schema } } : {}),
    });
  }
  return pool;
}
const conn = (): Sql | postgres.TransactionSql => txStore.getStore() ?? sqlClient();

/** `?` placeholders → `$1, $2, …` (keeps the SQL readable and close to the original). */
function numbered(text: string): string {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}
type Param = string | number | boolean | null;
const clean = (params: unknown[]): Param[] => params.map((p) => (p === undefined ? null : (p as Param)));

type Row = Record<string, unknown>;
export async function dbAll<T = Row>(text: string, ...params: unknown[]): Promise<T[]> {
  return (await conn().unsafe(numbered(text), clean(params))) as unknown as T[];
}
export async function dbGet<T = Row>(text: string, ...params: unknown[]): Promise<T | undefined> {
  return (await dbAll<T>(text, ...params))[0];
}
/** Runs a statement; returns how many rows it changed. */
export async function dbRun(text: string, ...params: unknown[]): Promise<number> {
  const result = await conn().unsafe(numbered(text), clean(params));
  return result.count;
}

export async function initDb(): Promise<void> {
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  const schema = process.env.DB_SCHEMA;
  if (schema) await sqlClient().unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema.replace(/"/g, "")}"`);
  await sqlClient().unsafe(readFileSync(schemaPath, "utf8"));
}

export async function closeDb(): Promise<void> {
  await pool?.end({ timeout: 5 });
  pool = undefined;
}

/** Runs fn inside one transaction; helpers called inside it join the transaction. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn(); // already inside one
  return (await sqlClient().begin((t) => txStore.run(t, fn))) as T;
}

// ---------- small utilities ----------

export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();

const toJson = (v: unknown): string => JSON.stringify(v ?? null);
function fromJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v === "") return fallback;
  try {
    return (JSON.parse(v) as T) ?? fallback;
  } catch {
    return fallback;
  }
}
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const bool = (v: unknown): boolean => v === 1 || v === true || v === "1";
const int = (v: boolean): number => (v ? 1 : 0);
const num = (v: unknown, fallback = 0): number => (v === null || v === undefined ? fallback : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------- members ----------

function rowToMember(r: Row): Member {
  return {
    id: r.id as string,
    name: r.name as string,
    githubUsername: r.github_username as string,
    githubAliases: fromJson<string[]>(r.github_aliases, []),
    discordId: opt(r.discord_id as string | null),
    email: opt(r.email as string | null),
    capacityHoursPerWeek: numOrNull(r.capacity_hours_per_week) ?? undefined,
    status: ((r.status as MemberStatus | null) ?? "none"),
    blockedById: opt(r.blocked_by_id as string | null),
    statusAt: opt(r.status_at as string | null),
  };
}

export async function getMembers(projectId: string): Promise<Member[]> {
  return (await dbAll("SELECT * FROM members WHERE project_id = ? ORDER BY seq", projectId)).map(rowToMember);
}

export async function getMember(memberId: string): Promise<Member | undefined> {
  const r = await dbGet("SELECT * FROM members WHERE id = ?", memberId);
  return r && rowToMember(r);
}

export async function getMemberProjectId(memberId: string): Promise<string | undefined> {
  const r = await dbGet("SELECT project_id FROM members WHERE id = ?", memberId);
  return r?.project_id as string | undefined;
}

export async function insertMember(projectId: string, input: MemberInput): Promise<Member> {
  const id = newId();
  await dbRun(
    "INSERT INTO members (id, project_id, name, github_username, email, capacity_hours_per_week) VALUES (?, ?, ?, ?, ?, ?)",
    id, projectId, input.name, input.githubUsername, input.email ?? null, input.capacityHoursPerWeek ?? null,
  );
  return (await getMember(id))!;
}

export async function addGithubAlias(memberId: string, login: string): Promise<Member | undefined> {
  const m = await getMember(memberId);
  if (!m) return undefined;
  const aliases = m.githubAliases.some((a) => a.toLowerCase() === login.toLowerCase()) ? m.githubAliases : [...m.githubAliases, login];
  await dbRun("UPDATE members SET github_aliases = ? WHERE id = ?", toJson(aliases), memberId);
  return getMember(memberId);
}

/** For `/link <github-username>`: links that Discord account to every member with that GitHub username. */
export async function linkDiscord(githubUsername: string, discordId: string): Promise<number> {
  return dbRun("UPDATE members SET discord_id = ? WHERE lower(github_username) = lower(?)", discordId, githubUsername);
}

/** For the DM buttons. `blockedById` is only kept when status = "blocked". */
export async function setMemberStatus(memberId: string, status: MemberStatus, blockedById?: string): Promise<void> {
  await dbRun("UPDATE members SET status = ?, blocked_by_id = ?, status_at = ? WHERE id = ?",
    status, status === "blocked" ? blockedById ?? null : null, nowIso(), memberId);
}

export async function getMemberByDiscordId(discordId: string): Promise<Member | undefined> {
  const r = await dbGet("SELECT * FROM members WHERE discord_id = ? ORDER BY seq DESC", discordId);
  return r && rowToMember(r);
}

export async function setMemberDiscordId(memberId: string, discordId: string): Promise<void> {
  await dbRun("UPDATE members SET discord_id = ? WHERE id = ?", discordId, memberId);
}

// ---------- projects ----------

async function rowToProject(r: Row): Promise<Project> {
  return {
    id: r.id as string,
    name: r.name as string,
    repos: fromJson<string[]>(r.repos, []),
    members: await getMembers(r.id as string),
    deadline: r.deadline as string,
    createdAt: r.created_at as string,
    planActive: bool(r.plan_active),
    gracePeriodHours: numOrNull(r.grace_period_hours) ?? rules.DEFAULT_GRACE_PERIOD_HOURS,
  };
}

export async function getProject(projectId: string): Promise<Project | undefined> {
  const r = await dbGet("SELECT * FROM projects WHERE id = ?", projectId);
  return r ? rowToProject(r) : undefined;
}

export async function listActiveProjectIds(): Promise<string[]> {
  return (await dbAll("SELECT id FROM projects WHERE plan_active = 1")).map((r) => r.id as string);
}

export async function insertProject(
  p: { name: string; repos: string[]; deadline: string; members: MemberInput[] },
  id: string = newId(),
): Promise<Project> {
  await tx(async () => {
    await dbRun("INSERT INTO projects (id, name, repos, deadline, created_at) VALUES (?, ?, ?, ?, ?)", id, p.name, toJson(p.repos), p.deadline, nowIso());
    for (const m of p.members) await insertMember(id, m);
  });
  return (await getProject(id))!;
}

/** Plan-level fields that live on the projects row. */
export interface ProjectPlanState {
  planActive: boolean;
  planVersion: number;
  gracePeriodHours: number | null;
  graceApprovedBy: string[];
  pendingPlan: PlanDraft | null;
  demoNow: string | null;
  specText: string | null;
}

export async function getProjectPlanState(projectId: string): Promise<ProjectPlanState | undefined> {
  const r = await dbGet("SELECT * FROM projects WHERE id = ?", projectId);
  if (!r) return undefined;
  return {
    planActive: bool(r.plan_active),
    planVersion: num(r.plan_version),
    gracePeriodHours: numOrNull(r.grace_period_hours),
    graceApprovedBy: fromJson<string[]>(r.grace_approved_by, []),
    pendingPlan: fromJson<PlanDraft | null>(r.pending_plan, null),
    demoNow: (r.demo_now as string | null) ?? null,
    specText: (r.spec_text as string | null) ?? null,
  };
}

const PLAN_COLUMNS: Record<keyof ProjectPlanState, [string, (v: never) => unknown]> = {
  planActive: ["plan_active", (v: boolean) => int(v)],
  planVersion: ["plan_version", (v: number) => v],
  gracePeriodHours: ["grace_period_hours", (v: number | null) => v],
  graceApprovedBy: ["grace_approved_by", (v: string[]) => toJson(v)],
  pendingPlan: ["pending_plan", (v: PlanDraft | null) => (v ? toJson(v) : null)],
  demoNow: ["demo_now", (v: string | null) => v],
  specText: ["spec_text", (v: string | null) => v],
};

export async function updateProjectPlanState(projectId: string, patch: Partial<ProjectPlanState>): Promise<void> {
  const keys = Object.keys(patch) as (keyof ProjectPlanState)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${PLAN_COLUMNS[k][0]} = ?`).join(", ");
  const values = keys.map((k) => (PLAN_COLUMNS[k][1] as (v: unknown) => unknown)(patch[k]));
  await dbRun(`UPDATE projects SET ${sets} WHERE id = ?`, ...values, projectId);
}

// ---------- tasks ----------

function rowToTask(r: Row): Task {
  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string | null) ?? "",
    points: num(r.points),
    ownerId: r.owner_id as string,
    paths: fromJson<string[]>(r.paths, []),
    tracked: bool(r.tracked),
    dependsOn: fromJson<string[]>(r.depends_on, []),
    completion: num(r.completion),
    approvedBy: fromJson<string[]>(r.approved_by, []),
  };
}

export async function getTasks(projectId: string): Promise<Task[]> {
  return (await dbAll("SELECT * FROM tasks WHERE project_id = ? ORDER BY seq", projectId)).map(rowToTask);
}

export async function getTask(taskId: string): Promise<Task | undefined> {
  const r = await dbGet("SELECT * FROM tasks WHERE id = ?", taskId);
  return r && rowToTask(r);
}

export async function upsertTask(projectId: string, t: Task): Promise<void> {
  await dbRun(
    `INSERT INTO tasks (id, project_id, title, description, points, owner_id, paths, tracked, depends_on, completion, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, points = EXCLUDED.points,
       owner_id = EXCLUDED.owner_id, paths = EXCLUDED.paths, tracked = EXCLUDED.tracked, depends_on = EXCLUDED.depends_on,
       completion = EXCLUDED.completion, approved_by = EXCLUDED.approved_by`,
    t.id, projectId, t.title, t.description, t.points, t.ownerId, toJson(t.paths), int(t.tracked), toJson(t.dependsOn), t.completion, toJson(t.approvedBy),
  );
}

export async function deleteTask(taskId: string): Promise<void> {
  await dbRun("DELETE FROM tasks WHERE id = ?", taskId);
}

// ---------- checkpoints ----------

function rowToCheckpoint(r: Row): Checkpoint {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    ownerId: (r.owner_id as string | null) ?? null,
    dueAt: r.due_at as string,
    targetCompletion: num(r.target_completion),
    criteria: r.criteria as string,
    status: ((r.status as CheckpointStatus | null) ?? "pending"),
    approvedBy: fromJson<string[]>(r.approved_by, []),
    missedAt: opt(r.missed_at as string | null),
    graceEndsAt: opt(r.grace_ends_at as string | null),
  };
}

export async function getCheckpoints(projectId: string): Promise<Checkpoint[]> {
  return (await dbAll("SELECT * FROM checkpoints WHERE project_id = ? ORDER BY due_at, seq", projectId)).map(rowToCheckpoint);
}

export async function getCheckpoint(checkpointId: string): Promise<Checkpoint | undefined> {
  const r = await dbGet("SELECT * FROM checkpoints WHERE id = ?", checkpointId);
  return r && rowToCheckpoint(r);
}

export async function upsertCheckpoint(projectId: string, c: Checkpoint): Promise<void> {
  await dbRun(
    `INSERT INTO checkpoints (id, project_id, task_id, owner_id, due_at, target_completion, criteria, status, approved_by, missed_at, grace_ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET task_id = EXCLUDED.task_id, owner_id = EXCLUDED.owner_id, due_at = EXCLUDED.due_at,
       target_completion = EXCLUDED.target_completion, criteria = EXCLUDED.criteria, status = EXCLUDED.status,
       approved_by = EXCLUDED.approved_by, missed_at = EXCLUDED.missed_at, grace_ends_at = EXCLUDED.grace_ends_at`,
    c.id, projectId, c.taskId, c.ownerId, c.dueAt, c.targetCompletion, c.criteria, c.status, toJson(c.approvedBy), c.missedAt ?? null, c.graceEndsAt ?? null,
  );
}

export async function deleteCheckpoint(checkpointId: string): Promise<void> {
  await dbRun("DELETE FROM checkpoints WHERE id = ?", checkpointId);
}

// ---------- raw commits ----------

export interface RawCommit {
  sha: string;
  repo: string;
  authorLogin: string;
  coAuthors: string[];
  message: string;
  committedAt: string;
  files: string[];
  diff: string;
}

function rowToRawCommit(r: Row): RawCommit {
  return {
    sha: r.sha as string,
    repo: r.repo as string,
    authorLogin: r.author_login as string,
    coAuthors: fromJson<string[]>(r.co_authors, []),
    message: (r.message as string | null) ?? "",
    committedAt: r.committed_at as string,
    files: fromJson<string[]>(r.files, []),
    diff: (r.diff as string | null) ?? "",
  };
}

/** Ignores commits that are already stored. Returns true if it was new. */
export async function insertRawCommit(projectId: string, c: RawCommit): Promise<boolean> {
  const changed = await dbRun(
    `INSERT INTO raw_commits (sha, project_id, repo, author_login, co_authors, message, committed_at, files, diff, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sha) DO NOTHING`,
    c.sha, projectId, c.repo, c.authorLogin, toJson(c.coAuthors), c.message, c.committedAt, toJson(c.files), c.diff, nowIso(),
  );
  return changed > 0;
}

export async function getRawCommit(sha: string): Promise<RawCommit | undefined> {
  const r = await dbGet("SELECT * FROM raw_commits WHERE sha = ?", sha);
  return r && rowToRawCommit(r);
}

/** Commits stored for the project that have no judgment yet. */
export async function getUnjudgedCommits(projectId: string): Promise<RawCommit[]> {
  return (
    await dbAll(
      `SELECT rc.* FROM raw_commits rc LEFT JOIN judgments j ON j.sha = rc.sha
       WHERE rc.project_id = ? AND j.sha IS NULL ORDER BY rc.committed_at`,
      projectId,
    )
  ).map(rowToRawCommit);
}

// ---------- judgments ----------

function rowToJudgment(r: Row): Judgment {
  return {
    sha: r.sha as string,
    repo: (r.repo as string | null) ?? "",
    authorIds: fromJson<string[]>(r.author_ids, []),
    unmatchedLogin: opt(r.unmatched_login as string | null),
    taskId: (r.task_id as string | null) ?? null,
    kind: r.kind as Judgment["kind"],
    completionDelta: num(r.completion_delta),
    confidence: num(r.confidence),
    model: r.model as Judgment["model"],
    reason: (r.reason as string | null) ?? "",
  };
}

// judgments has no repo column; it is joined from raw_commits.
const JUDGMENT_SELECT = "SELECT j.*, rc.repo AS repo FROM judgments j LEFT JOIN raw_commits rc ON rc.sha = j.sha";

export async function getJudgments(projectId: string): Promise<Judgment[]> {
  return (await dbAll(`${JUDGMENT_SELECT} WHERE j.project_id = ? ORDER BY rc.committed_at NULLS LAST, j.sha`, projectId)).map(rowToJudgment);
}

export async function getJudgment(sha: string): Promise<Judgment | undefined> {
  const r = await dbGet(`${JUDGMENT_SELECT} WHERE j.sha = ?`, sha);
  return r && rowToJudgment(r);
}

export async function getJudgmentCheckinId(sha: string): Promise<string | undefined> {
  const r = await dbGet("SELECT checkin_id FROM judgments WHERE sha = ?", sha);
  return opt(r?.checkin_id as string | null);
}

export async function upsertJudgment(projectId: string, j: Judgment, checkinId: string | null): Promise<void> {
  await dbRun(
    `INSERT INTO judgments (sha, project_id, author_ids, unmatched_login, task_id, kind, completion_delta, confidence, model, reason, checkin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (sha) DO UPDATE SET author_ids = EXCLUDED.author_ids, unmatched_login = EXCLUDED.unmatched_login,
       task_id = EXCLUDED.task_id, kind = EXCLUDED.kind, completion_delta = EXCLUDED.completion_delta,
       confidence = EXCLUDED.confidence, model = EXCLUDED.model, reason = EXCLUDED.reason`,
    j.sha, projectId, toJson(j.authorIds), j.unmatchedLogin ?? null, j.taskId, j.kind, j.completionDelta, j.confidence, j.model, j.reason, checkinId,
  );
}

// ---------- disputes ----------

function rowToDispute(r: Row): Dispute {
  const target: Dispute["target"] =
    r.target_kind === "judgment" ? { kind: "judgment", sha: r.target_id as string } : { kind: "checkpoint", checkpointId: r.target_id as string };
  return {
    id: r.id as string,
    target,
    memberId: r.member_id as string,
    note: r.note as string,
    filePaths: fromJson<string[]>(r.file_paths, []),
    status: r.status as Dispute["status"],
    before: opt(r.before as string | null),
    after: opt(r.after as string | null),
    reason: opt(r.reason as string | null),
    createdAt: r.created_at as string,
    resolvedAt: opt(r.resolved_at as string | null),
  };
}

/** `checkpointId` = the checkpoint whose alerts pause while the dispute is open (README §9). */
export async function insertDispute(
  projectId: string,
  d: Pick<Dispute, "target" | "memberId" | "note" | "filePaths">,
  checkpointId: string | null,
): Promise<Dispute> {
  const id = newId();
  const targetId = d.target.kind === "judgment" ? d.target.sha : d.target.checkpointId;
  await dbRun(
    `INSERT INTO disputes (id, project_id, target_kind, target_id, checkpoint_id, member_id, note, file_paths, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    id, projectId, d.target.kind, targetId, checkpointId, d.memberId, d.note, toJson(d.filePaths), nowIso(),
  );
  return (await getDispute(id))!;
}

export async function resolveDispute(disputeId: string, result: { before: string; after: string; reason: string }): Promise<Dispute> {
  await dbRun("UPDATE disputes SET status = 'resolved', before = ?, after = ?, reason = ?, resolved_at = ? WHERE id = ?",
    result.before, result.after, result.reason, nowIso(), disputeId);
  return (await getDispute(disputeId))!;
}

export async function getDispute(disputeId: string): Promise<Dispute | undefined> {
  const r = await dbGet("SELECT * FROM disputes WHERE id = ?", disputeId);
  return r && rowToDispute(r);
}

export async function getDisputes(projectId: string): Promise<Dispute[]> {
  return (await dbAll("SELECT * FROM disputes WHERE project_id = ? ORDER BY created_at", projectId)).map(rowToDispute);
}

/** Checkpoint ids that currently have an open dispute (their alerts and reminders pause). */
export async function getOpenDisputeCheckpointIds(projectId: string): Promise<Set<string>> {
  const rows = await dbAll(
    "SELECT DISTINCT checkpoint_id FROM disputes WHERE project_id = ? AND status = 'open' AND checkpoint_id IS NOT NULL",
    projectId,
  );
  return new Set(rows.map((r) => r.checkpoint_id as string));
}

// ---------- check-ins ----------

/** "dispute" runs only hold a dispute re-judge's trace; they never count as a check-in for "since" or grace pauses. */
export type CheckinKind = "daily" | "extra" | "manual" | "simulate" | "dispute";

export interface Checkin {
  id: string;
  projectId: string;
  kind: CheckinKind;
  skipped: boolean;
  startedAt: string;
  finishedAt?: string;
}

function rowToCheckin(r: Row): Checkin {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    kind: r.kind as CheckinKind,
    skipped: bool(r.skipped),
    startedAt: r.started_at as string,
    finishedAt: opt(r.finished_at as string | null),
  };
}

export async function insertCheckin(projectId: string, kind: CheckinKind, startedAt: string = nowIso()): Promise<Checkin> {
  const id = newId();
  await dbRun("INSERT INTO checkins (id, project_id, kind, started_at, real_started_at) VALUES (?, ?, ?, ?, ?)", id, projectId, kind, startedAt, nowIso());
  return (await getCheckin(id))!;
}

export async function finishCheckin(checkinId: string, opts: { skipped?: boolean; finishedAt?: string } = {}): Promise<void> {
  await dbRun("UPDATE checkins SET finished_at = ?, skipped = ? WHERE id = ?", opts.finishedAt ?? nowIso(), int(opts.skipped ?? false), checkinId);
}

export async function getCheckin(checkinId: string): Promise<Checkin | undefined> {
  const r = await dbGet("SELECT * FROM checkins WHERE id = ?", checkinId);
  return r && rowToCheckin(r);
}

export async function getCheckins(projectId: string): Promise<Checkin[]> {
  return (await dbAll("SELECT * FROM checkins WHERE project_id = ? ORDER BY started_at, real_started_at", projectId)).map(rowToCheckin);
}

/** The most recent finished, non-skipped check-in (used as "since" for observe). */
export async function getLastCompletedCheckin(projectId: string): Promise<Checkin | undefined> {
  const r = await dbGet(
    `SELECT * FROM checkins WHERE project_id = ? AND finished_at IS NOT NULL AND skipped = 0 AND kind != 'dispute'
     ORDER BY started_at DESC LIMIT 1`,
    projectId,
  );
  return r && rowToCheckin(r);
}

/**
 * An unfinished check-in that started (in real time) within `withinMs`: the "already running" guard.
 * Works across serverless instances; a check-in whose function died stops blocking after `withinMs`.
 */
export async function getRunningCheckin(projectId: string, withinMs: number): Promise<Checkin | undefined> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const r = await dbGet(
    "SELECT * FROM checkins WHERE project_id = ? AND finished_at IS NULL AND kind != 'dispute' AND real_started_at > ? LIMIT 1",
    projectId, since,
  );
  return r && rowToCheckin(r);
}

// ---------- trace steps ----------

function rowToTraceStep(r: Row): TraceStep {
  return {
    checkinId: r.checkin_id as string,
    order: num(r.ord),
    step: r.step as TraceStep["step"],
    summary: r.summary as string,
    details: fromJson<unknown>(r.details, undefined),
    at: r.at as string,
  };
}

export async function insertTraceStep(s: TraceStep): Promise<void> {
  await dbRun("INSERT INTO trace_steps (checkin_id, ord, step, summary, details, at) VALUES (?, ?, ?, ?, ?, ?)",
    s.checkinId, s.order, s.step, s.summary, s.details === undefined ? null : toJson(s.details), s.at);
}

export async function getTraceSteps(checkinId: string): Promise<TraceStep[]> {
  return (await dbAll("SELECT * FROM trace_steps WHERE checkin_id = ? ORDER BY ord", checkinId)).map(rowToTraceStep);
}

// ---------- decisions ----------

function rowToDecision(r: Row): Decision {
  return {
    memberId: (r.member_id as string | null) ?? null,
    checkpointId: (r.checkpoint_id as string | null) ?? null,
    action: r.action as Decision["action"],
    reason: r.reason as string,
    message: opt(r.message as string | null),
    sentAt: opt(r.sent_at as string | null),
  };
}

export async function insertDecision(checkinId: string, d: Decision): Promise<string> {
  const id = newId();
  await dbRun(
    "INSERT INTO decisions (id, checkin_id, member_id, checkpoint_id, action, reason, message, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id, checkinId, d.memberId, d.checkpointId, d.action, d.reason, d.message ?? null, d.sentAt ?? null,
  );
  return id;
}

/** Sent = delivered to the in-app Inbox (always) and, when `discordSent`, also on Discord. */
export async function markDecisionSent(decisionId: string, message: string, sentAt: string = nowIso(), discordSent = true): Promise<void> {
  await dbRun("UPDATE decisions SET message = ?, sent_at = ?, discord_sent = ? WHERE id = ?", message, sentAt, int(discordSent), decisionId);
}

export async function setDecisionMessage(decisionId: string, message: string): Promise<void> {
  await dbRun("UPDATE decisions SET message = ? WHERE id = ?", message, decisionId);
}

export async function getDecisions(checkinId: string): Promise<Decision[]> {
  return (await dbAll("SELECT * FROM decisions WHERE checkin_id = ? ORDER BY seq", checkinId)).map(rowToDecision);
}

/** Every sent decision for a project, oldest first (for cooldown checks). */
export async function getSentDecisions(projectId: string): Promise<Decision[]> {
  return (
    await dbAll(
      `SELECT d.* FROM decisions d JOIN checkins c ON c.id = d.checkin_id
       WHERE c.project_id = ? AND d.sent_at IS NOT NULL ORDER BY d.sent_at`,
      projectId,
    )
  ).map(rowToDecision);
}
