// Plan routes (owner: Person A). README §2.1, §2.2, §7.
import { Router, type RequestHandler } from "express";
import { AgreeBody, PutTaskMapBody } from "@enforcer/shared";
import type { Checkpoint, Member, PlanDraft, PlanItemRef, Task, TaskMap } from "@enforcer/shared";
import { rules } from "../config";
import {
  deleteCheckpoint,
  deleteTask,
  getCheckpoints,
  getCheckpoint,
  getProject,
  getProjectPlanState,
  getTasks,
  getTask,
  newId,
  tx,
  updateProjectPlanState,
  upsertCheckpoint,
  upsertTask,
} from "../db/db";
import { callBig } from "../llm/client";
import { buildPlanPrompt, planSchemaFor } from "../llm/prompts/taskmap";

export const taskmapRouter = Router();

const asyncRoute =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const MAX_SPEC_CHARS = 200_000;

// ---------- reading the plan ----------

/** Who still has to approve what (README §2.2): owner for personal items, everyone for shared ones. */
export function computeWaitingOn(
  members: Member[],
  tasks: Task[],
  checkpoints: Checkpoint[],
  graceApprovedBy: string[],
): TaskMap["waitingOn"] {
  const everyone = members.map((m) => m.id);
  const missing = (required: string[], approvedBy: string[]) => required.filter((id) => !approvedBy.includes(id));
  const ownerOfTask = new Map(tasks.map((t) => [t.id, t.ownerId]));

  const waiting: TaskMap["waitingOn"] = [];
  const push = (item: PlanItemRef, memberIds: string[]) => {
    if (memberIds.length > 0) waiting.push({ item, memberIds });
  };

  for (const t of tasks) push({ kind: "task", id: t.id }, missing([t.ownerId], t.approvedBy));
  for (const c of checkpoints) {
    const required = c.ownerId === null ? everyone : [c.ownerId ?? ownerOfTask.get(c.taskId) ?? ""];
    push({ kind: "checkpoint", id: c.id }, missing(required, c.approvedBy));
  }
  push({ kind: "grace" }, missing(everyone, graceApprovedBy));
  return waiting;
}

export function buildTaskMap(projectId: string): TaskMap | undefined {
  const project = getProject(projectId);
  const state = getProjectPlanState(projectId);
  if (!project || !state) return undefined;

  const tasks = getTasks(projectId);
  const checkpoints = getCheckpoints(projectId);
  const gracePeriodHours = state.gracePeriodHours ?? rules.DEFAULT_GRACE_PERIOD_HOURS;
  const pending = state.pendingPlan ? withCurrentProgress(state.pendingPlan, tasks, checkpoints) : null;
  const approvalPlan = pending ?? { tasks, checkpoints, graceApprovedBy: state.graceApprovedBy };
  return {
    projectId,
    version: state.planVersion,
    active: state.planActive,
    tasks,
    checkpoints,
    gracePeriodHours,
    graceApprovedBy: state.graceApprovedBy,
    pending,
    waitingOn: computeWaitingOn(project.members, approvalPlan.tasks, approvalPlan.checkpoints, approvalPlan.graceApprovedBy),
  };
}

// ---------- POST /projects/:id/taskmap/generate ----------

/** A date-only deadline ("2026-12-15") means the end of that day. */
function deadlineOf(deadline: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? new Date(`${deadline}T23:59:59.999Z`) : new Date(deadline);
}

