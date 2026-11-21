// better-sqlite3 helpers (owner: Person A). Row <-> shared-type mappers for every table (README §8, §9).
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

export function initDb(): void {
  const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  db.exec(readFileSync(schemaPath, "utf8"));
}

// ---------- small utilities ----------

export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();

const cache = new Map<string, Database.Statement>();
/** Prepared statements are created on first use, so importing this file never needs the tables to exist. */
function q(sql: string): Database.Statement {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

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
const bool = (v: unknown): boolean => v === 1 || v === true;
const int = (v: boolean): number => (v ? 1 : 0);

type Row = Record<string, unknown>;

/** Runs fn inside one SQLite transaction. */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

// ---------- members ----------

function rowToMember(r: Row): Member {
  return {
    id: r.id as string,
    name: r.name as string,
    githubUsername: r.github_username as string,
    githubAliases: fromJson<string[]>(r.github_aliases, []),
    discordId: opt(r.discord_id as string | null),
    email: opt(r.email as string | null),
    capacityHoursPerWeek: opt(r.capacity_hours_per_week as number | null),
    status: ((r.status as MemberStatus | null) ?? "none"),
    blockedById: opt(r.blocked_by_id as string | null),
    statusAt: opt(r.status_at as string | null),
  };
}

export function getMembers(projectId: string): Member[] {
  return (q("SELECT * FROM members WHERE project_id = ? ORDER BY rowid").all(projectId) as Row[]).map(rowToMember);
}

export function getMember(memberId: string): Member | undefined {
  const r = q("SELECT * FROM members WHERE id = ?").get(memberId) as Row | undefined;
  return r && rowToMember(r);
}

export function getMemberProjectId(memberId: string): string | undefined {
  const r = q("SELECT project_id FROM members WHERE id = ?").get(memberId) as Row | undefined;
  return r?.project_id as string | undefined;
}

export function insertMember(projectId: string, input: MemberInput): Member {
  const id = newId();
  q(`INSERT INTO members (id, project_id, name, github_username, email, capacity_hours_per_week)
     VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, projectId, input.name, input.githubUsername, input.email ?? null, input.capacityHoursPerWeek ?? null,
  );
  return getMember(id)!;
}

export function addGithubAlias(memberId: string, login: string): Member | undefined {
  const m = getMember(memberId);
  if (!m) return undefined;
  const aliases = m.githubAliases.some((a) => a.toLowerCase() === login.toLowerCase())
    ? m.githubAliases
    : [...m.githubAliases, login];
  q("UPDATE members SET github_aliases = ? WHERE id = ?").run(toJson(aliases), memberId);
  return getMember(memberId);
}

/**
 * For Person C's `/link <github-username>`: connects a Discord account to every member
 * with that GitHub username (case-insensitive). Returns how many members were linked.
 */
export function linkDiscord(githubUsername: string, discordId: string): number {
  return q("UPDATE members SET discord_id = ? WHERE lower(github_username) = lower(?)").run(discordId, githubUsername)
    .changes;
}

/** For Person C's DM buttons. `blockedById` is only kept when status = "blocked". */
export function setMemberStatus(memberId: string, status: MemberStatus, blockedById?: string): void {
  q("UPDATE members SET status = ?, blocked_by_id = ?, status_at = ? WHERE id = ?").run(
    status, status === "blocked" ? blockedById ?? null : null, nowIso(), memberId,
  );
}

export function getMemberByDiscordId(discordId: string): Member | undefined {
  const r = q("SELECT * FROM members WHERE discord_id = ? ORDER BY rowid DESC").get(discordId) as Row | undefined;
  return r && rowToMember(r);
}

// ---------- projects ----------

function rowToProject(r: Row): Project {
  return {
    id: r.id as string,
    name: r.name as string,
    repos: fromJson<string[]>(r.repos, []),
    members: getMembers(r.id as string),
    deadline: r.deadline as string,
    createdAt: r.created_at as string,
    planActive: bool(r.plan_active),
    gracePeriodHours: (r.grace_period_hours as number | null) ?? rules.DEFAULT_GRACE_PERIOD_HOURS,
  };
}

export function getProject(projectId: string): Project | undefined {
  const r = q("SELECT * FROM projects WHERE id = ?").get(projectId) as Row | undefined;
  return r && rowToProject(r);
}

export function listActiveProjectIds(): string[] {
  return (q("SELECT id FROM projects WHERE plan_active = 1").all() as Row[]).map((r) => r.id as string);
}

export function insertProject(p: { name: string; repos: string[]; deadline: string; members: MemberInput[] }): Project {
  const id = newId();
  tx(() => {
    q("INSERT INTO projects (id, name, repos, deadline, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id, p.name, toJson(p.repos), p.deadline, nowIso(),
    );
    for (const m of p.members) insertMember(id, m);
  });
  return getProject(id)!;
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

export function getProjectPlanState(projectId: string): ProjectPlanState | undefined {
  const r = q("SELECT * FROM projects WHERE id = ?").get(projectId) as Row | undefined;
  if (!r) return undefined;
  return {
    planActive: bool(r.plan_active),
    planVersion: (r.plan_version as number | null) ?? 0,
    gracePeriodHours: r.grace_period_hours as number | null,
    graceApprovedBy: fromJson<string[]>(r.grace_approved_by, []),
    pendingPlan: fromJson<PlanDraft | null>(r.pending_plan, null),
    demoNow: r.demo_now as string | null,
    specText: r.spec_text as string | null,
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

export function updateProjectPlanState(projectId: string, patch: Partial<ProjectPlanState>): void {
  const keys = Object.keys(patch) as (keyof ProjectPlanState)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${PLAN_COLUMNS[k][0]} = ?`).join(", ");
  const values = keys.map((k) => (PLAN_COLUMNS[k][1] as (v: unknown) => unknown)(patch[k]));
  db.prepare(`UPDATE projects SET ${sets} WHERE id = ?`).run(...values, projectId);
}

// ---------- tasks ----------

function rowToTask(r: Row): Task {
  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string | null) ?? "",
    points: r.points as number,
    ownerId: r.owner_id as string,
    paths: fromJson<string[]>(r.paths, []),
    tracked: bool(r.tracked),
    dependsOn: fromJson<string[]>(r.depends_on, []),
    completion: (r.completion as number | null) ?? 0,
    approvedBy: fromJson<string[]>(r.approved_by, []),
  };
}

