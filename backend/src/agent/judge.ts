// Steps 3 and 3b, judge + escalate (owner: Person A). README §2.3.
// The small model judges in batches; only unsure judgments go to the big model.
import type { Judgment, Member, Task } from "@enforcer/shared";
import { rules } from "../config";
import { upsertJudgment, type RawCommit } from "../db/db";
import { callBig, callSmall } from "../llm/client";
import { buildJudgePrompt, judgeSchemaFor, type JudgeChange } from "../llm/prompts/judge";
import { resolveAuthors } from "./observe";

export const JUDGE_BATCH_SIZE = 10;

export interface JudgeResult {
  judgments: Judgment[];
  smallCalls: number;
  /** Shas re-judged by the big model. */
  escalated: string[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Judges commits that survived the filter, stores every judgment, and returns them. */
export async function judgeCommits(opts: {
  projectId: string;
  checkinId: string;
  commits: RawCommit[];
  tasks: Task[];
  members: Member[];
}): Promise<JudgeResult> {
  const { projectId, checkinId, commits, members } = opts;
  const tasks = opts.tasks.filter((t) => t.tracked);
  if (commits.length === 0) return { judgments: [], smallCalls: 0, escalated: [] };

  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const authorsOf = new Map(commits.map((c) => [c.sha, resolveAuthors(c, members)]));
  const toChange = (c: RawCommit): JudgeChange => {
    const a = authorsOf.get(c.sha)!;
    const names = a.authorIds.map((id) => nameOf.get(id) ?? id);
    return { sha: c.sha, authors: a.unmatchedLogin ? [...names, a.unmatchedLogin] : names, files: c.files, diff: c.diff };
  };
  const repoOf = new Map(commits.map((c) => [c.sha, c.repo]));

  const toJudgment = (
    j: { sha: string; taskId: string | null; kind: "substantial" | "light"; completionDelta: number; confidence: number; reason: string },
    model: "small" | "big",
  ): Judgment => ({
    sha: j.sha,
    repo: repoOf.get(j.sha)!,
    ...authorsOf.get(j.sha)!,
    taskId: j.taskId,
    kind: j.kind,
    completionDelta: j.taskId === null ? 0 : j.completionDelta,
    confidence: j.confidence,
    model,
    reason: j.reason,
  });

  // No tracked tasks to match against: nothing can be progress, and no model is needed.
  if (tasks.length === 0) {
    const judgments = commits.map((c) =>
      toJudgment({ sha: c.sha, taskId: null, kind: "light", completionDelta: 0, confidence: 1, reason: "No tracked task to match" }, "small"),
    ).map((j) => ({ ...j, model: "none" as const }));
    for (const j of judgments) upsertJudgment(projectId, j, checkinId);
    return { judgments, smallCalls: 0, escalated: [] };
  }

  // 3. Small model, batched.
  const bySha = new Map<string, Judgment>();
  let smallCalls = 0;
  for (const batch of chunks(commits.map(toChange), JUDGE_BATCH_SIZE)) {
    const { system, user } = buildJudgePrompt(tasks, batch);
    const out = await callSmall({ purpose: "judge", projectId, checkinId, system, user, schema: judgeSchemaFor(tasks, batch) });
    smallCalls++;
    for (const j of out.judgments) bySha.set(j.sha, toJudgment(j, "small"));
  }

  // 3b. Escalate the unsure ones to the big model.
  const unsure = commits.filter((c) => (bySha.get(c.sha)?.confidence ?? 0) < rules.ESCALATE_BELOW);
  for (const batch of chunks(unsure.map(toChange), JUDGE_BATCH_SIZE)) {
    const { system, user } = buildJudgePrompt(tasks, batch);
    const out = await callBig({ purpose: "escalate", projectId, checkinId, system, user, schema: judgeSchemaFor(tasks, batch) });
    for (const j of out.judgments) bySha.set(j.sha, toJudgment(j, "big"));
  }

  const judgments = commits.map((c) => bySha.get(c.sha)!);
  for (const j of judgments) upsertJudgment(projectId, j, checkinId);
  return { judgments, smallCalls, escalated: unsure.map((c) => c.sha) };
}
