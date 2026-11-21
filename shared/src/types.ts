// Source of truth for data shapes (README section 6). Changes need a heads-up to the team.

export type Mode = "auto" | "approve_first";

export interface Member {
  id: string;
  name: string;
  githubUsername: string;
  discordId?: string;
  email?: string;
}

export interface Project {
  id: string;
  name: string;
  repos: string[];            // "owner/repo"
  members: Member[];
  deadline: string;           // ISO date
  checkinEveryDays: number;
  mode: Mode;
  taskMapLocked: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  points: number;             // effort weight, 1–13
  ownerId: string;            // Member.id
  paths: string[];            // e.g. ["backend/payments/**"]
  completion: number;         // 0–1
}

export interface TaskMap { projectId: string; tasks: Task[]; locked: boolean; }

export interface Judgment {
  sha: string;
  repo: string;
  authorId: string;
  taskId: string | null;
  kind: "substantial" | "light" | "filtered";
  completionDelta: number;    // 0–1 of the task
  confidence: number;         // 0–1
  model: "none" | "small" | "big";
  reason: string;             // one line, shown as evidence
}

export type Action = "none" | "nudge" | "escalate" | "suggest_reassign";

export interface Decision {
  memberId: string;
  action: Action;
  reason: string;
  message?: string;
  sent: boolean;              // false when mode = approve_first and not yet approved
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
}

export interface ComputeMeter {
  ours:  { tokens: number; usd: number; wh: number; aiCalls: number };
  naive: { tokens: number; usd: number; wh: number; aiCalls: number };
  filteredWithoutAi: number;
}

export interface Report { markdown: string; generatedAt: string; }