export function getTasks(projectId: string): Task[] {
  return (q("SELECT * FROM tasks WHERE project_id = ? ORDER BY rowid").all(projectId) as Row[]).map(rowToTask);
}

export function getTask(taskId: string): Task | undefined {
  const r = q("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
  return r && rowToTask(r);
}

export function upsertTask(projectId: string, t: Task): void {
  q(`INSERT INTO tasks (id, project_id, title, description, points, owner_id, paths, tracked, depends_on, completion, approved_by)
     VALUES (@id, @projectId, @title, @description, @points, @ownerId, @paths, @tracked, @dependsOn, @completion, @approvedBy)
     ON CONFLICT(id) DO UPDATE SET title = @title, description = @description, points = @points, owner_id = @ownerId,
       paths = @paths, tracked = @tracked, depends_on = @dependsOn, completion = @completion, approved_by = @approvedBy`).run({
    ...t,
    projectId,
    paths: toJson(t.paths),
    tracked: int(t.tracked),
    dependsOn: toJson(t.dependsOn),
    approvedBy: toJson(t.approvedBy),
  });
}

export function deleteTask(taskId: string): void {
  q("DELETE FROM tasks WHERE id = ?").run(taskId);
}

// ---------- checkpoints ----------

function rowToCheckpoint(r: Row): Checkpoint {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    ownerId: (r.owner_id as string | null) ?? null,
    dueAt: r.due_at as string,
    targetCompletion: r.target_completion as number,
    criteria: r.criteria as string,
    status: ((r.status as CheckpointStatus | null) ?? "pending"),
    approvedBy: fromJson<string[]>(r.approved_by, []),
    missedAt: opt(r.missed_at as string | null),
    graceEndsAt: opt(r.grace_ends_at as string | null),
  };
}

export function getCheckpoints(projectId: string): Checkpoint[] {
  return (q("SELECT * FROM checkpoints WHERE project_id = ? ORDER BY due_at, rowid").all(projectId) as Row[]).map(
    rowToCheckpoint,
  );
}

export function getCheckpoint(checkpointId: string): Checkpoint | undefined {
  const r = q("SELECT * FROM checkpoints WHERE id = ?").get(checkpointId) as Row | undefined;
  return r && rowToCheckpoint(r);
}

export function upsertCheckpoint(projectId: string, c: Checkpoint): void {
  q(`INSERT INTO checkpoints (id, project_id, task_id, owner_id, due_at, target_completion, criteria, status, approved_by, missed_at, grace_ends_at)
     VALUES (@id, @projectId, @taskId, @ownerId, @dueAt, @targetCompletion, @criteria, @status, @approvedBy, @missedAt, @graceEndsAt)
     ON CONFLICT(id) DO UPDATE SET task_id = @taskId, owner_id = @ownerId, due_at = @dueAt,
       target_completion = @targetCompletion, criteria = @criteria, status = @status, approved_by = @approvedBy,
       missed_at = @missedAt, grace_ends_at = @graceEndsAt`).run({
    ...c,
    projectId,
    approvedBy: toJson(c.approvedBy),
    missedAt: c.missedAt ?? null,
    graceEndsAt: c.graceEndsAt ?? null,
  });
}

