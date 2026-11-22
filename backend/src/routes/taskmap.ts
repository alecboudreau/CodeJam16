// Plan routes (owner: Person A). README §2.1, §2.2, §7.
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { AgreeBody, PutTaskMapBody } from "@enforcer/shared";
import type { Checkpoint, Member, PlanDraft, PlanItemRef, Task, TaskMap } from "@enforcer/shared";
import { rules } from "../config";
import {
  dbGet,
  dbAll,
  deleteCheckpoint,
  deleteTask,
  getCheckpoints,
  getCheckpoint,
  getProject,
  getProjectPlanState,
  setProjectDeadline,
  getTasks,
  getTask,
  newId,
  tx,
  updateProjectPlanState,
  upsertCheckpoint,
  upsertTask,
} from "../db/db";
import { hasPresenterKey, isDemoProject } from "../demo/mode";
import { listRepoFiles } from "../github/client";
import { callBig } from "../llm/client";
import { buildPlanPrompt, planSchemaFor } from "../llm/prompts/taskmap";
import { buildReplanPrompt, replanSchemaFor } from "../llm/prompts/replan";

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

async function writePlan(projectId: string, plan: PlanDraft): Promise<void> {
  const keepTasks = new Set(plan.tasks.map((task) => task.id));
  const keepCheckpoints = new Set(plan.checkpoints.map((checkpoint) => checkpoint.id));
  for (const checkpoint of await getCheckpoints(projectId)) if (!keepCheckpoints.has(checkpoint.id)) await deleteCheckpoint(checkpoint.id);
  for (const task of await getTasks(projectId)) if (!keepTasks.has(task.id)) await deleteTask(task.id);
  for (const task of plan.tasks) await upsertTask(projectId, task);
  for (const checkpoint of plan.checkpoints) await upsertCheckpoint(projectId, checkpoint);
  await updateProjectPlanState(projectId, { gracePeriodHours: plan.gracePeriodHours, graceApprovedBy: plan.graceApprovedBy });
}

