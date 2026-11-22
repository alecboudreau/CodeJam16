// Progress + checkpoint statuses (owner: Person A). README §2.4–2.6 and §10 Step A.
// Progress means "is the requirement met": it's derived from judged completion, never from
// how many commits anyone made.
import type { Checkpoint, Judgment, Member, Task } from "@enforcer/shared";
import { rules } from "../config";
import { getCheckpoints, getJudgments, getMembers, getProject, getTasks, setMemberStatus, tx, upsertCheckpoint, upsertTask } from "../db/db";

/** What one judgment adds to its task: light changes count for at most LIGHT_CAP of their estimate. */
export const judgedDelta = (j: Judgment): number =>
  j.taskId === null || j.kind === "filtered" ? 0 : j.kind === "light" ? j.completionDelta * rules.LIGHT_CAP : j.completionDelta;

/** Task completion from its judgments, capped at 1. Untracked tasks stay at 0. */
export function completionFromJudgments(task: Task, judgments: Judgment[]): number {
  if (!task.tracked) return 0;
  const sum = judgments.filter((j) => j.taskId === task.id).reduce((s, j) => s + judgedDelta(j), 0);
  return Math.min(1, Math.round(sum * 1000) / 1000);
}

/** Σ(points × completion) ÷ Σ points over tracked tasks (0 when there are none). */
export function overallProgress(tasks: Task[]): number {
  const tracked = tasks.filter((t) => t.tracked);
  const total = tracked.reduce((s, t) => s + t.points, 0);
  return total === 0 ? 0 : tracked.reduce((s, t) => s + t.points * t.completion, 0) / total;
}

export interface ProgressUpdate {
  /** Tasks whose completion went up this time. */
  gained: Task[];
  met: Checkpoint[];
  missed: Checkpoint[];
  /** Members whose "blocked" status cleared because their blocker made progress. */
  unblocked: Member[];
  overallProgress: number;
}

/**
 * Step A of a check-in, all plain code:
 * 1. recompute each task's completion from its judgments
 * 2. checkpoints whose task reached targetCompletion → met (also late ones)
 * 3. pending checkpoints past dueAt → missed, missedAt = now, graceEndsAt = now + grace
 * 4. a "blocked" status clears if any of the blocker's tasks gained progress
 */
export async function updateProgress(projectId: string, now: Date): Promise<ProgressUpdate> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const judgments = await getJudgments(projectId);
  const graceMs = project.gracePeriodHours * 3600_000;

  return tx(async () => {
    // 1. completion
    const gained: Task[] = [];
    const tasks: Task[] = [];
    for (const t of await getTasks(projectId)) {
      const completion = completionFromJudgments(t, judgments);
      if (completion === t.completion) {
        tasks.push(t);
        continue;
      }
      const updated = { ...t, completion };
      await upsertTask(projectId, updated);
      if (completion > t.completion) gained.push(updated);
      tasks.push(updated);
    }
    const completionOf = new Map(tasks.map((t) => [t.id, t.completion]));

    // 2 + 3. checkpoint statuses
    const met: Checkpoint[] = [];
    const missed: Checkpoint[] = [];
    for (const c of await getCheckpoints(projectId)) {
      if (c.status === "met") continue;
      const completion = completionOf.get(c.taskId) ?? 0;
      if (completion >= c.targetCompletion) {
        const updated: Checkpoint = { ...c, status: "met" };
        await upsertCheckpoint(projectId, updated);
        met.push(updated);
      } else if (c.status === "pending" && now.getTime() > new Date(c.dueAt).getTime()) {
        const updated: Checkpoint = {
          ...c,
          status: "missed",
          missedAt: now.toISOString(),
          graceEndsAt: new Date(now.getTime() + graceMs).toISOString(),
        };
        await upsertCheckpoint(projectId, updated);
        missed.push(updated);
      }
    }

    // 4. unblock members whose blocker made progress
    const gainedOwners = new Set(gained.map((t) => t.ownerId));
    const unblocked: Member[] = [];
    for (const m of await getMembers(projectId)) {
      if (m.status === "blocked" && m.blockedById && gainedOwners.has(m.blockedById)) {
        await setMemberStatus(m.id, "none");
        unblocked.push(m);
      }
    }

    return { gained, met, missed, unblocked, overallProgress: overallProgress(tasks) };
  });
}
