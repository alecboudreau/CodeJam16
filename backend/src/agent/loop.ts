// runCheckin(): orchestrates one check-in (owner: Person A). README §2.3, §10.
// observe → filter → judge → escalate → decide → act.
import type { TraceStep } from "@enforcer/shared";
import { rules } from "../config";
import {
  finishCheckin,
  getCheckpoints,
  getMembers,
  getProject,
  getProjectPlanState,
  getRunningCheckin,
  getTasks,
  insertCheckin,
  upsertJudgment,
  type CheckinKind,
} from "../db/db";
import { act, type Notify } from "./act";
import { decide } from "./decide";
import { filterCommits } from "./filter";
import { judgeCommits } from "./judge";
import { observe } from "./observe";
import { updateProgress } from "./progress";
import { createTracer, type Tracer } from "./trace";

export interface CheckinOptions {
  kind: CheckinKind;
  /** Overrides "now" (tests). Otherwise projects.demo_now, otherwise the real time. */
  now?: Date;
  /** Demo replay writes raw_commits itself. */
  skipGitHub?: boolean;
  /** Overrides discord/notify.ts (tests). */
  notify?: Notify;
  /** false = don't send Discord messages (the public demo without the presenter key, #76). */
  discord?: boolean;
}

export class CheckinError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/** A check-in that hasn't finished within this long is treated as dead (its serverless function was stopped). */
const RUNNING_TIMEOUT_MS = 5 * 60_000;

/** The clock a project's check-ins use: the demo clock when it's set. */
export async function projectNow(projectId: string): Promise<Date> {
  const demoNow = (await getProjectPlanState(projectId))?.demoNow;
  return demoNow ? new Date(demoNow) : new Date();
}

/** Extra check-ins only run when a pending checkpoint is due within CHECKPOINT_WINDOW_HOURS (or overdue). */
export async function checkpointDueSoon(projectId: string, now: Date): Promise<boolean> {
  const horizon = now.getTime() + rules.CHECKPOINT_WINDOW_HOURS * 3600_000;
  return (await getCheckpoints(projectId)).some((c) => c.status === "pending" && new Date(c.dueAt).getTime() <= horizon);
}

/**
 * Creates the check-in and starts it. Returns once the check-in row exists (the Trace page polls it);
 * `done` resolves when the check-in has finished, successfully or not. On Vercel the caller passes
 * `done` to waitUntil() so the function keeps running after the response.
 */
export async function startCheckin(projectId: string, opts: CheckinOptions): Promise<{ checkinId: string; done: Promise<void> }> {
  const project = await getProject(projectId);
  if (!project) throw new CheckinError("project not found", 404);
  if (!project.planActive) throw new CheckinError("the plan isn't active yet", 409);
  // Guard in the database, so it holds across serverless instances.
  if (await getRunningCheckin(projectId, RUNNING_TIMEOUT_MS)) throw new CheckinError("a check-in is already running for this project", 409);

  const now = opts.now ?? (await projectNow(projectId));
  // On the demo clock, commits come from the replay, never from GitHub (the demo repo name isn't real).
  const onDemoClock = Boolean((await getProjectPlanState(projectId))?.demoNow);
  opts = { ...opts, skipGitHub: opts.skipGitHub ?? onDemoClock };
  const checkin = await insertCheckin(projectId, opts.kind, now.toISOString());
  const trace = await createTracer(checkin.id);

  // Skip path: no GitHub call, no model call.
  if (opts.kind === "extra" && !(await checkpointDueSoon(projectId, now))) {
    await trace.step("skip", "skipped: no checkpoint due soon");
    await finishCheckin(checkin.id, { skipped: true });
    return { checkinId: checkin.id, done: Promise.resolve() };
  }

  const done = runSteps(projectId, checkin.id, now, opts, trace)
    .catch(() => {}) // already traced
    .finally(() => finishCheckin(checkin.id));
  return { checkinId: checkin.id, done };
}

/** Runs a whole check-in and waits for it (scheduler, demo replay). */
export async function runCheckin(projectId: string, opts: CheckinOptions): Promise<string> {
  const { checkinId, done } = await startCheckin(projectId, opts);
  await done;
  return checkinId;
}