/** Called within the same transaction that writes the final approval. */
async function applyPendingIfApproved(projectId: string, members: Member[]): Promise<void> {
  const state = (await getProjectPlanState(projectId))!;
  const pending = state.pendingPlan;
  if (!pending || computeWaitingOn(members, pending.tasks, pending.checkpoints, pending.graceApprovedBy).length) return;
  await dbAll("SELECT id FROM tasks WHERE project_id = ? FOR UPDATE", projectId);
  await dbAll("SELECT id FROM checkpoints WHERE project_id = ? FOR UPDATE", projectId);
  await writePlan(projectId, withCurrentProgress(pending, await getTasks(projectId), await getCheckpoints(projectId)));
  await updateProjectPlanState(projectId, { pendingPlan: null, planVersion: state.planVersion + 1 });
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

type PlanEdit = z.infer<typeof PutTaskMapBody>;
type EditResult = { map: TaskMap } | { status: number; body: { error: string; issues?: string[] } };

/**
 * Saves an edited plan: a draft is written directly; on an active plan it becomes the pending change.
 * Only changed items lose their approvals. Used by "Suggest a change" and by re-planning from a new spec.
 */
async function savePlanEdit(projectId: string, body: PlanEdit): Promise<EditResult> {
  return tx(async (): Promise<EditResult> => {
    await dbGet("SELECT id FROM projects WHERE id = ? FOR UPDATE", projectId);
    const project = await getProject(projectId);
    const state = await getProjectPlanState(projectId);
    if (!project || !state) return { status: 404, body: { error: "project not found" } };
    const errors = validatePlan(new Set(project.members.map((m) => m.id)), body.tasks, body.checkpoints);
    if (errors.length > 0) return { status: 400, body: { error: "invalid plan", issues: errors } };

    const oldTasks = new Map((await getTasks(projectId)).map((t) => [t.id, t]));
    const oldCheckpoints = new Map((await getCheckpoints(projectId)).map((c) => [c.id, c]));
    let foreignId = false;
    for (const task of body.tasks) if (!oldTasks.has(task.id) && await getTask(task.id)) foreignId = true;
    for (const checkpoint of body.checkpoints) if (!oldCheckpoints.has(checkpoint.id) && await getCheckpoint(checkpoint.id)) foreignId = true;
    if (foreignId) return { status: 400, body: { error: "plan item ids must belong to this project or be new" } };
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

    await tx(async () => {
      if (state.planActive) {
        const changed = tasks.length !== oldTasks.size || checkpoints.length !== oldCheckpoints.size || !graceUnchanged ||
          tasks.some((task) => !oldTasks.has(task.id) || taskChanged(oldTasks.get(task.id)!, task)) ||
          checkpoints.some((checkpoint) => !oldCheckpoints.has(checkpoint.id) || checkpointChanged(oldCheckpoints.get(checkpoint.id)!, checkpoint));
        await updateProjectPlanState(projectId, { pendingPlan: changed ? plan : null });
        if (changed) await applyPendingIfApproved(projectId, project.members);
      } else await writePlan(projectId, plan);
    });

    return { map: (await buildTaskMap(projectId))! };
  });
}

taskmapRouter.put("/projects/:id/taskmap", asyncRoute(async (req, res) => {
  const result = await savePlanEdit(req.params.id, PutTaskMapBody.parse(req.body));
  if ("map" in result) res.json(result.map);
  else res.status(result.status).json(result.body);
}));

// ---------- POST /projects/:id/taskmap/replan ----------
// After a new version of the spec is uploaded: the big model compares it with what's already done
// (task progress, checkpoint statuses, the repo's file list) and proposes an updated plan. The result
// is saved exactly like "Suggest a change", so it only takes effect once the people affected sign.

export interface PlanChange {
  kind: "new" | "changed" | "removed";
  title: string;
  reason: string;
}

taskmapRouter.post("/projects/:id/taskmap/replan", asyncRoute(async (req, res) => {
  const projectId = req.params.id;
  if (isDemoProject(projectId) && !hasPresenterKey(req)) {
    res.status(403).json({ error: "Updating the demo plan from a spec needs the presenter key." });
    return;
  }
  const project = await getProject(projectId);
  const state = await getProjectPlanState(projectId);
  if (!project || !state) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const tasks = await getTasks(projectId);
  if (tasks.length === 0) {
    res.status(409).json({ error: "there is no plan yet; draft the first plan instead" });
    return;
  }
  const specText = state.specText?.trim() ?? "";
  if (!specText) {
    res.status(400).json({ error: "upload the updated spec first" });
    return;
  }
  if (specText.length > MAX_SPEC_CHARS) {
    res.status(413).json({ error: `the spec is too long (${specText.length} characters, max ${MAX_SPEC_CHARS})` });
    return;
  }
  const checkpoints = await getCheckpoints(projectId);
  const nameOf = new Map(project.members.map((m) => [m.id, m.name]));
  const repoFiles = await Promise.all(project.repos.map(async (repo) => {
    try {
      return { repo, ...(await listRepoFiles(repo)) };
    } catch {
      return { repo, paths: [], truncated: false }; // the plan can still be updated from progress alone
    }
  }));

  const input = {
    specText,
    members: project.members,
    tasks,
    checkpoints,
    gracePeriodHours: state.gracePeriodHours ?? rules.DEFAULT_GRACE_PERIOD_HOURS,
    ownerName: (id: string) => nameOf.get(id) ?? "unknown",
    repoFiles,
    today: new Date(),
    deadline: deadlineOf(project.deadline),
  };
  const { system, user } = buildReplanPrompt(input);
  const out = await callBig({ purpose: "taskmap", projectId, system, user, schema: replanSchemaFor(input), effort: "high" });

  const memberByName = new Map(project.members.map((m) => [m.name.trim().toLowerCase(), m.id]));
  const idByKey = new Map(out.tasks.map((t) => [t.key, t.existingId ?? newId()]));
  const oldTasks = new Map(tasks.map((t) => [t.id, t]));
  const nextTasks: PlanEdit["tasks"] = out.tasks.map((t) => ({
    id: idByKey.get(t.key)!,
    title: t.title,
    description: t.description,
    points: t.points,
    ownerId: memberByName.get(t.ownerName.trim().toLowerCase())!,
    paths: t.tracked ? t.paths : [],
    tracked: t.tracked,
    dependsOn: t.dependsOn.map((k) => idByKey.get(k)!),
    completion: 0, // savePlanEdit keeps the real progress
    approvedBy: [],
  }));
  const taskById = new Map(nextTasks.map((t) => [t.id, t]));
  const nextCheckpoints: Checkpoint[] = out.checkpoints.map((c) => {
    const task = taskById.get(idByKey.get(c.taskKey)!)!;
    return {
      id: c.existingId ?? newId(),
      taskId: task.id,
      ownerId: c.shared ? null : task.ownerId,
      dueAt: new Date(c.dueAt).toISOString(),
      targetCompletion: c.targetCompletion,
      criteria: c.criteria,
      status: "pending",
      approvedBy: [],
    };
  });

  const result = await savePlanEdit(projectId, { tasks: nextTasks, checkpoints: nextCheckpoints, gracePeriodHours: out.gracePeriodHours });
  if (!("map" in result)) {
    res.status(result.status).json(result.body);
    return;
  }

  const changes: PlanChange[] = [];
  out.tasks.forEach((t, i) => {
    const old = t.existingId ? oldTasks.get(t.existingId) : undefined;
    if (!old) changes.push({ kind: "new", title: t.title, reason: t.reason });
    else if (taskChanged(old, nextTasks[i])) changes.push({ kind: "changed", title: t.title, reason: t.reason });
  });
  for (const t of tasks) if (!taskById.has(t.id)) changes.push({ kind: "removed", title: t.title, reason: "No longer in the spec, and no work had started." });
  res.json({ taskMap: result.map, summary: out.summary, changes });
}));

// ---------- POST /projects/:id/taskmap/agree ----------

const refKey = (r: PlanItemRef) => (r.kind === "grace" ? "grace" : `${r.kind}:${r.id}`);

taskmapRouter.post("/projects/:id/taskmap/agree", asyncRoute(async (req, res) => {
  const projectId = req.params.id;
  const { memberId, items } = AgreeBody.parse(req.body);
  const result = await tx(async () => {
    await dbGet("SELECT id FROM projects WHERE id = ? FOR UPDATE", projectId);
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
    if (map.active && !map.pending) {
      return map;
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
    await tx(async () => {
      if (map.pending) {
        const pending: PlanDraft = {
          ...map.pending,
          tasks: map.pending.tasks.map((task) => keys.has(refKey({ kind: "task", id: task.id })) ? { ...task, approvedBy: add(task.approvedBy) } : task),
          checkpoints: map.pending.checkpoints.map((checkpoint) => keys.has(refKey({ kind: "checkpoint", id: checkpoint.id })) ? { ...checkpoint, approvedBy: add(checkpoint.approvedBy) } : checkpoint),
          graceApprovedBy: keys.has("grace") ? add(map.pending.graceApprovedBy) : map.pending.graceApprovedBy,
        };
        await updateProjectPlanState(projectId, { pendingPlan: pending });
        await applyPendingIfApproved(projectId, project.members);
        return;
      }
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

    return await buildTaskMap(projectId);
  });
  if (result) res.json(result);
}));

const effortPoints = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13)]);
const TaskEditBody = z.object({
  title: z.string().trim().min(1),
  description: z.string(),
  points: effortPoints,
  ownerId: z.string().min(1),
  paths: z.array(z.string().trim().min(1)).default([]),
  tracked: z.boolean(),
});
const WhenBody = z.object({
  at: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Enter a valid date"),
});

function refuseDemo(projectId: string, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean {
  if (!isDemoProject(projectId)) return false;
  res.status(403).json({ error: "The demo project's plan can't be changed." });
  return true;
}

// Immediate edits from Project info. These apply now; they do not wait for another round of approvals.
taskmapRouter.put("/projects/:id/deadline", asyncRoute(async (req, res) => {
  if (refuseDemo(req.params.id, res)) return;
  const project = await getProject(req.params.id);
  if (!project) { res.status(404).json({ error: "project not found" }); return; }
  const { at } = WhenBody.parse(req.body);
  await setProjectDeadline(project.id, new Date(at).toISOString());
  res.json(await getProject(project.id));
}));

taskmapRouter.post("/projects/:id/tasks", asyncRoute(async (req, res) => {
  if (refuseDemo(req.params.id, res)) return;
  const project = await getProject(req.params.id);
  if (!project) { res.status(404).json({ error: "project not found" }); return; }
  const body = TaskEditBody.parse(req.body);
  if (!project.members.some((member) => member.id === body.ownerId)) {
    res.status(400).json({ error: "Choose a teammate on this project." });
    return;
  }
  const task: Task = {
    id: newId(), title: body.title, description: body.description, points: body.points, ownerId: body.ownerId,
    paths: body.paths, tracked: body.tracked, dependsOn: [], completion: 0, approvedBy: [body.ownerId],
  };
  await upsertTask(project.id, task);
  res.status(201).json(await buildTaskMap(project.id));
}));

taskmapRouter.put("/projects/:id/tasks/:taskId", asyncRoute(async (req, res) => {
  if (refuseDemo(req.params.id, res)) return;
  const project = await getProject(req.params.id);
  const owned = await dbGet("SELECT project_id FROM tasks WHERE id = ?", req.params.taskId);
  const existing = owned?.project_id === req.params.id ? await getTask(req.params.taskId) : undefined;
  if (!project || !existing) { res.status(404).json({ error: "task not found" }); return; }
  const body = TaskEditBody.parse(req.body);
  if (!project.members.some((member) => member.id === body.ownerId)) {
    res.status(400).json({ error: "Choose a teammate on this project." });
    return;
  }
  await upsertTask(project.id, {
    ...existing, title: body.title, description: body.description, points: body.points, ownerId: body.ownerId,
    paths: body.paths, tracked: body.tracked, approvedBy: [body.ownerId],
  });
  res.json(await buildTaskMap(project.id));
}));

taskmapRouter.put("/projects/:id/checkpoints/:checkpointId", asyncRoute(async (req, res) => {
  if (refuseDemo(req.params.id, res)) return;
  const owned = await dbGet("SELECT project_id FROM checkpoints WHERE id = ?", req.params.checkpointId);
  const existing = owned?.project_id === req.params.id ? await getCheckpoint(req.params.checkpointId) : undefined;
  if (!existing) { res.status(404).json({ error: "checkpoint not found" }); return; }
  const { at } = WhenBody.parse(req.body);
  await upsertCheckpoint(req.params.id, { ...existing, dueAt: new Date(at).toISOString() });
  res.json(await buildTaskMap(req.params.id));
}));
