import type {
  ComputeMeter, Dashboard, Dispute, Member, MemberInput, PlanItemRef,
  Project, Report, TaskMap, TraceStep,
} from "@enforcer/shared";
import { mockRequest } from "./mock";

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

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (useMocks) return await mockRequest(method, path, body) as T;
  const multipart = body instanceof FormData;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined || multipart ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : undefined; }
  catch {
    throw new ApiError(response.ok ? "The server returned invalid JSON." : `Request failed (${response.status}).`, response.status);
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;

// Pages use the same methods in mock and live mode. Identity defaults to the picker.
export const api = {
  createProject: (input: CreateProjectInput) => request<Project>("POST", "/projects", input),
  getProject: (id: string) => request<Project>("GET", projectPath(id)),
  addAlias: (id: string, memberId: string, githubLogin: string) =>
    request<Member>("POST", `${projectPath(id)}/members/${encodeURIComponent(memberId)}/aliases`, { githubLogin }),
  uploadSpec: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ chars: number }>("POST", `${projectPath(id)}/spec`, body);
  },
  generateTaskMap: (id: string) => request<TaskMap>("POST", `${projectPath(id)}/taskmap/generate`),
  getTaskMap: (id: string) => request<TaskMap>("GET", `${projectPath(id)}/taskmap`),
  updateTaskMap: (id: string, input: UpdatePlanInput) => request<TaskMap>("PUT", `${projectPath(id)}/taskmap`, input),
  agree: (id: string, items?: PlanItemRef[], memberId?: string) =>
    request<TaskMap>("POST", `${projectPath(id)}/taskmap/agree`, { memberId: member(id, memberId), items }),
  runCheckin: (id: string) => request<{ checkinId: string }>("POST", `${projectPath(id)}/checkin`),
  getTrace: (id: string, checkinId?: string) => request<TraceStep[]>("GET",
    `${projectPath(id)}/trace${checkinId ? `?${new URLSearchParams({ checkinId })}` : ""}`),
  getDashboard: (id: string, viewerId?: string) => request<Dashboard>("GET",
    `${projectPath(id)}/dashboard?${new URLSearchParams({ viewerId: member(id, viewerId) })}`),
  getMeter: (id: string) => request<ComputeMeter>("GET", `${projectPath(id)}/meter`),
  getReport: (id: string) => request<Report>("GET", `${projectPath(id)}/report`),
  disputeJudgment: (id: string, sha: string, input: DisputeInput, memberId?: string) =>
    request<Dispute>("POST", `${projectPath(id)}/judgments/${encodeURIComponent(sha)}/dispute`,
      { ...input, memberId: member(id, memberId) }),
  disputeCheckpoint: (id: string, checkpointId: string, input: DisputeInput, memberId?: string) =>
    request<Dispute>("POST", `${projectPath(id)}/checkpoints/${encodeURIComponent(checkpointId)}/dispute`,
      { ...input, memberId: member(id, memberId) }),
  simulate: (id: string) => request<{ checkinId: string }>("POST", `${projectPath(id)}/simulate`, { days: 7 }),
  githubWebhook: (payload: Record<string, unknown>) => request<void>("POST", "/webhook/github", payload),
};
