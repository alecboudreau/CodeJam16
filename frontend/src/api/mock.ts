import type {
  Checkpoint, ComputeMeter, Dashboard, Dispute, Judgment, Member, PlanItemRef,
  PlanDraft, Project, Report, Task, TaskMap, TraceStep,
} from "@enforcer/shared";
import { AgreeBody, PutTaskMapBody } from "@enforcer/shared";
import type { CreateProjectInput, DisputeInput, GroupSummary, InboxData, InboxItem, StatusInput } from "./client";

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
  inbox: (InboxItem & { memberId: string | null })[];
}
const reminder = (id: string, memberId: string | null, kind: InboxItem["kind"], checkpointId: string, message: string, deliveredOnDiscord: boolean, date: string): MockState["inbox"][number] => {
  const cp = checkpoints.find((cp) => cp.id === checkpointId)!;
  return { id, memberId, kind, message, deliveredOnDiscord, at: date, answered: null,
    checkpoint: { id: cp.id, criteria: cp.criteria, taskTitle: tasks.find((task) => task.id === cp.taskId)!.title } };
};
const demoInbox = [
  reminder("inbox-settings-new", "jordan", "nudge", "cp-settings", "Could you check whether preferences are saved on the Settings page? Let us know if you're blocked or need help.", false, "2026-11-20T18:00:00.000Z"),
  reminder("inbox-settings-old", "jordan", "nudge", "cp-settings", "The checkpoint for saving preferences is still open. How is it going?", true, "2026-11-18T18:00:00.000Z"),
  reminder("inbox-blocker", "alex", "nudge_blocker", "cp-dashboard", "Sam is waiting on the payment history endpoint to finish the dashboard payment list. Can you help unblock it?", true, "2026-11-20T18:00:00.000Z"),
  reminder("inbox-sam", "sam", "nudge", "cp-dashboard", "Can you check the dashboard payment list? Let us know if something is blocking you.", true, "2026-11-20T17:00:00.000Z"),
  reminder("inbox-alert", null, "team_alert", "cp-settings", "The checkpoint for saving preferences is still open. Is there anything the team can do to help?", true, "2026-11-20T18:00:00.000Z"),
  reminder("inbox-help", null, "help_post", "cp-dashboard", "Sam could use a hand wiring the payment list. Can someone pair on the dashboard checkpoint?", false, "2026-11-19T18:00:00.000Z"),
];
const states = new Map<string, MockState>();
states.set(demoProjectId, structuredClone({ project: demoProject, plan: demoPlan, judgments, disputes: [], trace: demoTrace, meter: demoMeter, specText: "Demo payment app specification", inbox: demoInbox }));

const inviteCodes = new Map<string, string>([[demoProjectId, "PAYLITE1"]]);
function inviteFor(projectId: string): string {
  const existing = inviteCodes.get(projectId);
  if (existing) return existing;
  const code = projectId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase().padEnd(8, "X");
  inviteCodes.set(projectId, code);
  return code;
}
function groupSummary(project: Project): GroupSummary {
  return {
    id: project.id, name: project.name, planActive: project.planActive, deadline: project.deadline,
    memberName: "", inviteCode: inviteFor(project.id),
  };
}

