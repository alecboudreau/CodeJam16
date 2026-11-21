// Status report prompt (owner: Person A). README §2.9, §11 (Status report).
// Input is tasks and checkpoints with criteria, due date and status only: no evidence, no numbers,
// so the summary can't rank or compare members.
import type { Checkpoint, Task } from "@enforcer/shared";

const SYSTEM = `You write a short, neutral status summary of a student group project for the whole team.
For each task, say which of its checkpoints are met, pending or missed. Name what's done and what's next in plain words.
Never rank, grade or compare members. Never mention percentages, points, commit counts or effort. No blame, no praise of individuals.
Format: Markdown. Start with a one-sentence overview, then one "### <task title>" section per task with a short bullet list of its checkpoints.`;

export function buildReportPrompt(input: {
  projectName: string;
  today: Date;
  deadline: string;
  tasks: (Pick<Task, "title" | "tracked"> & { ownerName: string })[];
  checkpoints: (Pick<Checkpoint, "criteria" | "dueAt" | "status"> & { taskTitle: string; shared: boolean })[];
}): { system: string; user: string } {
  const lines = input.tasks.map((t) => {
    if (!t.tracked) return `Task: ${t.title} (owner: ${t.ownerName}). Untracked: not checked automatically.`;
    const cps = input.checkpoints
      .filter((c) => c.taskTitle === t.title)
      .map((c) => `  - "${c.criteria}" due ${c.dueAt.slice(0, 10)}: ${c.status === "alerted" ? "missed" : c.status}${c.shared ? " (shared)" : ""}`);
    return [`Task: ${t.title} (owner: ${t.ownerName})`, ...(cps.length ? cps : ["  - no checkpoints"])].join("\n");
  });

  const user = `Project: ${input.projectName}
Today: ${input.today.toISOString().slice(0, 10)}
Deadline: ${input.deadline.slice(0, 10)}

${lines.join("\n\n")}

Return JSON: { "markdown": "..." }`;
  return { system: SYSTEM, user };
}
