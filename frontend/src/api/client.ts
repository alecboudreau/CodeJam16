import type {
  ComputeMeter, Dashboard, Dispute, Member, MemberInput, PlanItemRef,
  Project, Report, TaskMap, TraceStep,
} from "@enforcer/shared";
import { mockRequest } from "./mock";
import { accessToken } from "../auth/supabase";
import { DEMO_PROJECT_ID, isDemoMode, presenterKey } from "../demo";

export const useMocks = import.meta.env.VITE_USE_MOCKS === "true";
const baseUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/$/, "");
const viewers = new Map<string, string>();

export interface CreateProjectInput {
  name: string;
  repos: string[];
  members: MemberInput[];
  deadline: string;
}
export type UpdatePlanInput = Pick<TaskMap, "tasks" | "checkpoints" | "gracePeriodHours">;
export interface DisputeInput { note: string; filePaths?: string[] }

// A17 (#59) owns the shared contract. Keep B12's boundary local until it lands.
export type InboxStatus = "on_it" | "blocked" | "need_help";
export interface InboxItem {
  id: string;
  kind: "nudge" | "nudge_blocker" | "help_post" | "team_alert";
  message: string;
  at: string;
  checkpoint: { id: string; criteria: string; taskTitle: string };
  deliveredOnDiscord: boolean;
  answered: { status: InboxStatus; blockedByName?: string } | null;
}
export interface InboxData { forYou: InboxItem[]; team: InboxItem[]; unreadCount: number }
export interface StatusInput { status: InboxStatus; blockedById?: string }

export interface TaskEdit {
  title: string;
  description: string;
  points: 1 | 2 | 3 | 5 | 8 | 13;
  ownerId: string;
  paths: string[];
  tracked: boolean;
}

export interface PlanChange { kind: "new" | "changed" | "removed"; title: string; reason: string }
export interface ReplanResult { taskMap: TaskMap; summary: string; changes: PlanChange[] }

export interface GroupSummary {
  id: string;
  name: string;
  planActive: boolean;
  deadline: string;
  memberName: string;
  inviteCode: string;
  githubUsername?: string;
  contractJoinPending?: boolean;
}