taskmapRouter.post(
  "/projects/:id/taskmap/generate",
  asyncRoute(async (req, res) => {
    const projectId = req.params.id;
    const project = getProject(projectId);
    const state = getProjectPlanState(projectId);
    if (!project || !state) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    if (state.planActive) {
      res.status(409).json({ error: "the plan is already active; propose a change instead" });
      return;
    }
    const specText = state.specText?.trim() ?? "";
    if (!specText) {
      res.status(400).json({ error: "upload the project spec first" });
      return;
    }
    if (specText.length > MAX_SPEC_CHARS) {
      res.status(413).json({ error: `the spec is too long (${specText.length} characters, max ${MAX_SPEC_CHARS})` });
      return;
    }

    const input = { specText, members: project.members, today: new Date(), deadline: deadlineOf(project.deadline) };
    const { system, user } = buildPlanPrompt(input);
    const plan = await callBig({
      purpose: "taskmap",
      projectId,
      system,
      user,
      schema: planSchemaFor(input),
      effort: "high", // once per project, and everything is measured against it
    });

    // keys → ids, owner names → member ids
    const memberByName = new Map(project.members.map((m) => [m.name.trim().toLowerCase(), m.id]));
    const idByKey = new Map(plan.tasks.map((t) => [t.key, newId()]));

    const tasks: Task[] = plan.tasks.map((t) => ({
      id: idByKey.get(t.key)!,
      title: t.title,
      description: t.description,
      points: t.points,
      ownerId: memberByName.get(t.ownerName.trim().toLowerCase())!,
      paths: t.tracked ? t.paths : [],
      tracked: t.tracked,
      dependsOn: t.dependsOn.map((k) => idByKey.get(k)!),
      completion: 0,
      approvedBy: [],
    }));
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    const checkpoints: Checkpoint[] = plan.checkpoints
      .map((c) => ({ c, task: taskById.get(idByKey.get(c.taskKey)!)! }))
      .filter(({ task }) => task.tracked) // untracked tasks never get checkpoints
      .map(({ c, task }) => ({
        id: newId(),
        taskId: task.id,
        ownerId: c.shared ? null : task.ownerId,
        dueAt: new Date(c.dueAt).toISOString(),
        targetCompletion: c.targetCompletion,
        criteria: c.criteria,
        status: "pending" as const,
        approvedBy: [],
      }));

    // Replace any earlier draft. Nothing is approved yet.
    tx(() => {
      for (const c of getCheckpoints(projectId)) deleteCheckpoint(c.id);
      for (const t of getTasks(projectId)) deleteTask(t.id);
      for (const t of tasks) upsertTask(projectId, t);
      for (const c of checkpoints) upsertCheckpoint(projectId, c);
      updateProjectPlanState(projectId, {
        gracePeriodHours: plan.gracePeriodHours ?? rules.DEFAULT_GRACE_PERIOD_HOURS,
        graceApprovedBy: [],
        pendingPlan: null,
      });
    });

    res.json(buildTaskMap(projectId));
  }),
);

// ---------- GET /projects/:id/taskmap ----------

taskmapRouter.get("/projects/:id/taskmap", (req, res) => {
  const map = buildTaskMap(req.params.id);
  if (!map) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(map);
});

// ---------- PUT /projects/:id/taskmap ----------

const sameList = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
const sameTime = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

function taskChanged(a: Task, b: Task): boolean {
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    a.points !== b.points ||
    a.ownerId !== b.ownerId ||
    a.tracked !== b.tracked ||
    !sameList(a.paths, b.paths) ||
    !sameList(a.dependsOn, b.dependsOn)
  );
}

function checkpointChanged(a: Checkpoint, b: Checkpoint): boolean {
  return (
    a.taskId !== b.taskId ||
    a.ownerId !== b.ownerId ||
    !sameTime(a.dueAt, b.dueAt) ||
    a.targetCompletion !== b.targetCompletion ||
    a.criteria !== b.criteria
  );
}

/** Pending drafts never overwrite progress recorded by check-ins or dispute re-judges. */
function withCurrentProgress(plan: PlanDraft, tasks: Task[], checkpoints: Checkpoint[]): PlanDraft {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const checkpointById = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({ ...task, completion: taskById.get(task.id)?.completion ?? 0 })),
    checkpoints: plan.checkpoints.map((checkpoint) => {
      const current = checkpointById.get(checkpoint.id);
      return { ...checkpoint, status: current?.status ?? "pending", missedAt: current?.missedAt, graceEndsAt: current?.graceEndsAt };
    }),
  };
}

function writePlan(projectId: string, plan: PlanDraft): void {
  const keepTasks = new Set(plan.tasks.map((task) => task.id));
  const keepCheckpoints = new Set(plan.checkpoints.map((checkpoint) => checkpoint.id));
  for (const checkpoint of getCheckpoints(projectId)) if (!keepCheckpoints.has(checkpoint.id)) deleteCheckpoint(checkpoint.id);
  for (const task of getTasks(projectId)) if (!keepTasks.has(task.id)) deleteTask(task.id);
  for (const task of plan.tasks) upsertTask(projectId, task);
  for (const checkpoint of plan.checkpoints) upsertCheckpoint(projectId, checkpoint);
  updateProjectPlanState(projectId, { gracePeriodHours: plan.gracePeriodHours, graceApprovedBy: plan.graceApprovedBy });
}