async function runSteps(
  projectId: string,
  checkinId: string,
  now: Date,
  opts: CheckinOptions,
  trace: Tracer,
): Promise<void> {
  let current: TraceStep["step"] = "observe";
  try {
    const members = await getMembers(projectId);

    // 1. Observe
    const observed = await observe(projectId, { skipGitHub: opts.skipGitHub });
    await trace.step(
      "observe",
      `Pulled ${observed.commits.length} new commit${observed.commits.length === 1 ? "" : "s"}` +
        (opts.skipGitHub ? " (demo replay)" : ` from ${observed.repos.length} repo${observed.repos.length === 1 ? "" : "s"}`),
      { commits: observed.commits.length, fetched: observed.fetched },
    );

    // 2. Filter (no AI)
    current = "filter";
    const { keep, filtered } = filterCommits(observed.commits, members);
    for (const j of filtered) await upsertJudgment(projectId, j, checkinId);
    await trace.step("filter", `Filtered ${filtered.length} of ${observed.commits.length} commits (no AI)`, {
      filtered: filtered.map((j) => ({ sha: j.sha.slice(0, 7), reason: j.reason })),
    });

    // 3 + 3b. Judge, escalate
    current = "judge";
    const judged = await judgeCommits({ projectId, checkinId, commits: keep, tasks: await getTasks(projectId), members });
    await trace.step(
      "judge",
      keep.length === 0
        ? "Nothing left to judge"
        : `Small model judged ${keep.length} commit${keep.length === 1 ? "" : "s"} in ${judged.smallCalls} batch${judged.smallCalls === 1 ? "" : "es"}`,
      { substantial: judged.judgments.filter((j) => j.kind === "substantial").length, light: judged.judgments.filter((j) => j.kind === "light").length },
    );
    current = "escalate";
    await trace.step(
      "escalate",
      judged.escalated.length === 0
        ? "No judgment needed the big model"
        : `${judged.escalated.length} unsure judgment${judged.escalated.length === 1 ? "" : "s"} re-judged by the big model`,
      { shas: judged.escalated.map((s) => s.slice(0, 7)) },
    );

    // 4. Decide, Step A: progress and checkpoint statuses (plain code).
    current = "decide";
    const update = await updateProgress(projectId, now);
    const titleOf = new Map((await getTasks(projectId)).map((t) => [t.id, t.title]));
    const parts = [
      `${update.met.length} checkpoint${update.met.length === 1 ? "" : "s"} met`,
      `${update.missed.length} missed`,
      ...(update.unblocked.length ? [`${update.unblocked.map((m) => m.name).join(", ")} unblocked`] : []),
    ];
    await trace.step("decide", `${parts.join(", ")}; project ${Math.round(update.overallProgress * 100)}% done`, {
      met: update.met.map((c) => ({ task: titleOf.get(c.taskId), criteria: c.criteria })),
      missed: update.missed.map((c) => ({ task: titleOf.get(c.taskId), criteria: c.criteria, graceEndsAt: c.graceEndsAt })),
    });

    // 4. Decide, Steps B + C: the rules (plain code). Act (#12) sends what's decided here.
    const decisions = await decide(projectId, checkinId, now);
    const actionable = decisions.filter((d) => d.action !== "none");
    await trace.step(
      "decide",
      actionable.length === 0 ? "Everyone is on track: nothing to send" : actionable.map((d) => `${d.reason} → ${d.action}`).join("; "),
      { decisions: decisions.map(({ memberId, checkpointId, action, reason }) => ({ memberId, checkpointId, action, reason })) },
    );

    // 5. Act: the small model words each message, discord/notify.ts sends it.
    current = "act";
    const acted = await act({ projectId, checkinId, decisions, now, notify: opts.notify, discord: opts.discord });
    const total = acted.sent.length + acted.notSent.length;
    await trace.step(
      "act",
      total === 0
        ? "Nothing to send"
        : [acted.sent.length ? `Sent: ${acted.sent.join(", ")}` : "", acted.notSent.length ? `Not sent: ${acted.notSent.join("; ")}` : ""]
            .filter(Boolean)
            .join(". "),
      { sent: acted.sent, notSent: acted.notSent },
    );
  } catch (e) {
    await trace.step(current, `failed: ${(e as Error).message}`);
    throw e;
  }
}
