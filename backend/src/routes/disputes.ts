// Judgment + checkpoint disputes (owner: Person A). README §2.8, §7 (Disputes).
// The big model re-judges right away; the dispute stays open until that finishes (or if it fails),
// and while it's open, alerts and reminders pause for that checkpoint only (decide.ts).
import { Router, type RequestHandler } from "express";
import { DisputeBody } from "@enforcer/shared";
import type { Dispute } from "@enforcer/shared";
import {
  finishCheckin,
  getCheckpoint,
  getCheckpoints,
  getDisputes,
  getJudgment,
  getJudgments,
  getProject,
  getTask,
  insertCheckin,
  insertDispute,
  resolveDispute,
} from "../db/db";
import { fetchDisputeFiles, rejudgeCheckpoint, rejudgeJudgment } from "../agent/judge";
import { projectNow } from "../agent/loop";
import { updateProgress } from "../agent/progress";
import { createTracer } from "../agent/trace";

export const disputesRouter = Router();

const asyncRoute =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const hasOpenDispute = async (projectId: string, targetId: string) =>
  (await getDisputes(projectId)).some(
    (d) => d.status === "open" && (d.target.kind === "judgment" ? d.target.sha : d.target.checkpointId) === targetId,
  );

/** Re-judge, update progress, trace it as its own "dispute" run. Leaves the dispute open on failure. */
async function runDispute(
  projectId: string,
  dispute: Dispute,
  rejudge: (checkinId: string) => Promise<{ before: string; after: string; reason: string }>,
  label: string,
): Promise<{ dispute: Dispute; ok: boolean; error?: string }> {
  const now = await projectNow(projectId);
  const run = await insertCheckin(projectId, "dispute", now.toISOString());
  const trace = await createTracer(run.id);
  try {
    const result = await rejudge(run.id);
    const resolved = await resolveDispute(dispute.id, result);
    const update = await updateProgress(projectId, now);
    await trace.step("escalate", `disputed → re-judged by the big model → ${result.before} → ${result.after}`, {
      disputeId: dispute.id,
      target: label,
      reason: result.reason,
      checkpointsMet: update.met.map((c) => c.criteria),
    });
    return { dispute: resolved, ok: true };
  } catch (e) {
    await trace.step("escalate", `dispute re-judge failed: ${(e as Error).message}`, { disputeId: dispute.id });
    return { dispute, ok: false, error: (e as Error).message };
  } finally {
    await finishCheckin(run.id);
  }
}

// POST /projects/:id/judgments/:sha/dispute { memberId, note, filePaths? } → Dispute
disputesRouter.post(
  "/projects/:id/judgments/:sha/dispute",
  asyncRoute(async (req, res) => {
    const projectId = req.params.id;
    const body = DisputeBody.parse(req.body);
    const project = await getProject(projectId);
    const judgment = await getJudgment(req.params.sha);
    if (!project || !judgment || !(await getJudgments(projectId)).some((j) => j.sha === judgment.sha)) {
      res.status(404).json({ error: "judgment not found" });
      return;
    }
    const task = judgment.taskId ? await getTask(judgment.taskId) : undefined;
    const mayDispute = task ? task.ownerId === body.memberId : judgment.authorIds.includes(body.memberId);
    if (!mayDispute) {
      res.status(403).json({ error: "only the owner of the task can dispute this judgment" });
      return;
    }
    if (await hasOpenDispute(projectId, judgment.sha)) {
      res.status(409).json({ error: "this judgment already has an open dispute" });
      return;
    }

    // Pause the nearest unmet checkpoint of the judged task while this is open.
    const pausedCheckpoint = task
      ? (await getCheckpoints(projectId)).find((c) => c.taskId === task.id && c.status !== "met")?.id ?? null
      : null;
    const dispute = await insertDispute(
      projectId,
      { target: { kind: "judgment", sha: judgment.sha }, memberId: body.memberId, note: body.note, filePaths: body.filePaths ?? [] },
      pausedCheckpoint,
    );

    const files = await fetchDisputeFiles([judgment.repo || project.repos[0]], dispute.filePaths);
    const out = await runDispute(
      projectId,
      dispute,
      async (checkinId) => rejudgeJudgment({ projectId, checkinId, judgment, dispute, files }),
      `judgment ${judgment.sha.slice(0, 7)}`,
    );
    res.status(out.ok ? 200 : 502).json(out.ok ? out.dispute : { ...out.dispute, error: out.error });
  }),
);

// POST /projects/:id/checkpoints/:checkpointId/dispute { memberId, note, filePaths? } → Dispute
disputesRouter.post(
  "/projects/:id/checkpoints/:checkpointId/dispute",
  asyncRoute(async (req, res) => {
    const projectId = req.params.id;
    const body = DisputeBody.parse(req.body);
    const project = await getProject(projectId);
    const checkpoint = await getCheckpoint(req.params.checkpointId);
    if (!project || !checkpoint || !(await getCheckpoints(projectId)).some((c) => c.id === checkpoint.id)) {
      res.status(404).json({ error: "checkpoint not found" });
      return;
    }
    if (!project.members.some((m) => m.id === body.memberId)) {
      res.status(403).json({ error: "not a member of this project" });
      return;
    }
    const owner = checkpoint.ownerId ?? null;
    if (owner !== null && owner !== body.memberId) {
      res.status(403).json({ error: "only the checkpoint's owner can dispute it" });
      return;
    }
    if (checkpoint.status === "met") {
      res.status(409).json({ error: "this checkpoint is already met" });
      return;
    }
    if (await hasOpenDispute(projectId, checkpoint.id)) {
      res.status(409).json({ error: "this checkpoint already has an open dispute" });
      return;
    }

    const dispute = await insertDispute(
      projectId,
      { target: { kind: "checkpoint", checkpointId: checkpoint.id }, memberId: body.memberId, note: body.note, filePaths: body.filePaths ?? [] },
      checkpoint.id,
    );
    const files = await fetchDisputeFiles(project.repos, dispute.filePaths);
    const out = await runDispute(
      projectId,
      dispute,
      async (checkinId) => rejudgeCheckpoint({ projectId, checkinId, checkpoint, dispute, files }),
      `checkpoint '${checkpoint.criteria}'`,
    );
    res.status(out.ok ? 200 : 502).json(out.ok ? out.dispute : { ...out.dispute, error: out.error });
  }),
);
