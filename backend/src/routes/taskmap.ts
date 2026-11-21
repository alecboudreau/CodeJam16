// Plan routes (owner: Person A). README §2.1, §2.2, §7.
import { Router, type RequestHandler } from "express";
import type { Checkpoint, Member, PlanItemRef, Task, TaskMap } from "@enforcer/shared";
import { rules } from "../config";
import {
  deleteCheckpoint,
  deleteTask,
  getCheckpoints,
  getMembers,
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

export function buildTaskMap(projectId: string): TaskMap | undefined {
  const project = getProject(projectId);
  const state = getProjectPlanState(projectId);
  if (!project || !state) return undefined;

  const tasks = getTasks(projectId);
  const checkpoints = getCheckpoints(projectId);
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