function readInbox(value: unknown): InboxData {
  const data = value as Partial<InboxData> | null;
  const item = (value: unknown): value is InboxItem => {
    if (!value || typeof value !== "object") return false;
    const row = value as InboxItem;
    return typeof row.id === "string" && typeof row.message === "string" && typeof row.at === "string" && Number.isFinite(Date.parse(row.at)) &&
      ["nudge", "nudge_blocker", "help_post", "team_alert"].includes(row.kind) && typeof row.deliveredOnDiscord === "boolean" &&
      !!row.checkpoint && [row.checkpoint.id, row.checkpoint.criteria, row.checkpoint.taskTitle].every((v) => typeof v === "string") &&
      (row.answered === null || !!row.answered && ["on_it", "blocked", "need_help"].includes(row.answered.status) &&
        (row.answered.blockedByName === undefined || typeof row.answered.blockedByName === "string"));
  };
  if (!data || !Array.isArray(data.forYou) || !Array.isArray(data.team) || !data.forYou.every(item) || !data.team.every(item) ||
    data.forYou.some((row) => row.kind !== "nudge" && row.kind !== "nudge_blocker") ||
    data.team.some((row) => row.kind !== "help_post" && row.kind !== "team_alert") ||
    !Number.isInteger(data.unreadCount) || data.unreadCount !== data.forYou.filter((row) => row.answered === null).length) {
    throw new ApiError("The server returned an invalid Inbox response.", 502);
  }
  const newest = (a: InboxItem, b: InboxItem) => Date.parse(b.at) - Date.parse(a.at);
  return { forYou: [...data.forYou].sort(newest), team: [...data.team].sort(newest), unreadCount: data.unreadCount! };
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export function getViewerId(projectId: string): string {
  if (viewers.has(projectId)) return viewers.get(projectId)!;
  try { return localStorage.getItem(`enforcer:viewer:${projectId}`) || ""; }
  catch { return ""; }
}

export function setViewerId(projectId: string, memberId: string): void {
  viewers.set(projectId, memberId);
  try { localStorage.setItem(`enforcer:viewer:${projectId}`, memberId); }
  catch { /* The picker still works when browser storage is unavailable. */ }
}

function member(projectId: string, memberId = getViewerId(projectId)): string {
  if (!memberId) throw new ApiError('Choose a member in "Who are you?" first.', 400);
  return memberId;
}

/** Authorization header for the signed-in user (empty when sign-in is off or nobody is signed in). */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  const key = isDemoMode() ? presenterKey() : "";
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "X-Demo-Presenter-Key": key } : {}) };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (useMocks) return await mockRequest(method, path, body) as T;
  const multipart = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(await authHeaders()), ...(body === undefined || multipart ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(`Could not reach the API for ${method} ${path}. Check the backend connection and CORS configuration.`, 0);
  }
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : undefined; }
  catch {
    throw new ApiError(response.ok ? `The server returned invalid JSON for ${method} ${path}.` : `${method} ${path} failed (${response.status}).`, response.status);
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error : `${method} ${path} failed (${response.status}).`;
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;

// Pages use the same methods in mock and live mode. Identity defaults to the picker.
export const api = {
  getAuthConfig: () => request<{ enabled: boolean }>("GET", "/auth/config"),
  resetDemo: () => request<{ projectId: string }>("POST", "/demo/reset"),
  getPresenterStatus: () => request<{ presenter: boolean }>("GET", "/demo/presenter"),
  getMe: (id: string) => request<Member>("GET", `${projectPath(id)}/me`),
  // Demo mode has no account, so "my groups" is just the public demo project.
  listGroups: async (): Promise<GroupSummary[]> => {
    if (!isDemoMode()) return request<GroupSummary[]>("GET", "/me/projects");
    const demo = await request<Project>("GET", `/projects/${DEMO_PROJECT_ID}`);
    return [{ id: demo.id, name: demo.name, planActive: demo.planActive, deadline: demo.deadline, memberName: "", inviteCode: "" }];
  },
  joinGroup: (input: { code: string; githubUsername: string }) => request<Project>("POST", "/me/projects/join", input),
  createProject: (input: CreateProjectInput) => request<Project>("POST", "/projects", input),
  getProject: (id: string) => request<Project>("GET", projectPath(id)),
  addMember: (id: string, input: { name: string; githubUsername: string; email?: string }) =>
    request<Member>("POST", `${projectPath(id)}/members`, input),
  addAlias: (id: string, memberId: string, githubLogin: string) =>
    request<Member>("POST", `${projectPath(id)}/members/${encodeURIComponent(memberId)}/aliases`, { githubLogin }),
  uploadSpec: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ chars: number }>("POST", `${projectPath(id)}/spec`, body);
  },
  generateTaskMap: (id: string) => request<TaskMap>("POST", `${projectPath(id)}/taskmap/generate`),
  // After a new version of the spec: the AI proposes an updated plan as a change the team signs.
  replanFromSpec: (id: string) => request<ReplanResult>("POST", `${projectPath(id)}/taskmap/replan`),
  getTaskMap: (id: string) => request<TaskMap>("GET", `${projectPath(id)}/taskmap`),
  updateTaskMap: (id: string, input: UpdatePlanInput) => request<TaskMap>("PUT", `${projectPath(id)}/taskmap`, input),
  setDeadline: (id: string, at: string) => request<Project>("PUT", `${projectPath(id)}/deadline`, { at }),
  addTask: (id: string, input: TaskEdit) => request<TaskMap>("POST", `${projectPath(id)}/tasks`, input),
  updateTask: (id: string, taskId: string, input: TaskEdit) => request<TaskMap>("PUT", `${projectPath(id)}/tasks/${encodeURIComponent(taskId)}`, input),
  setCheckpointDue: (id: string, checkpointId: string, at: string) => request<TaskMap>("PUT", `${projectPath(id)}/checkpoints/${encodeURIComponent(checkpointId)}`, { at }),
  agree: (id: string, items?: PlanItemRef[], memberId?: string) =>
    request<TaskMap>("POST", `${projectPath(id)}/taskmap/agree`, { memberId: member(id, memberId), items }),
  runCheckin: (id: string) => request<{ checkinId: string }>("POST", `${projectPath(id)}/checkin`),
  getTrace: (id: string, checkinId?: string) => request<TraceStep[]>("GET",
    `${projectPath(id)}/trace${checkinId ? `?${new URLSearchParams({ checkinId })}` : ""}`),
  getDashboard: (id: string, viewerId?: string) => request<Dashboard>("GET",
    `${projectPath(id)}/dashboard?${new URLSearchParams({ viewerId: member(id, viewerId) })}`),
  getInbox: async (id: string, viewerId?: string) => readInbox(await request<unknown>("GET",
    `${projectPath(id)}/inbox?${new URLSearchParams({ viewerId: member(id, viewerId) })}`)),
  setMemberStatus: (id: string, input: StatusInput, viewerId?: string) => {
    const viewer = member(id, viewerId);
    return request<unknown>("POST", `${projectPath(id)}/members/${encodeURIComponent(viewer)}/status`, { ...input, viewerId: viewer });
  },
  getMeter: (id: string) => request<ComputeMeter>("GET", `${projectPath(id)}/meter`),
  getReport: (id: string) => request<Report>("GET", `${projectPath(id)}/report`),
  disputeJudgment: (id: string, sha: string, input: DisputeInput, memberId?: string) =>
    request<Dispute>("POST", `${projectPath(id)}/judgments/${encodeURIComponent(sha)}/dispute`,
      { ...input, memberId: member(id, memberId) }),
  disputeCheckpoint: (id: string, checkpointId: string, input: DisputeInput, memberId?: string) =>
    request<Dispute>("POST", `${projectPath(id)}/checkpoints/${encodeURIComponent(checkpointId)}/dispute`,
      { ...input, memberId: member(id, memberId) }),
  simulate: (id: string, days = 7) => request<{ checkinId: string }>("POST", `${projectPath(id)}/simulate`, { days }),
  githubWebhook: (payload: Record<string, unknown>) => request<void>("POST", "/webhook/github", payload),
};
