import type {
  Checkpoint, ComputeMeter, Dashboard, Dispute, Judgment, Member, PlanItemRef,
  Project, Report, Task, TaskMap, TraceStep,
} from "@enforcer/shared";
import type { CreateProjectInput, DisputeInput, UpdatePlanInput } from "./client";

export const demoProjectId = "demo-payments";
const at = "2026-11-20T18:00:00.000Z";
const memberIds = ["alex", "priya", "jordan", "sam"];
const members: Member[] = ["Alex", "Priya", "Jordan", "Sam"].map((name, index) => ({
  id: memberIds[index], name, githubUsername: `${memberIds[index]}-demo`, githubAliases: [],
  discordId: `discord-${memberIds[index]}`, capacityHoursPerWeek: 8,
  status: index === 3 ? "blocked" : "none",
  ...(index === 3 ? { blockedById: "alex", statusAt: at } : {}),
}));
const task = (id: string, title: string, ownerId: string, points: number, completion: number, paths: string[], dependsOn: string[] = []): Task => ({
  id, title, ownerId, points, completion, paths, dependsOn, description: title,
  tracked: paths.length > 0, approvedBy: [ownerId],
});
const tasks: Task[] = [
  task("payments", "Payment API", "alex", 8, 1, ["backend/payments/**"]),
  task("history", "Payment history endpoint", "alex", 5, 0.4, ["backend/history/**"], ["payments"]),
  task("frontend", "Payment form", "priya", 5, 1, ["frontend/payments/**"], ["payments"]),
  task("settings", "Settings page", "jordan", 3, 0.02, ["frontend/settings/**"]),
  task("dashboard", "Dashboard UI", "sam", 5, 0, ["frontend/dashboard/**"], ["history"]),
  task("slides", "Pitch slides", "priya", 2, 0, []),
];
const checkpoint = (id: string, taskId: string, criteria: string, status: Checkpoint["status"], ownerId: string | null, dueAt: string, targetCompletion = 1): Checkpoint => ({
  id, taskId, criteria, status, ownerId, dueAt, targetCompletion,
  approvedBy: ownerId ? [ownerId] : [...memberIds],
  ...(status === "missed" || status === "alerted" ? {
    missedAt: dueAt, graceEndsAt: new Date(Date.parse(dueAt) + 48 * 3600000).toISOString(),
  } : {}),
});
const checkpoints: Checkpoint[] = [
  checkpoint("cp-payments", "payments", "Payment endpoint accepts and validates a payment", "met", "alex", "2026-11-16T18:00:00.000Z"),
  checkpoint("cp-history", "history", "Payment history endpoint returns saved payments", "pending", "alex", "2026-11-21T18:00:00.000Z"),
  checkpoint("cp-form", "frontend", "Payment form submits and validates", "met", "priya", "2026-11-18T18:00:00.000Z"),
  checkpoint("cp-settings", "settings", "Settings page saves preferences", "alerted", "jordan", "2026-11-16T18:00:00.000Z"),
  checkpoint("cp-dashboard", "dashboard", "Dashboard shows payment list", "missed", "sam", "2026-11-20T12:00:00.000Z", 0.5),
  checkpoint("cp-demo", "dashboard", "Team can run the complete payment demo", "pending", null, "2026-11-25T18:00:00.000Z"),
];
export const demoProject: Project = {
  id: demoProjectId, name: "Team payments app", repos: ["demo-team/payments"],
  members, deadline: "2026-11-27T23:59:00.000Z", createdAt: "2026-11-13T18:00:00.000Z",
  planActive: true, gracePeriodHours: 48,
};
export const demoPlan: TaskMap = {
  projectId: demoProjectId, tasks, checkpoints, gracePeriodHours: 48,
  graceApprovedBy: [...memberIds], version: 1, active: true, pending: null, waitingOn: [],
};
const judgment = (sha: string, taskId: string, authorIds: string[], completionDelta: number, kind: Judgment["kind"] = "substantial"): Judgment => ({
  sha, taskId, authorIds, completionDelta, kind, repo: demoProject.repos[0],
  confidence: 0.9, model: "small", reason: kind === "light" ? "Formatting changes; preferences are not saved yet." : "Implements the agreed requirement.",
});
const judgments: Judgment[] = [
  judgment("demo-payment", "payments", ["alex"], 1),
  judgment("demo-history", "history", ["alex"], 0.4),
  judgment("demo-form", "frontend", ["priya", "alex"], 1),
  judgment("demo-settings", "settings", ["jordan"], 0.02, "light"),
  { ...judgment("demo-unmatched", "settings", [], 0, "light"), unmatchedLogin: "jordan-laptop" },
];
export const demoTrace: TraceStep[] = ([
  ["observe", "Pulled new changes from the project repository"],
  ["filter", "Ignored generated files and formatting without AI"],
  ["judge", "Small model matched changes to agreed tasks"],
  ["escalate", "Re-judged an uncertain change with the big model"],
  ["decide", "Dashboard checkpoint missed; private reminder due"],
  ["act", "Sent a private reminder about the dashboard checkpoint"],
] as const).map(([step, summary], order) => ({ checkinId: "demo-checkin", order, step, summary, at }));
export const demoMeter: ComputeMeter = {
  ours: { tokens: 4200, usd: 0.018, wh: 0.084, aiCalls: 4 },
  naive: { tokens: 42000, usd: 0.63, wh: 1.26, aiCalls: 14 },
  filteredWithoutAi: 9, skippedCheckins: 3, disputeRejudges: 0,
};

