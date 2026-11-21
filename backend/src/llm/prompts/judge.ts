// Judge prompt (owner: Person A). README §11 (Judge, Escalate). Same prompt for the small model
// (batches of up to 10) and the big model (escalations).
import { JudgeLlmOutput } from "@enforcer/shared";
import type { Task } from "@enforcer/shared";
import { z } from "zod";

export const MAX_DIFF_LINES = 150;

export interface JudgeChange {
  sha: string;
  authors: string[];
  files: string[];
  diff: string;
}

const SYSTEM = `You review commits in a student group project and judge how much each one moves a planned task forward. The team agreed on the task list; judge against it, never against how many commits someone made.

For each change return:
- sha: the change's sha, exactly as given.
- taskId: the id of the task this change works on, or null if it matches none. Use the task's paths and description.
- kind: "light" for formatting, renames, comments, config tweaks, dependency bumps, or tiny edits. "substantial" for new logic, endpoints, UI features, data handling, or tests.
- completionDelta: the fraction (0-1) of that task's TOTAL work this one change completes on its own. Most changes complete a small part of a task (0.02-0.25). Use 0 when taskId is null. Don't exceed the work the task still has left.
- confidence: 0-1, how sure you are of the task match and the size.
- reason: one short, neutral sentence describing what the change does, shown to the author as evidence.

Some diffs are trimmed; judge from what is shown and the file list.`;

/** Keeps the first MAX_DIFF_LINES lines and says how many were left out. */
export function trimDiff(diff: string): string {
  const lines = diff.split("\n");
  if (lines.length <= MAX_DIFF_LINES) return diff;
  return `${lines.slice(0, MAX_DIFF_LINES).join("\n")}\n... (${lines.length - MAX_DIFF_LINES} more lines not shown)`;
}

export function buildJudgePrompt(tasks: Task[], changes: JudgeChange[]): { system: string; user: string } {
  const taskList = tasks
    .map(
      (t) =>
        `- id: ${t.id}\n  title: ${t.title}\n  description: ${t.description}\n  paths: ${t.paths.join(", ") || "(none)"}\n  already done: about ${Math.round(t.completion * 100)}%`,
    )
    .join("\n");

  const changeList = changes
    .map(
      (c) =>
        `<change sha="${c.sha}">\nauthors: ${c.authors.join(", ") || "unknown"}\nfiles: ${c.files.join(", ")}\n<diff>\n${trimDiff(c.diff)}\n</diff>\n</change>`,
    )
    .join("\n\n");

  const user = `Tasks:
${taskList}

Changes:
${changeList}

Return JSON: { "judgments": [{ "sha": "...", "taskId": "..." | null, "kind": "substantial" | "light", "completionDelta": 0.1, "confidence": 0.8, "reason": "..." }] } with exactly one entry per change.`;

  return { system: SYSTEM, user };
}

/** JudgeLlmOutput plus: one judgment per given sha, and only known task ids. */
export function judgeSchemaFor(tasks: Task[], changes: JudgeChange[]) {
  const taskIds = new Set(tasks.map((t) => t.id));
  const shas = changes.map((c) => c.sha);
  return JudgeLlmOutput.superRefine((out, ctx) => {
    const got = out.judgments.map((j) => j.sha);
    for (const sha of shas) {
      if (!got.includes(sha)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `missing a judgment for sha ${sha}`, path: ["judgments"] });
    }
    out.judgments.forEach((j, i) => {
      if (!shas.includes(j.sha)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown sha ${j.sha}`, path: ["judgments", i, "sha"] });
      if (j.taskId !== null && !taskIds.has(j.taskId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown taskId ${j.taskId}`, path: ["judgments", i, "taskId"] });
      }
    });
  });
}
