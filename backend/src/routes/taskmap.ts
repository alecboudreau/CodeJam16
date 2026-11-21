// Plan routes (owner: Person A). README §2.1, §2.2, §7.
import { Router, type RequestHandler } from "express";
import { AgreeBody, PutTaskMapBody } from "@enforcer/shared";
import type { Checkpoint, Member, PlanItemRef, Task, TaskMap } from "@enforcer/shared";
import { rules } from "../config";
import {
  deleteCheckpoint,
  deleteTask,
  getCheckpoints,
  getProject,
  getProjectPlanState,
  getTasks,
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

export async function buildTaskMap(projectId: string): Promise<TaskMap | undefined> {
  const project = await getProject(projectId);
  const state = await getProjectPlanState(projectId);
  if (!project || !state) return undefined;

  const tasks = await getTasks(projectId);
  const checkpoints = await getCheckpoints(projectId);
  const gracePeriodHours = state.gracePeriodHours ?? rules.DEFAULT_GRACE_PERIOD_HOURS;
  return {
    projectId,
    version: state.planVersion,
    active: state.planActive,
    tasks,
    checkpoints,
    gracePeriodHours,
    graceApprovedBy: state.graceApprovedBy,
    pending: state.pendingPlan,
    waitingOn: computeWaitingOn(project.members, tasks, checkpoints, state.graceApprovedBy),
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
    const project = await getProject(projectId);
    const state = await getProjectPlanState(projectId);
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
    await tx(async () => {
      for (const c of await getCheckpoints(projectId)) await deleteCheckpoint(c.id);
      for (const t of await getTasks(projectId)) await deleteTask(t.id);
      for (const t of tasks) await upsertTask(projectId, t);
      for (const c of checkpoints) await upsertCheckpoint(projectId, c);
      await updateProjectPlanState(projectId, {
        gracePeriodHours: plan.gracePeriodHours ?? rules.DEFAULT_GRACE_PERIOD_HOURS,
        graceApprovedBy: [],
        pendingPlan: null,
      });
    });

    res.json(await buildTaskMap(projectId));
  }),
);

// ---------- GET /projects/:id/taskmap ----------

taskmapRouter.get("/projects/:id/taskmap", asyncRoute(async (req, res) => {
  const map = await buildTaskMap(req.params.id);
  if (!map) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(map);
}));

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

/** Problems with an edited plan, or [] if it's consistent. */
function validatePlan(memberIds: Set<string>, tasks: Task[], checkpoints: Checkpoint[]): string[] {
  const errors: string[] = [];
  const taskById = new Map<string, Task>();
  for (const t of tasks) {
    if (taskById.has(t.id)) errors.push(`task id ${t.id} is used twice`);
    taskById.set(t.id, t);
    if (!memberIds.has(t.ownerId)) errors.push(`task "${t.title}" has an owner who isn't on the team`);
  }
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

taskmapRouter.put("/projects/:id/taskmap", asyncRoute(async (req, res) => {
  const projectId = req.params.id;
  const body = PutTaskMapBody.parse(req.body);
  const project = await getProject(projectId);
  const state = await getProjectPlanState(projectId);
  if (!project || !state) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  if (state.planActive) {
    // Proposing changes to an active plan is a separate (Should) issue.
    res.status(409).json({ error: "the plan is active; changing an active plan isn't supported yet" });
    return;
  }

  const errors = validatePlan(new Set(project.members.map((m) => m.id)), body.tasks, body.checkpoints);
  if (errors.length > 0) {
    res.status(400).json({ error: "invalid plan", issues: errors });
    return;
  }

  const oldTasks = new Map((await getTasks(projectId)).map((t) => [t.id, t]));
  const oldCheckpoints = new Map((await getCheckpoints(projectId)).map((c) => [c.id, c]));

  // Only changed items lose their approvals. Progress and status are the server's, never the client's.
  const tasks: Task[] = body.tasks.map((t) => {
    const old = oldTasks.get(t.id);
    return {
      ...t,
      paths: t.tracked ? t.paths : [],
      completion: old?.completion ?? 0,
      approvedBy: old && !taskChanged(old, t) ? old.approvedBy : [],
    };
  });
  const checkpoints: Checkpoint[] = body.checkpoints.map((c) => {
    const old = oldCheckpoints.get(c.id);
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
      approvedBy: unchanged ? old.approvedBy : [],
    };
  });
  const graceUnchanged = state.gracePeriodHours === body.gracePeriodHours;

  await tx(async () => {
    const keepTasks = new Set(tasks.map((t) => t.id));
    const keepCheckpoints = new Set(checkpoints.map((c) => c.id));
    for (const id of oldCheckpoints.keys()) if (!keepCheckpoints.has(id)) await deleteCheckpoint(id);
    for (const id of oldTasks.keys()) if (!keepTasks.has(id)) await deleteTask(id);
    for (const t of tasks) await upsertTask(projectId, t);
    for (const c of checkpoints) await upsertCheckpoint(projectId, c);
    await updateProjectPlanState(projectId, {
      gracePeriodHours: body.gracePeriodHours,
      graceApprovedBy: graceUnchanged ? state.graceApprovedBy : [],
    });
  });

  res.json(await buildTaskMap(projectId));
}));

// ---------- POST /projects/:id/taskmap/agree ----------

const refKey = (r: PlanItemRef) => (r.kind === "grace" ? "grace" : `${r.kind}:${r.id}`);

taskmapRouter.post("/projects/:id/taskmap/agree", asyncRoute(async (req, res) => {
  const projectId = req.params.id;
  const { memberId, items } = AgreeBody.parse(req.body);
  const map = await buildTaskMap(projectId);
  const project = await getProject(projectId);
  if (!map || !project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  if (!project.members.some((m) => m.id === memberId)) {
    res.status(403).json({ error: "not a member of this project" });
    return;
  }
  if (map.active) {
    res.json(map); // nothing to approve; pending changes are a separate (Should) issue
    return;
  }

  // What this member may approve: their own tasks and personal checkpoints, plus shared items.
  const allowed = new Set<string>(["grace"]);
  for (const t of map.tasks) if (t.ownerId === memberId) allowed.add(refKey({ kind: "task", id: t.id }));
  for (const c of map.checkpoints) {
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
  await tx(async () => {
    for (const t of map.tasks) {
      if (keys.has(refKey({ kind: "task", id: t.id }))) await upsertTask(projectId, { ...t, approvedBy: add(t.approvedBy) });
    }
    for (const c of map.checkpoints) {
      if (keys.has(refKey({ kind: "checkpoint", id: c.id }))) {
        await upsertCheckpoint(projectId, { ...c, approvedBy: add(c.approvedBy) });
      }
    }
    if (keys.has("grace")) await updateProjectPlanState(projectId, { graceApprovedBy: add(map.graceApprovedBy) });

    // Everything approved by the right people → the plan becomes active.
    const after = (await buildTaskMap(projectId))!;
    if (after.tasks.length > 0 && after.waitingOn.length === 0) {
      await updateProjectPlanState(projectId, { planActive: true, planVersion: after.version + 1 });
    }
  });

  res.json(await buildTaskMap(projectId));
}));
