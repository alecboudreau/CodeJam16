// /dashboard?viewerId= and /meter (owner: Person A). README §2.5, §7 (Dashboard privacy).
// Everyone sees status and progress for every task. Commit evidence and judgment reasons are only
// returned for the viewer's own tasks. No scores, shares or member comparisons.
import { Router } from "express";
import type { Dashboard, Judgment, Task } from "@enforcer/shared";
import { getCheckpoints, getDisputes, getJudgments, getProject, getRawCommit, getTasks } from "../db/db";
import { completionFromJudgments, overallProgress } from "../agent/progress";
import { getComputeMeter } from "../llm/meter";

export const dashboardRouter = Router();

/** "backend/payments/**" → matches files under backend/payments/. */
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped.replace(/\u0000/g, ".*")}$`);
}

/**
 * Filtered commits carry no task (they never reach the judge). For the viewer's own evidence,
 * attribute their filtered commits to the task whose paths match the commit's files.
 */
function taskForFiltered(j: Judgment, ownTasks: Task[]): string | null {
  const files = getRawCommit(j.sha)?.files ?? [];
  for (const t of ownTasks) {
    const res = t.paths.map(globToRegex);
    if (files.some((f) => res.some((re) => re.test(f)))) return t.id;
  }
  return null;
}

/** Day of a judgment: its commit date, or the dispute date for dispute evidence entries. */
function dayOf(j: Judgment, disputeDay: Map<string, string>): string | undefined {
  const committed = getRawCommit(j.sha)?.committedAt;
  return (committed ?? disputeDay.get(j.sha))?.slice(0, 10);
}

// GET /projects/:id/dashboard?viewerId= → Dashboard
dashboardRouter.get("/projects/:id/dashboard", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const viewerId = typeof req.query.viewerId === "string" ? req.query.viewerId : "";
  if (!project.members.some((m) => m.id === viewerId)) {
    res.status(400).json({ error: "viewerId must be a member of this project" });
    return;
  }

  const tasks = getTasks(project.id);
  const checkpoints = getCheckpoints(project.id);
  const judgments = getJudgments(project.id);
  const disputes = getDisputes(project.id);

  // Everyone's status + progress, no evidence.
  const taskProgress = tasks.map((task) => ({ task, checkpoints: checkpoints.filter((c) => c.taskId === task.id) }));

  // The viewer's own evidence only.
  const ownTasks = tasks.filter((t) => t.ownerId === viewerId);
  const ownIds = new Set(ownTasks.map((t) => t.id));
  // Commits from a git identity later assigned to the viewer as an alias count as theirs too.
  const viewer = project.members.find((m) => m.id === viewerId)!;
  const viewerLogins = new Set([viewer.githubUsername, ...viewer.githubAliases].map((s) => s.toLowerCase()));
  const byViewer = (j: Judgment) =>
    j.authorIds.includes(viewerId) || (!!j.unmatchedLogin && viewerLogins.has(j.unmatchedLogin.toLowerCase()));
  const evidence = new Map<string, Judgment[]>(ownTasks.map((t) => [t.id, []]));
  for (const j of judgments) {
    const taskId =
      j.taskId && ownIds.has(j.taskId)
        ? j.taskId
        : j.kind === "filtered" && byViewer(j)
          ? taskForFiltered(j, ownTasks)
          : null;
    if (taskId) evidence.get(taskId)!.push(j);
  }
  const myEvidence = [...evidence].map(([taskId, js]) => ({
    taskId,
    commits: js.filter((j) => !j.sha.startsWith("dispute:")).length,
    judgments: js,
  }));
  const myDisputes = disputes.filter((d) => d.memberId === viewerId);

  // Overall progress over time: recompute completion with the judgments known by the end of each day.
  const disputeDay = new Map(disputes.map((d) => [`dispute:${d.id}`, d.resolvedAt ?? d.createdAt]));
  const days = [...new Set(judgments.map((j) => dayOf(j, disputeDay)).filter((d): d is string => !!d))].sort();
  const timeline = days.map((date) => {
    const upTo = judgments.filter((j) => (dayOf(j, disputeDay) ?? "") <= date);
    const asOf = tasks.map((t) => ({ ...t, completion: completionFromJudgments(t, upTo) }));
    return { date, overallProgress: overallProgress(asOf) };
  });

  // Unknown git identities, until someone assigns them to a member.
  const known = new Set(project.members.flatMap((m) => [m.githubUsername, ...m.githubAliases]).map((s) => s.toLowerCase()));
  const unmatchedCounts = new Map<string, number>();
  for (const j of judgments) {
    if (j.unmatchedLogin && !known.has(j.unmatchedLogin.toLowerCase())) {
      unmatchedCounts.set(j.unmatchedLogin, (unmatchedCounts.get(j.unmatchedLogin) ?? 0) + 1);
    }
  }

  const dashboard: Dashboard = {
    project,
    viewerId,
    overallProgress: overallProgress(tasks),
    tasks: taskProgress,
    myEvidence,
    myDisputes,
    timeline,
    unmatched: [...unmatchedCounts].map(([login, commits]) => ({ login, commits })),
  };
  res.json(dashboard);
});

// GET /projects/:id/meter → ComputeMeter
dashboardRouter.get("/projects/:id/meter", (req, res) => {
  if (!getProject(req.params.id)) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(getComputeMeter(req.params.id));
});