export function deleteCheckpoint(checkpointId: string): void {
  q("DELETE FROM checkpoints WHERE id = ?").run(checkpointId);
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
export function insertRawCommit(projectId: string, c: RawCommit): boolean {
  return (
    q(`INSERT OR IGNORE INTO raw_commits (sha, project_id, repo, author_login, co_authors, message, committed_at, files, diff, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      c.sha, projectId, c.repo, c.authorLogin, toJson(c.coAuthors), c.message, c.committedAt, toJson(c.files), c.diff, nowIso(),
    ).changes > 0
  );
}

export function getRawCommit(sha: string): RawCommit | undefined {
  const r = q("SELECT * FROM raw_commits WHERE sha = ?").get(sha) as Row | undefined;
  return r && rowToRawCommit(r);
}

/** Commits stored for the project that have no judgment yet. */
export function getUnjudgedCommits(projectId: string): RawCommit[] {
  return (
    q(`SELECT rc.* FROM raw_commits rc LEFT JOIN judgments j ON j.sha = rc.sha
       WHERE rc.project_id = ? AND j.sha IS NULL ORDER BY rc.committed_at`).all(projectId) as Row[]
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
    completionDelta: (r.completion_delta as number | null) ?? 0,
    confidence: (r.confidence as number | null) ?? 0,
    model: r.model as Judgment["model"],
    reason: (r.reason as string | null) ?? "",
  };
}

// judgments has no repo column; it is joined from raw_commits.
const JUDGMENT_SELECT = "SELECT j.*, rc.repo AS repo FROM judgments j LEFT JOIN raw_commits rc ON rc.sha = j.sha";

export function getJudgments(projectId: string): Judgment[] {
  return (q(`${JUDGMENT_SELECT} WHERE j.project_id = ? ORDER BY rc.committed_at`).all(projectId) as Row[]).map(
    rowToJudgment,
  );
}

export function getJudgment(sha: string): Judgment | undefined {
  const r = q(`${JUDGMENT_SELECT} WHERE j.sha = ?`).get(sha) as Row | undefined;
  return r && rowToJudgment(r);
}

export function getJudgmentCheckinId(sha: string): string | undefined {
  const r = q("SELECT checkin_id FROM judgments WHERE sha = ?").get(sha) as Row | undefined;
  return opt(r?.checkin_id as string | null);
}

export function upsertJudgment(projectId: string, j: Judgment, checkinId: string | null): void {
  q(`INSERT INTO judgments (sha, project_id, author_ids, unmatched_login, task_id, kind, completion_delta, confidence, model, reason, checkin_id)
     VALUES (@sha, @projectId, @authorIds, @unmatchedLogin, @taskId, @kind, @completionDelta, @confidence, @model, @reason, @checkinId)
     ON CONFLICT(sha) DO UPDATE SET author_ids = @authorIds, unmatched_login = @unmatchedLogin, task_id = @taskId,
       kind = @kind, completion_delta = @completionDelta, confidence = @confidence, model = @model, reason = @reason`).run({
    sha: j.sha,
    projectId,
    authorIds: toJson(j.authorIds),
    unmatchedLogin: j.unmatchedLogin ?? null,
    taskId: j.taskId,
    kind: j.kind,
    completionDelta: j.completionDelta,
    confidence: j.confidence,
    model: j.model,
    reason: j.reason,
    checkinId,
  });
}

// ---------- disputes ----------

function rowToDispute(r: Row): Dispute {
  const target: Dispute["target"] =
    r.target_kind === "judgment"
      ? { kind: "judgment", sha: r.target_id as string }
      : { kind: "checkpoint", checkpointId: r.target_id as string };
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
export function insertDispute(
  projectId: string,
  d: Pick<Dispute, "target" | "memberId" | "note" | "filePaths">,
  checkpointId: string | null,
): Dispute {
  const id = newId();
  const targetId = d.target.kind === "judgment" ? d.target.sha : d.target.checkpointId;
  q(`INSERT INTO disputes (id, project_id, target_kind, target_id, checkpoint_id, member_id, note, file_paths, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`).run(
    id, projectId, d.target.kind, targetId, checkpointId, d.memberId, d.note, toJson(d.filePaths), nowIso(),
  );
  return getDispute(id)!;
}

export function resolveDispute(disputeId: string, result: { before: string; after: string; reason: string }): Dispute {
  q("UPDATE disputes SET status = 'resolved', before = ?, after = ?, reason = ?, resolved_at = ? WHERE id = ?").run(
    result.before, result.after, result.reason, nowIso(), disputeId,
  );
  return getDispute(disputeId)!;
}

export function getDispute(disputeId: string): Dispute | undefined {
  const r = q("SELECT * FROM disputes WHERE id = ?").get(disputeId) as Row | undefined;
  return r && rowToDispute(r);
}

export function getDisputes(projectId: string): Dispute[] {
  return (q("SELECT * FROM disputes WHERE project_id = ? ORDER BY created_at").all(projectId) as Row[]).map(rowToDispute);
}

/** Checkpoint ids that currently have an open dispute (their alerts and reminders pause). */
export function getOpenDisputeCheckpointIds(projectId: string): Set<string> {
  const rows = q(
    "SELECT DISTINCT checkpoint_id FROM disputes WHERE project_id = ? AND status = 'open' AND checkpoint_id IS NOT NULL",
  ).all(projectId) as Row[];
  return new Set(rows.map((r) => r.checkpoint_id as string));
}

// ---------- check-ins ----------

export type CheckinKind = "daily" | "extra" | "manual" | "simulate";

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

export function insertCheckin(projectId: string, kind: CheckinKind, startedAt: string = nowIso()): Checkin {
  const id = newId();
  q("INSERT INTO checkins (id, project_id, kind, started_at) VALUES (?, ?, ?, ?)").run(id, projectId, kind, startedAt);
  return getCheckin(id)!;
}

export function finishCheckin(checkinId: string, opts: { skipped?: boolean; finishedAt?: string } = {}): void {
  q("UPDATE checkins SET finished_at = ?, skipped = ? WHERE id = ?").run(
    opts.finishedAt ?? nowIso(), int(opts.skipped ?? false), checkinId,
  );
}

export function getCheckin(checkinId: string): Checkin | undefined {
  const r = q("SELECT * FROM checkins WHERE id = ?").get(checkinId) as Row | undefined;
  return r && rowToCheckin(r);
}

export function getCheckins(projectId: string): Checkin[] {
  return (q("SELECT * FROM checkins WHERE project_id = ? ORDER BY started_at").all(projectId) as Row[]).map(rowToCheckin);
}

/** The most recent finished, non-skipped check-in (used as "since" for observe). */
export function getLastCompletedCheckin(projectId: string): Checkin | undefined {
  const r = q(
    `SELECT * FROM checkins WHERE project_id = ? AND finished_at IS NOT NULL AND skipped = 0
     ORDER BY started_at DESC LIMIT 1`,
  ).get(projectId) as Row | undefined;
  return r && rowToCheckin(r);
}

// ---------- trace steps ----------

function rowToTraceStep(r: Row): TraceStep {
  return {
    checkinId: r.checkin_id as string,
    order: r.ord as number,
    step: r.step as TraceStep["step"],
    summary: r.summary as string,
    details: fromJson<unknown>(r.details, undefined),
    at: r.at as string,
  };
}

export function insertTraceStep(s: TraceStep): void {
  q("INSERT INTO trace_steps (checkin_id, ord, step, summary, details, at) VALUES (?, ?, ?, ?, ?, ?)").run(
    s.checkinId, s.order, s.step, s.summary, s.details === undefined ? null : toJson(s.details), s.at,
  );
}

export function getTraceSteps(checkinId: string): TraceStep[] {
  return (q("SELECT * FROM trace_steps WHERE checkin_id = ? ORDER BY ord").all(checkinId) as Row[]).map(rowToTraceStep);
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

export function insertDecision(checkinId: string, d: Decision): string {
  const id = newId();
  q(`INSERT INTO decisions (id, checkin_id, member_id, checkpoint_id, action, reason, message, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, checkinId, d.memberId, d.checkpointId, d.action, d.reason, d.message ?? null, d.sentAt ?? null,
  );
  return id;
}

export function markDecisionSent(decisionId: string, message: string, sentAt: string = nowIso()): void {
  q("UPDATE decisions SET message = ?, sent_at = ? WHERE id = ?").run(message, sentAt, decisionId);
}

export function getDecisions(checkinId: string): Decision[] {
  return (q("SELECT * FROM decisions WHERE checkin_id = ? ORDER BY rowid").all(checkinId) as Row[]).map(rowToDecision);
}

/** Every sent decision for a project, oldest first (for cooldown checks). */
export function getSentDecisions(projectId: string): Decision[] {
  return (
    q(`SELECT d.* FROM decisions d JOIN checkins c ON c.id = d.checkin_id
       WHERE c.project_id = ? AND d.sent_at IS NOT NULL ORDER BY d.sent_at`).all(projectId) as Row[]
  ).map(rowToDecision);
}