/** Called within the same transaction that writes the final approval. */
function applyPendingIfApproved(projectId: string, members: Member[]): void {
  const state = getProjectPlanState(projectId)!;
  const pending = state.pendingPlan;
  if (!pending || computeWaitingOn(members, pending.tasks, pending.checkpoints, pending.graceApprovedBy).length) return;
  writePlan(projectId, withCurrentProgress(pending, getTasks(projectId), getCheckpoints(projectId)));
  updateProjectPlanState(projectId, { pendingPlan: null, planVersion: state.planVersion + 1 });
}

/** Problems with an edited plan, or [] if it's consistent. */
function validatePlan(memberIds: Set<string>, tasks: Task[], checkpoints: Checkpoint[]): string[] {
  const errors: string[] = [];
  const taskById = new Map<string, Task>();
  for (const t of tasks) {
    if (taskById.has(t.id)) errors.push(`task id ${t.id} is used twice`);
    taskById.set(t.id, t);
    if (!memberIds.has(t.ownerId)) errors.push(`task "${t.title}" has an owner who isn't on the team`);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (taskById.get(id)?.dependsOn.some((dependency) => taskById.has(dependency) && cycle(dependency))) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (tasks.some((task) => cycle(task.id))) errors.push("task dependencies cannot form a loop");
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (!taskById.has(d) || d === t.id) errors.push(`task "${t.title}" depends on an unknown task`);
    }
  }
  const checkpointIds = new Set<string>();
  for (const c of checkpoints) {
    if (checkpointIds.has(c.id)) errors.push(`checkpoint id ${c.id} is used twice`);
    checkpointIds.add(c.id);
    const task = taskById.get(c.taskId);
    if (!task) errors.push(`checkpoint "${c.criteria}" belongs to an unknown task`);
    else if (!task.tracked) errors.push(`checkpoint "${c.criteria}" is on untracked task "${task.title}"`);
    if (c.ownerId !== null && !memberIds.has(c.ownerId)) {
      errors.push(`checkpoint "${c.criteria}" has an owner who isn't on the team`);
    }
  }
  return errors;
}

taskmapRouter.put("/projects/:id/taskmap", (req, res) => {
  const projectId = req.params.id;
  const body = PutTaskMapBody.parse(req.body);
  const project = getProject(projectId);
  const state = getProjectPlanState(projectId);
  if (!project || !state) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const errors = validatePlan(new Set(project.members.map((m) => m.id)), body.tasks, body.checkpoints);
  if (errors.length > 0) {
    res.status(400).json({ error: "invalid plan", issues: errors });
    return;
  }

  const oldTasks = new Map(getTasks(projectId).map((t) => [t.id, t]));
  const oldCheckpoints = new Map(getCheckpoints(projectId).map((c) => [c.id, c]));
  if (body.tasks.some((task) => !oldTasks.has(task.id) && getTask(task.id)) ||
      body.checkpoints.some((checkpoint) => !oldCheckpoints.has(checkpoint.id) && getCheckpoint(checkpoint.id))) {
    res.status(400).json({ error: "plan item ids must belong to this project or be new" });
    return;
  }
  const pendingTasks = new Map(state.pendingPlan?.tasks.map((task) => [task.id, task]) ?? []);
  const pendingCheckpoints = new Map(state.pendingPlan?.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]) ?? []);

  // Only changed items lose their approvals. Progress and status are the server's, never the client's.
  const tasks: Task[] = body.tasks.map((t) => {
    const old = oldTasks.get(t.id);
    const pending = pendingTasks.get(t.id);
    return {
      ...t,
      paths: t.tracked ? t.paths : [],
      completion: old?.completion ?? 0,
      approvedBy: pending && !taskChanged(pending, t) ? pending.approvedBy : old && !taskChanged(old, t) ? old.approvedBy : [],
    };
  });
  const checkpoints: Checkpoint[] = body.checkpoints.map((c) => {
    const old = oldCheckpoints.get(c.id);
    const pending = pendingCheckpoints.get(c.id);
    const unchanged = old !== undefined && !checkpointChanged(old, c);
    return {
      id: c.id,
      taskId: c.taskId,
      ownerId: c.ownerId,
      dueAt: new Date(c.dueAt).toISOString(),
      targetCompletion: c.targetCompletion,
      criteria: c.criteria,
      status: old?.status ?? "pending",
      missedAt: old?.missedAt,
      graceEndsAt: old?.graceEndsAt,
      approvedBy: pending && !checkpointChanged(pending, c) ? pending.approvedBy : unchanged ? old.approvedBy : [],
    };
  });
  const graceUnchanged = state.gracePeriodHours === body.gracePeriodHours;
  const plan: PlanDraft = { tasks, checkpoints, gracePeriodHours: body.gracePeriodHours,
    graceApprovedBy: state.pendingPlan?.gracePeriodHours === body.gracePeriodHours ? state.pendingPlan.graceApprovedBy : graceUnchanged ? state.graceApprovedBy : [] };

  tx(() => {
    if (state.planActive) {
      const changed = tasks.length !== oldTasks.size || checkpoints.length !== oldCheckpoints.size || !graceUnchanged ||
        tasks.some((task) => !oldTasks.has(task.id) || taskChanged(oldTasks.get(task.id)!, task)) ||
        checkpoints.some((checkpoint) => !oldCheckpoints.has(checkpoint.id) || checkpointChanged(oldCheckpoints.get(checkpoint.id)!, checkpoint));
      updateProjectPlanState(projectId, { pendingPlan: changed ? plan : null });
      if (changed) applyPendingIfApproved(projectId, project.members);
    } else writePlan(projectId, plan);
  });

  res.json(buildTaskMap(projectId));
});

