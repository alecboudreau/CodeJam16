// Source of truth for data shapes (README section 8). Changes need a heads-up to the team.

export interface MemberInput {
  name: string;
  githubUsername: string;
  email?: string;
  capacityHoursPerWeek?: number;
}

export type MemberStatus = "none" | "on_it" | "blocked" | "need_help";

export interface Member {
  id: string;
  name: string;
  githubUsername: string;
  githubAliases: string[];      // extra logins assigned from "unmatched"
  discordId?: string;           // set by /link; undefined = not opted in yet
  email?: string;
  capacityHoursPerWeek?: number;
  status: MemberStatus;         // latest button press
  blockedById?: string;         // Member.id, when status = "blocked"
  statusAt?: string;            // ISO; "on_it" expires after NUDGE_COOLDOWN_DAYS
}

export interface Project {
  id: string;
  name: string;
  repos: string[];              // "owner/repo"
  members: Member[];
  deadline: string;             // ISO date
  createdAt: string;
  planActive: boolean;
  gracePeriodHours: number;     // team-approved; default = model's recommendation
}

export interface Task {
  id: string;
  title: string;
  description: string;
  points: number;               // effort weight: 1, 2, 3, 5, 8, 13 (sizes tasks + checkpoints)
  ownerId: string;              // Member.id
  paths: string[];              // e.g. ["backend/payments/**"]; empty when untracked
  tracked: boolean;             // false = non-code task, no checkpoints, never nudged
  dependsOn: string[];          // Task.ids
  completion: number;           // 0–1
  approvedBy: string[];         // [ownerId] once the owner approves
}

export type CheckpointStatus = "pending" | "met" | "missed" | "alerted";

export interface Checkpoint {
  id: string;
  taskId: string;
  ownerId: string | null;       // null = shared (approved by everyone)
  dueAt: string;                // ISO
  targetCompletion: number;     // 0–1 of the task
  criteria: string;             // one line, e.g. "Login form submits and validates"
  status: CheckpointStatus;
  approvedBy: string[];
  missedAt?: string;            // when the check-in found it missed
  graceEndsAt?: string;         // missedAt + grace, pushed back while the owner is blocked
}

export type PlanItemRef =
  | { kind: "task"; id: string }
  | { kind: "checkpoint"; id: string }
  | { kind: "grace" };

export interface PlanDraft {
  tasks: Task[];
  checkpoints: Checkpoint[];
  gracePeriodHours: number;
  graceApprovedBy: string[];
}

export interface TaskMap extends PlanDraft {
  projectId: string;
  version: number;              // bumps every time the plan becomes active / a change applies
  active: boolean;
  pending: PlanDraft | null;    // proposed change to an active plan (Should)
  waitingOn: { item: PlanItemRef; memberIds: string[] }[]; // drives the AgreeBar
}

export interface Judgment {
  sha: string;
  repo: string;
  authorIds: string[];          // author + Co-authored-by
  unmatchedLogin?: string;      // set when the author matches no member
  taskId: string | null;
  kind: "substantial" | "light" | "filtered";
  completionDelta: number;      // 0–1 of the task
  confidence: number;           // 0–1
  model: "none" | "small" | "big";
  reason: string;               // one line, shown as evidence (owner only)
}

export type DisputeTarget =
  | { kind: "judgment"; sha: string }
  | { kind: "checkpoint"; checkpointId: string };

export interface Dispute {
  id: string;
  target: DisputeTarget;
  memberId: string;
  note: string;
  filePaths: string[];
  status: "open" | "resolved";
  before?: string;              // e.g. "light, 2%" / "missed, 20%"
  after?: string;               // e.g. "substantial, 12%" / "met, 45%"
  reason?: string;              // big model's one-line answer
  createdAt: string;
  resolvedAt?: string;
}

export type Action =
  | "none"                      // on track, or in cooldown
  | "wait"                      // "On it", blocked, or dispute open
  | "nudge"                     // private DM to the checkpoint's owner
  | "nudge_blocker"             // private DM to whoever is blocking a teammate
  | "help_post"                 // group post after "Need help"
  | "team_alert";               // group post: still unmet after the grace period

export interface Decision {
  memberId: string | null;      // null for team alerts
  checkpointId: string | null;
  action: Action;
  reason: string;               // one line, e.g. "'Payment list' missed, 30h of grace left"
  message?: string;
  sentAt?: string;
}

export interface TraceStep {
  checkinId: string;
  order: number;
  step: "observe" | "filter" | "judge" | "escalate" | "decide" | "act" | "skip";
  summary: string;              // e.g. "Filtered 9 of 14 commits (no AI)"
  details?: unknown;
  at: string;
}

export interface TaskProgress {
  task: Task;
  checkpoints: Checkpoint[];
}

export interface Dashboard {
  project: Project;
  viewerId: string;
  overallProgress: number;      // Σ(points × completion) ÷ Σ points, tracked tasks only
  tasks: TaskProgress[];        // everyone's status + progress, no evidence
  myEvidence: { taskId: string; commits: number; judgments: Judgment[] }[]; // viewer's tasks only
  myDisputes: Dispute[];
  timeline: { date: string; overallProgress: number }[];
  unmatched: { login: string; commits: number }[];
}

export interface ComputeMeter {
  ours:  { tokens: number; usd: number; wh: number; aiCalls: number };
  naive: { tokens: number; usd: number; wh: number; aiCalls: number };
  filteredWithoutAi: number;
  skippedCheckins: number;      // zero-cost runs avoided
  disputeRejudges: number;      // included in `ours`
}

export interface Report { markdown: string; generatedAt: string; }
