// Steps 3 and 3b, judge + escalate (owner: Person A). README §2.3.
// The small model judges in batches; only unsure judgments go to the big model.
import { CheckpointDisputeLlmOutput, JudgmentDisputeLlmOutput } from "@enforcer/shared";
import type { Checkpoint, Dispute, Judgment, Member, Task } from "@enforcer/shared";
import { rules } from "../config";
import { getJudgments, getRawCommit, getTask, upsertJudgment, type RawCommit } from "../db/db";
import { getFileContents } from "../github/client";
import { callBig, callSmall } from "../llm/client";
import {
  buildCheckpointDisputePrompt,
  buildJudgePrompt,
  buildJudgmentDisputePrompt,
  judgeSchemaFor,
  type DisputeFile,
  type JudgeChange,
} from "../llm/prompts/judge";
import { judgedDelta } from "./progress";
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

// ---------- dispute re-judges (big model) ----------

/** Current contents of the disputed files: at most DISPUTE_MAX_FILES, each trimmed to DISPUTE_FILE_MAX_LINES. */
export async function fetchDisputeFiles(repos: string[], paths: string[]): Promise<DisputeFile[]> {
  const files: DisputeFile[] = [];
  for (const path of paths) {
    for (const repo of repos) {
      const found = await getFileContents(repo, path);
      if (found.length === 0) continue;
      files.push(...found);
      break; // first repo that has the path
    }
    if (files.length >= rules.DISPUTE_MAX_FILES) break;
  }
  return files.slice(0, rules.DISPUTE_MAX_FILES).map((f) => {
    const lines = f.content.split("\n");
    const max = rules.DISPUTE_FILE_MAX_LINES;
    return {
      path: f.path,
      content: lines.length <= max ? f.content : `${lines.slice(0, max).join("\n")}\n... (${lines.length - max} more lines not shown)`,
    };
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Re-judges one judgment with the member's note and files. Stores and returns the new judgment. */
export async function rejudgeJudgment(opts: {
  projectId: string;
  checkinId: string;
  judgment: Judgment;
  dispute: Dispute;
  files: DisputeFile[];
}): Promise<{ judgment: Judgment; before: string; after: string; reason: string }> {
  const { judgment: j, dispute } = opts;
  const raw = getRawCommit(j.sha);
  const task = j.taskId ? getTask(j.taskId) : undefined;
  const { system, user } = buildJudgmentDisputePrompt({
    task,
    change: { sha: j.sha, authors: [], files: raw?.files ?? [], diff: raw?.diff ?? "" },
    previous: { kind: j.kind, completionDelta: j.completionDelta, reason: j.reason },
    note: dispute.note,
    files: opts.files,
  });
  const out = await callBig({ purpose: "dispute", projectId: opts.projectId, checkinId: opts.checkinId, system, user, schema: JudgmentDisputeLlmOutput });

  const updated: Judgment = {
    ...j,
    kind: out.kind,
    completionDelta: j.taskId === null ? 0 : out.completionDelta,
    confidence: 1,
    model: "big",
    reason: out.reason,
  };
  upsertJudgment(opts.projectId, updated, opts.checkinId);
  return {
    judgment: updated,
    before: `${j.kind}, ${pct(judgedDelta(j))}`,
    after: `${updated.kind}, ${pct(judgedDelta(updated))}`,
    reason: out.reason,
  };
}

/**
 * Re-judges whether a checkpoint is met. Progress is always derived from judgments, so extra credit
 * is recorded as one evidence entry (sha "dispute:<id>") on the task; it never lowers progress.
 */
export async function rejudgeCheckpoint(opts: {
  projectId: string;
  checkinId: string;
  checkpoint: Checkpoint;
  dispute: Dispute;
  files: DisputeFile[];
}): Promise<{ before: string; after: string; reason: string }> {
  const { checkpoint: c, dispute } = opts;
  const task = getTask(c.taskId);
  if (!task) throw new Error("the checkpoint's task no longer exists");
  const judgments = getJudgments(opts.projectId).filter((j) => j.taskId === task.id);
  const { system, user } = buildCheckpointDisputePrompt({
    task,
    checkpoint: c,
    judgments: judgments.map((j) => ({ reason: j.reason, kind: j.kind, completionDelta: judgedDelta(j) })),
    note: dispute.note,
    files: opts.files,
  });
  const out = await callBig({ purpose: "dispute", projectId: opts.projectId, checkinId: opts.checkinId, system, user, schema: CheckpointDisputeLlmOutput });

  const target = out.met ? Math.max(out.completion, c.targetCompletion) : out.completion;
  const extra = Math.max(0, Math.min(1, target) - task.completion);
  if (extra > 0) {
    upsertJudgment(
      opts.projectId,
      {
        sha: `dispute:${dispute.id}`,
        repo: "",
        authorIds: [dispute.memberId],
        taskId: task.id,
        kind: "substantial",
        completionDelta: Math.round(extra * 1000) / 1000,
        confidence: 1,
        model: "big",
        reason: `Dispute re-judge: ${out.reason}`,
      },
      opts.checkinId,
    );
  }
  const newCompletion = Math.min(1, task.completion + extra);
  return {
    before: `${c.status}, ${pct(task.completion)}`,
    after: `${newCompletion >= c.targetCompletion ? "met" : c.status}, ${pct(newCompletion)}`,
    reason: out.reason,
  };
}