// ---------- POST /projects/:id/taskmap/agree ----------

const refKey = (r: PlanItemRef) => (r.kind === "grace" ? "grace" : `${r.kind}:${r.id}`);

taskmapRouter.post("/projects/:id/taskmap/agree", (req, res) => {
  const projectId = req.params.id;
  const { memberId, items } = AgreeBody.parse(req.body);
  const map = buildTaskMap(projectId);
  const project = getProject(projectId);
  if (!map || !project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  if (!project.members.some((m) => m.id === memberId)) {
    res.status(403).json({ error: "not a member of this project" });
    return;
  }
  if (map.active && !map.pending) {
    res.json(map);
    return;
  }
  const approvalPlan = map.pending ?? map;

  // What this member may approve: their own tasks and personal checkpoints, plus shared items.
  const allowed = new Set<string>(["grace"]);
  for (const t of approvalPlan.tasks) if (t.ownerId === memberId) allowed.add(refKey({ kind: "task", id: t.id }));
  for (const c of approvalPlan.checkpoints) {
    if (c.ownerId === null || c.ownerId === memberId) allowed.add(refKey({ kind: "checkpoint", id: c.id }));
  }

  const requested = items ?? map.waitingOn.filter((w) => w.memberIds.includes(memberId)).map((w) => w.item);
  const notAllowed = requested.filter((r) => !allowed.has(refKey(r)));
  if (notAllowed.length > 0) {
    res.status(403).json({ error: "you can only approve your own items and shared ones", items: notAllowed });
    return;
  }

  const add = (list: string[]) => (list.includes(memberId) ? list : [...list, memberId]);
  const keys = new Set(requested.map(refKey));
  tx(() => {
    if (map.pending) {
      const pending: PlanDraft = {
        ...map.pending,
        tasks: map.pending.tasks.map((task) => keys.has(refKey({ kind: "task", id: task.id })) ? { ...task, approvedBy: add(task.approvedBy) } : task),
        checkpoints: map.pending.checkpoints.map((checkpoint) => keys.has(refKey({ kind: "checkpoint", id: checkpoint.id })) ? { ...checkpoint, approvedBy: add(checkpoint.approvedBy) } : checkpoint),
        graceApprovedBy: keys.has("grace") ? add(map.pending.graceApprovedBy) : map.pending.graceApprovedBy,
      };
      updateProjectPlanState(projectId, { pendingPlan: pending });
      applyPendingIfApproved(projectId, project.members);
      return;
    }
    for (const t of map.tasks) {
      if (keys.has(refKey({ kind: "task", id: t.id }))) upsertTask(projectId, { ...t, approvedBy: add(t.approvedBy) });
    }
    for (const c of map.checkpoints) {
      if (keys.has(refKey({ kind: "checkpoint", id: c.id }))) {
        upsertCheckpoint(projectId, { ...c, approvedBy: add(c.approvedBy) });
      }
    }
    if (keys.has("grace")) updateProjectPlanState(projectId, { graceApprovedBy: add(map.graceApprovedBy) });

    // Everything approved by the right people → the plan becomes active.
    const after = buildTaskMap(projectId)!;
    if (after.tasks.length > 0 && after.waitingOn.length === 0) {
      updateProjectPlanState(projectId, { planActive: true, planVersion: after.version + 1 });
    }
  });

  res.json(buildTaskMap(projectId));
});