interface MockState {
  project: Project;
  plan: TaskMap;
  judgments: Judgment[];
  disputes: Dispute[];
  trace: TraceStep[];
  meter: ComputeMeter;
  specText: string;
}
const states = new Map<string, MockState>();
states.set(demoProjectId, structuredClone({ project: demoProject, plan: demoPlan, judgments, disputes: [], trace: demoTrace, meter: demoMeter, specText: "Demo payment app specification" }));

function fail(message: string, status = 400): never {
  // Same error shape as the live wrapper, without a runtime import cycle.
  throw Object.assign(new Error(message), { name: "ApiError", status });
}
function findMember(state: MockState, id: string): Member {
  return state.project.members.find((m) => m.id === id) ?? fail("Member not found in this project", 404);
}
function refreshPlan(state: MockState): void {
  const { plan, project } = state;
  plan.waitingOn = [];
  const add = (item: PlanItemRef, required: string[], approved: string[]) => {
    const memberIds = required.filter((id) => !approved.includes(id));
    if (memberIds.length) plan.waitingOn.push({ item, memberIds });
  };
  for (const task of plan.tasks) add({ kind: "task", id: task.id }, [task.ownerId], task.approvedBy);
  for (const cp of plan.checkpoints) add({ kind: "checkpoint", id: cp.id }, cp.ownerId ? [cp.ownerId] : project.members.map((m) => m.id), cp.approvedBy);
  add({ kind: "grace" }, project.members.map((m) => m.id), plan.graceApprovedBy);
  const active = plan.tasks.length > 0 && plan.waitingOn.length === 0;
  if (active && !plan.active) plan.version += 1;
  plan.active = project.planActive = active;
  project.gracePeriodHours = plan.gracePeriodHours;
}
function dashboard(state: MockState, viewerId: string): Dashboard {
  findMember(state, viewerId);
  const { plan, project } = state;
  const tracked = plan.tasks.filter((t) => t.tracked);
  const points = tracked.reduce((sum, t) => sum + t.points, 0);
  const overallProgress = points ? tracked.reduce((sum, t) => sum + t.points * t.completion, 0) / points : 0;
  const unknown = state.judgments.filter((j) => j.unmatchedLogin && !project.members.some((m) =>
    [m.githubUsername, ...m.githubAliases].some((login) => login.toLowerCase() === j.unmatchedLogin!.toLowerCase())));
  return {
    project, viewerId, overallProgress,
    tasks: plan.tasks.map((task) => ({ task, checkpoints: plan.checkpoints.filter((c) => c.taskId === task.id) })),
    myEvidence: plan.tasks.filter((t) => t.ownerId === viewerId).map((t) => {
      const judgments = state.judgments.filter((j) => j.taskId === t.id);
      return { taskId: t.id, commits: judgments.length, judgments };
    }),
    myDisputes: state.disputes.filter((d) => d.memberId === viewerId),
    timeline: [{ date: project.createdAt.slice(0, 10), overallProgress: 0 }, { date: at.slice(0, 10), overallProgress }],
    unmatched: [...new Set(unknown.map((j) => j.unmatchedLogin!))].map((login) => ({ login, commits: unknown.filter((j) => j.unmatchedLogin === login).length })),
  };
}

