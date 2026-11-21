// Source of truth for data shapes (README section 8). Changes need a heads-up to the team.

export interface MemberInput {
  name: string;
  githubUsername: string;
  email?: string;
}

export type MemberStatus = "none" | "on_it" | "blocked" | "need_help";

export interface Member {
  id: string;
  name: string;
  githubUsername: string;
  githubAliases: string[];    // extra logins assigned from "unmatched"
  discordId?: string;         // set by /link; undefined = not opted in yet
  email?: string;
  status: MemberStatus;       // latest button press
  blockedById?: string;       // Member.id, when status = "blocked"
  statusAt?: string;          // ISO; "on_it" expires after NUDGE_COOLDOWN_DAYS
}

export interface Project {
  id: string;
  name: string;
  repos: string[];            // "owner/repo"
  members: Member[];
  deadline: string;           // ISO date
  createdAt: string;
  lockedAt?: string;          // first lock; start of the "behind the clock" timeline
  taskMapLocked: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  points: number;             // effort weight: 1, 2, 3, 5, 8, 13
  ownerId: string;            // Member.id
  paths: string[];            // e.g. ["backend/payments/**"]; empty when untracked
  tracked: boolean;           // false = non-code task, never nudged
  completion: number;         // 0–1
}

export interface TaskMap {
  projectId: string;
  version: number;            // bumps on every lock / applied change
  locked: boolean;
  tasks: Task[];              // the current agreed (or draft, if never locked) map
  pending: Task[] | null;     // proposed change to a locked map (Should)
  agreedBy: string[];         // Member.ids agreeing to the draft / pending change
}

export interface Judgment {
  sha: string;
  repo: string;
  authorIds: string[];        // author + Co-authored-by, credit split evenly
  unmatchedLogin?: string;    // set when the author matches no member
  taskId: string | null;
  kind: "substantial" | "light" | "filtered";
  completionDelta: number;    // 0–1 of the task
  confidence: number;         // 0–1
  model: "none" | "small" | "big";
  reason: string;             // one line, shown as evidence
  dispute?: { memberId: string; note: string; previousDelta: number }; // Should
}

export type Action =
  | "none"                    // on track, or in cooldown
  | "wait"                    // pressed "On it", or blocked (nudges paused)
  | "nudge"                   // DM to the member
  | "nudge_blocker"           // DM to whoever is blocking a teammate
  | "group_post";             // after 2 ignored DMs, or "Need help"

export interface Decision {
  memberId: string;
  taskId: string | null;
  action: Action;
  reason: string;             // one line, e.g. "30 pts behind the clock on Dashboard UI"
  ignoredCount: number;       // ignored DMs so far for this task (drives tone + ladder)
  message?: string;
  sentAt?: string;
}

export interface TraceStep {
  checkinId: string;
  order: number;
  step: "observe" | "filter" | "judge" | "escalate" | "decide" | "act";
  summary: string;            // e.g. "Filtered 9 of 14 commits (no AI)"
  details?: unknown;
  at: string;
}

export interface MemberScore {
  memberId: string;
  commits: number;
  points: number;
  share: number;              // 0–1
  evidence: { taskId: string; points: number; shas: string[] }[];
}

export interface Dashboard {
  project: Project;
  scores: MemberScore[];
  tasks: Task[];
  timeline: { date: string; memberId: string; points: number }[];
  unmatched: { login: string; commits: number }[];
}

export interface ComputeMeter {
  ours:  { tokens: number; usd: number; wh: number; aiCalls: number };
  naive: { tokens: number; usd: number; wh: number; aiCalls: number };
  filteredWithoutAi: number;
}

export interface Report { markdown: string; generatedAt: string; }