function fail(message: string, status = 400): never {
  // Same error shape as the live wrapper, without a runtime import cycle.
  throw Object.assign(new Error(message), { name: "ApiError", status });
}
function findMember(state: MockState, id: string): Member {
  return state.project.members.find((m) => m.id === id) ?? fail("Member not found in this project", 404);
}
function inbox(state: MockState, viewerId: string): InboxData {
  const viewer = findMember(state, viewerId);
  const ordered = [...state.inbox].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const forYou = ordered.filter((row) => row.memberId === viewerId && (row.kind === "nudge" || row.kind === "nudge_blocker")).map(({ memberId: _memberId, ...row }) => ({
    ...row, answered: viewer.status !== "none" && viewer.statusAt && Date.parse(viewer.statusAt) > Date.parse(row.at)
      ? { status: viewer.status, ...(viewer.status === "blocked" ? { blockedByName: findMember(state, viewer.blockedById!).name } : {}) } : null,
  }));
  const team = ordered.filter((row) => row.kind === "help_post" || row.kind === "team_alert").map(({ memberId: _memberId, ...row }) => row);
  return { forYou, team, unreadCount: forYou.filter((row) => row.answered === null).length };
}
function refreshPlan(state: MockState): void {
  const { plan, project } = state;
  plan.waitingOn = [];
  const add = (item: PlanItemRef, required: string[], approved: string[]) => {
    const memberIds = required.filter((id) => !approved.includes(id));
    if (memberIds.length) plan.waitingOn.push({ item, memberIds });
  };
  const approvalPlan = plan.pending ?? plan;
  for (const task of approvalPlan.tasks) add({ kind: "task", id: task.id }, [task.ownerId], task.approvedBy);
  for (const cp of approvalPlan.checkpoints) add({ kind: "checkpoint", id: cp.id }, cp.ownerId ? [cp.ownerId] : project.members.map((m) => m.id), cp.approvedBy);
  add({ kind: "grace" }, project.members.map((m) => m.id), approvalPlan.graceApprovedBy);
  if (plan.active) {
    if (plan.pending && !plan.waitingOn.length) {
      const oldTasks = new Map(plan.tasks.map((task) => [task.id, task]));
      const oldCheckpoints = new Map(plan.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
      const pending = plan.pending;
      Object.assign(plan, pending, { pending: null, version: plan.version + 1,
        tasks: pending.tasks.map((task) => ({ ...task, completion: oldTasks.get(task.id)?.completion ?? 0 })),
        checkpoints: pending.checkpoints.map((checkpoint) => ({ ...checkpoint,
          status: oldCheckpoints.get(checkpoint.id)?.status ?? "pending", missedAt: oldCheckpoints.get(checkpoint.id)?.missedAt, graceEndsAt: oldCheckpoints.get(checkpoint.id)?.graceEndsAt,
        })),
      });
      project.gracePeriodHours = plan.gracePeriodHours;
    }
    return;
  }
  const active = plan.tasks.length > 0 && plan.waitingOn.length === 0;
  if (active && !plan.active) plan.version += 1;
  plan.active = project.planActive = active;
  project.gracePeriodHours = plan.gracePeriodHours;
}
const taskDefinition = (task: Task) => JSON.stringify([task.title, task.description, task.points, task.ownerId, task.tracked, [...task.paths].sort(), [...task.dependsOn].sort()]);
const checkpointDefinition = (checkpoint: Checkpoint) => JSON.stringify([checkpoint.taskId, checkpoint.ownerId, Date.parse(checkpoint.dueAt), checkpoint.targetCompletion, checkpoint.criteria]);
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
    if (method === "GET" && url.pathname === "/me/projects") return [...states.values()].map((state) => groupSummary(state.project));
    if (method === "POST" && url.pathname === "/me/projects/join") {
      const input = body as { code?: string; githubUsername?: string } | undefined;
      const code = input?.code?.trim().toLowerCase() ?? "";
      const login = input?.githubUsername?.trim().replace(/^@/, "").toLowerCase() ?? "";
      const state = [...states.values()].find((item) => inviteFor(item.project.id).toLowerCase() === code);
      if (!state) return fail("No group uses that invite code.", 404);
      const member = state.project.members.find((member) => member.githubUsername.toLowerCase() === login || member.githubAliases.some((alias) => alias.toLowerCase() === login));
      if (!member) {
        return fail("That GitHub username isn't on this group's team.", 404);
      }
      if (member.contractJoinPending && state.plan.active) {
        const add = (ids: string[]) => [...new Set([...ids, member.id])];
        for (const task of state.plan.tasks) if (task.ownerId === member.id) task.approvedBy = add(task.approvedBy);
        for (const cp of state.plan.checkpoints) if (cp.ownerId === null || cp.ownerId === member.id) cp.approvedBy = add(cp.approvedBy);
        state.plan.graceApprovedBy = add(state.plan.graceApprovedBy);
        member.contractJoinPending = false;
        member.contractAcceptedAt = new Date().toISOString();
        member.contractAcceptedVersion = state.plan.version;
        refreshPlan(state);
      }
      return state.project;
    }
    if (method === "POST" && url.pathname === "/projects") {
      const input = body as CreateProjectInput;
      const project: Project = {
        ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), planActive: false, gracePeriodHours: 48,
        members: input.members.map((m) => ({ ...m, id: crypto.randomUUID(), githubAliases: [], status: "none" })),
      };
      states.set(project.id, { project, plan: { projectId: project.id, tasks: [], checkpoints: [], gracePeriodHours: 48, graceApprovedBy: [], active: false, version: 0, pending: null, waitingOn: [] }, judgments: [], disputes: [], trace: [], meter: { ours: { tokens: 0, usd: 0, wh: 0, aiCalls: 0 }, naive: { tokens: 0, usd: 0, wh: 0, aiCalls: 0 }, filteredWithoutAi: 0, skippedCheckins: 0, disputeRejudges: 0 }, specText: "", inbox: [] });
      return project;
    }
    if (parts[0] !== "projects") return fail("Mock endpoint not found", 404);
    const state = states.get(parts[1]) ?? fail("Project not found", 404);
    const route = parts.slice(2).join("/");
    if (method === "GET" && !route) return state.project;
    if (method === "GET" && route === "inbox") return inbox(state, url.searchParams.get("viewerId") || "");
    if (method === "POST" && parts[2] === "members" && parts[4] === "status" && parts.length === 5) {
      const input = body as (StatusInput & { viewerId: string }) | undefined;
      if (!input || typeof input !== "object" || input.viewerId !== parts[3]) return fail("You can only respond as yourself", 403);
      const member = findMember(state, parts[3]);
      if (!["on_it", "blocked", "need_help"].includes(input.status)) return fail("Choose a valid status");
      if (input.status === "blocked") {
        if (!input.blockedById || input.blockedById === member.id) return fail("Choose another teammate you're waiting on");
        findMember(state, input.blockedById);
      } else if (input.blockedById !== undefined) return fail("Only Blocked can include a teammate");
      member.status = input.status;
      member.statusAt = new Date().toISOString();
      if (input.status === "blocked") member.blockedById = input.blockedById;
      else delete member.blockedById;
      return member;
    }
    if (method === "POST" && route === "members") {
      const input = body as { name?: string; githubUsername?: string; email?: string };
      const name = input.name?.trim() ?? "";
      const login = input.githubUsername?.trim().replace(/^@/, "") ?? "";
      if (!name || !login) return fail("Enter a name and a GitHub username");
      if (state.project.members.some((m) => m.githubUsername.toLowerCase() === login.toLowerCase())) return fail(`GitHub username "${login}" is already on this team.`, 409);
      const member: Member = {
        id: `member-${state.project.members.length + 1}-${Date.now()}`, name, githubUsername: login, githubAliases: [],
        email: input.email || undefined, status: "none", contractJoinPending: state.plan.active,
      };
      state.project.members.push(member);
      refreshPlan(state);
      return member;
    }
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
    if (method === "PUT" && route === "deadline") {
      const at = (body as { at?: string }).at ?? "";
      if (!Number.isFinite(Date.parse(at))) return fail("Enter a valid date");
      state.project.deadline = new Date(at).toISOString();
      return state.project;
    }
    if ((method === "POST" && route === "tasks") || (method === "PUT" && parts[2] === "tasks" && parts.length === 4)) {
      const input = body as { title?: string; description?: string; points?: number; ownerId?: string; paths?: string[]; tracked?: boolean };
      const title = input.title?.trim() ?? "";
      if (!title || !input.ownerId) return fail("Enter a task title and an owner");
      findMember(state, input.ownerId);
      const points = [1, 2, 3, 5, 8, 13].includes(Number(input.points)) ? Number(input.points) : 0;
      if (!points) return fail("Choose an effort size of 1, 2, 3, 5, 8, or 13");
      const paths = (input.paths ?? []).map((path) => path.trim()).filter(Boolean);
      if (method === "POST") {
        state.plan.tasks.push({
          id: crypto.randomUUID(), title, description: input.description ?? "", points, ownerId: input.ownerId,
          paths, tracked: input.tracked !== false, dependsOn: [], completion: 0, approvedBy: [input.ownerId],
        });
      } else {
        const task = state.plan.tasks.find((item) => item.id === parts[3]) ?? fail("task not found", 404);
        Object.assign(task, { title, description: input.description ?? "", points, ownerId: input.ownerId, paths, tracked: Boolean(input.tracked), approvedBy: [input.ownerId] });
      }
      refreshPlan(state);
      return state.plan;
    }
    if (method === "PUT" && parts[2] === "checkpoints" && parts.length === 4) {
      const checkpoint = state.plan.checkpoints.find((item) => item.id === parts[3]) ?? fail("checkpoint not found", 404);
      const at = (body as { at?: string }).at ?? "";
      if (!Number.isFinite(Date.parse(at))) return fail("Enter a valid date");
      checkpoint.dueAt = new Date(at).toISOString();
      refreshPlan(state);
      return state.plan;
    }
    if (method === "PUT" && route === "taskmap") {
      const parsed = PutTaskMapBody.safeParse(body);
      if (!parsed.success) return fail("Invalid plan");
      const input = parsed.data;
      const ids = new Set(input.tasks.map((task) => task.id));
      if (ids.size !== input.tasks.length || new Set(input.checkpoints.map((checkpoint) => checkpoint.id)).size !== input.checkpoints.length) return fail("Plan item ids must be unique");
      const byId = new Map(input.tasks.map((task) => [task.id, task]));
      const visiting = new Set<string>(), visited = new Set<string>();
      const cycle = (id: string): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        if (byId.get(id)?.dependsOn.some((dependency) => !byId.has(dependency) || cycle(dependency))) return true;
        visiting.delete(id); visited.add(id); return false;
      };
      for (const task of input.tasks) findMember(state, task.ownerId);
      if (input.tasks.some((task) => cycle(task.id))) return fail("Dependencies must refer to other tasks and cannot form a loop");
      for (const checkpoint of input.checkpoints) {
        if (!byId.get(checkpoint.taskId)?.tracked) return fail("Checkpoints must belong to a tracked task");
        if (checkpoint.ownerId !== null) findMember(state, checkpoint.ownerId);
      }
      const previous = state.plan.pending;
      const tasks = input.tasks.map((task) => {
        const old = state.plan.tasks.find((old) => old.id === task.id);
        const pending = previous?.tasks.find((old) => old.id === task.id);
        const normalized = { ...task, paths: task.tracked ? task.paths : [] };
        return { ...normalized, completion: old?.completion ?? 0,
          approvedBy: pending && taskDefinition(pending) === taskDefinition(normalized) ? pending.approvedBy : old && taskDefinition(old) === taskDefinition(normalized) ? old.approvedBy : [] };
      });
      const checkpoints = input.checkpoints.map((checkpoint) => {
        const old = state.plan.checkpoints.find((old) => old.id === checkpoint.id);
        const pending = previous?.checkpoints.find((old) => old.id === checkpoint.id);
        return { ...checkpoint, dueAt: new Date(checkpoint.dueAt).toISOString(), status: old?.status ?? "pending" as const,
          missedAt: old?.missedAt, graceEndsAt: old?.graceEndsAt,
          approvedBy: pending && checkpointDefinition(pending) === checkpointDefinition(checkpoint) ? pending.approvedBy : old && checkpointDefinition(old) === checkpointDefinition(checkpoint) ? old.approvedBy : [] };
      });
      const plan: PlanDraft = { tasks, checkpoints, gracePeriodHours: input.gracePeriodHours,
        graceApprovedBy: previous?.gracePeriodHours === input.gracePeriodHours ? previous.graceApprovedBy : state.plan.gracePeriodHours === input.gracePeriodHours ? state.plan.graceApprovedBy : [] };
      if (state.plan.active) {
        const changed = tasks.length !== state.plan.tasks.length || checkpoints.length !== state.plan.checkpoints.length || input.gracePeriodHours !== state.plan.gracePeriodHours ||
          tasks.some((task) => !state.plan.tasks.some((old) => old.id === task.id && taskDefinition(old) === taskDefinition(task))) ||
          checkpoints.some((checkpoint) => !state.plan.checkpoints.some((old) => old.id === checkpoint.id && checkpointDefinition(old) === checkpointDefinition(checkpoint)));
        state.plan.pending = changed ? plan : null;
      } else Object.assign(state.plan, plan);
      refreshPlan(state);
      return state.plan;
    }
    if (method === "POST" && route === "taskmap/agree") {
      const parsed = AgreeBody.safeParse(body);
      if (!parsed.success) return fail("Invalid agreement");
      const { memberId, items } = parsed.data;
      findMember(state, memberId);
      if (state.plan.active && !state.plan.pending) return state.plan;
      const approvalPlan = state.plan.pending ?? state.plan;
      const requested = items ?? state.plan.waitingOn.filter((w) => w.memberIds.includes(memberId)).map((w) => w.item);
      const targets: string[][] = [];
      for (const item of requested) {
        let approvals: string[];
        if (item.kind === "grace") approvals = approvalPlan.graceApprovedBy;
        else {
          const target = item.kind === "task" ? approvalPlan.tasks.find((t) => t.id === item.id) : approvalPlan.checkpoints.find((c) => c.id === item.id);
          if (!target) return fail("Plan item not found", 404);
          if (target.ownerId && target.ownerId !== memberId) return fail("Only the owner can approve this item", 403);
          approvals = target.approvedBy;
        }
        targets.push(approvals);
      }
      for (const approvals of targets) if (!approvals.includes(memberId)) approvals.push(memberId);
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