// Stateful, in-memory fixtures let later pages exercise forms before integration.
// Clone responses so a component cannot accidentally mutate the mock server.
export async function mockRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  if (body !== undefined && !(body instanceof FormData)) body = structuredClone(body);
  const url = new URL(path, "http://mock.local");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const result = await dispatch();
  return structuredClone(result);

  async function dispatch(): Promise<unknown> {
    if (method === "POST" && url.pathname === "/webhook/github") return undefined;
    if (method === "POST" && url.pathname === "/projects") {
      const input = body as CreateProjectInput;
      const project: Project = {
        ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), planActive: false, gracePeriodHours: 48,
        members: input.members.map((m) => ({ ...m, id: crypto.randomUUID(), githubAliases: [], status: "none" })),
      };
      states.set(project.id, { project, plan: { projectId: project.id, tasks: [], checkpoints: [], gracePeriodHours: 48, graceApprovedBy: [], active: false, version: 0, pending: null, waitingOn: [] }, judgments: [], disputes: [], trace: [], meter: { ours: { tokens: 0, usd: 0, wh: 0, aiCalls: 0 }, naive: { tokens: 0, usd: 0, wh: 0, aiCalls: 0 }, filteredWithoutAi: 0, skippedCheckins: 0, disputeRejudges: 0 }, specText: "" });
      return project;
    }
    if (parts[0] !== "projects") return fail("Mock endpoint not found", 404);
    const state = states.get(parts[1]) ?? fail("Project not found", 404);
    const route = parts.slice(2).join("/");
    if (method === "GET" && !route) return state.project;
    if (method === "POST" && parts[2] === "members" && parts[4] === "aliases") {
      const member = findMember(state, parts[3]);
      const { githubLogin } = body as { githubLogin: string };
      if (!member.githubAliases.includes(githubLogin)) member.githubAliases.push(githubLogin);
      return member;
    }
    if (method === "POST" && route === "spec") {
      const file = (body as FormData).get("file");
      if (!(file instanceof Blob)) return fail("A specification file is required");
      state.specText = await file.text();
      return { chars: state.specText.length };
    }
    if (method === "POST" && route === "taskmap/generate") {
      if (!state.specText) return fail("Upload a specification first");
      if (state.plan.active) return fail("Plan is already active", 409);
      const ids = state.project.members.map((m) => m.id);
      if (!ids.length) return fail("Add a team member first");
      state.plan.tasks = structuredClone(tasks).map((t) => ({ ...t, ownerId: ids[Math.max(0, memberIds.indexOf(t.ownerId)) % ids.length], completion: 0, approvedBy: [] }));
      const start = Date.parse(state.project.createdAt), end = Date.parse(state.project.deadline);
      state.plan.checkpoints = checkpoints.map((cp, index) => ({
        id: cp.id, taskId: cp.taskId, criteria: cp.criteria, targetCompletion: cp.targetCompletion,
        ownerId: cp.ownerId ? state.plan.tasks.find((t) => t.id === cp.taskId)!.ownerId : null,
        dueAt: new Date(start + (end - start) * (index + 1) / checkpoints.length).toISOString(), status: "pending", approvedBy: [],
      }));
      state.plan.graceApprovedBy = [];
      refreshPlan(state);
      return state.plan;
    }
    if (method === "GET" && route === "taskmap") return state.plan;
    if (method === "PUT" && route === "taskmap") {
      if (state.plan.active) return fail("Editing an active mock plan is not supported yet", 409);
      const input = body as UpdatePlanInput;
      const preserve = <T extends { id: string; approvedBy: string[] }>(items: T[], previous: T[]): T[] => items.map((item) => {
        const old = previous.find((i) => i.id === item.id);
        const withoutApprovals = (value: T) => ({ ...value, approvedBy: [] });
        return { ...item, approvedBy: old && JSON.stringify(withoutApprovals(old)) === JSON.stringify(withoutApprovals(item)) ? old.approvedBy : [] };
      });
      state.plan.tasks = preserve(input.tasks, state.plan.tasks);
      state.plan.checkpoints = preserve(input.checkpoints, state.plan.checkpoints);
      if (input.gracePeriodHours !== state.plan.gracePeriodHours) state.plan.graceApprovedBy = [];
      state.plan.gracePeriodHours = input.gracePeriodHours;
      refreshPlan(state);
      return state.plan;
    }
    if (method === "POST" && route === "taskmap/agree") {
      const { memberId, items } = body as { memberId: string; items?: PlanItemRef[] };
      findMember(state, memberId);
      refreshPlan(state);
      const requested = items ?? state.plan.waitingOn.filter((w) => w.memberIds.includes(memberId)).map((w) => w.item);
      for (const item of requested) {
        let approvals: string[];
        if (item.kind === "grace") approvals = state.plan.graceApprovedBy;
        else {
          const target = item.kind === "task" ? state.plan.tasks.find((t) => t.id === item.id) : state.plan.checkpoints.find((c) => c.id === item.id);
          if (!target) return fail("Plan item not found", 404);
          if (target.ownerId && target.ownerId !== memberId) return fail("Only the owner can approve this item", 403);
          approvals = target.approvedBy;
        }
        if (!approvals.includes(memberId)) approvals.push(memberId);
      }
      refreshPlan(state);
      return state.plan;
    }
    if (method === "GET" && route === "dashboard") return dashboard(state, url.searchParams.get("viewerId") || "");
    if (method === "GET" && route === "meter") return state.meter;
    if (method === "GET" && route === "report") {
      const report: Report = {
        markdown: `# ${state.project.name}\n\n${state.plan.tasks.map((t) => `- ${t.title}: ${t.tracked ? state.plan.checkpoints.filter((c) => c.taskId === t.id).map((c) => `${c.criteria} (${c.status})`).join("; ") || "no checkpoints yet" : "untracked"}`).join("\n")}\n`,
        generatedAt: new Date().toISOString(),
      };
      return report;
    }
    if (method === "POST" && (route === "checkin" || route === "simulate")) {
      if (!state.plan.active) return fail("Approve the plan before running a check-in", 409);
      const checkinId = crypto.randomUUID();
      state.trace.push(...demoTrace.map((step) => ({ ...step, checkinId, at: new Date().toISOString() })));
      return { checkinId };
    }
    if (method === "GET" && route === "trace") {
      const checkinId = url.searchParams.get("checkinId") || state.trace.at(-1)?.checkinId;
      if (url.searchParams.has("checkinId") && !state.trace.some((s) => s.checkinId === checkinId)) return fail("Check-in not found", 404);
      return state.trace.filter((s) => s.checkinId === checkinId);
    }
    if (method === "POST" && parts[4] === "dispute" && (parts[2] === "judgments" || parts[2] === "checkpoints")) {
      const input = body as DisputeInput & { memberId: string };
      findMember(state, input.memberId);
      const cp = parts[2] === "checkpoints" ? state.plan.checkpoints.find((c) => c.id === parts[3]) : undefined;
      const j = parts[2] === "judgments" ? state.judgments.find((j) => j.sha === parts[3]) : undefined;
      if (!cp && !j) return fail("Dispute target not found", 404);
      const task = state.plan.tasks.find((t) => t.id === (cp?.taskId ?? j?.taskId));
      if (!(cp?.ownerId === null || task?.ownerId === input.memberId)) return fail("Only the owner can dispute this item", 403);
      if (!input.note.trim()) return fail("Add a note explaining the dispute");
      const dispute: Dispute = {
        id: crypto.randomUUID(), memberId: input.memberId, note: input.note, filePaths: input.filePaths ?? [],
        target: cp ? { kind: "checkpoint", checkpointId: cp.id } : { kind: "judgment", sha: j!.sha },
        status: "open", createdAt: new Date().toISOString(), before: cp?.status ?? j?.kind,
      };
      state.disputes.push(dispute);
      return dispute;
    }
    return fail(`Mock endpoint not found: ${method} ${url.pathname}`, 404);
  }
}
