// Re-plan prompt: an updated spec + what's already done → a proposed plan change (big model).
// Called only when someone uploads a new version of the spec. The result becomes a proposed change
// that the people affected sign, exactly like a hand-made "Suggest a change".
import { PlanLlmOutput } from "@enforcer/shared";
import type { Checkpoint, Member, Task } from "@enforcer/shared";
import { z } from "zod";

export interface ReplanPromptInput {
  specText: string;
  members: Pick<Member, "name" | "capacityHoursPerWeek">[];
  tasks: Task[];
  checkpoints: Checkpoint[];
  gracePeriodHours: number;
  ownerName: (memberId: string) => string;
  repoFiles: { repo: string; paths: string[]; truncated: boolean }[];
  today: Date;
  deadline: Date;
}

const SYSTEM = `You update a student team's agreed project plan after their project spec changed.

You get the NEW spec, the CURRENT plan (every task with its owner, effort points and how much is already done, measured from the team's commits), every checkpoint with its status, and the list of files currently in the repo. Use the progress numbers and the file list to judge what has already been built. Do not redo finished work.

Return the complete updated plan:
1. tasks
   - To keep or change an existing task, set existingId to its id. Keep its title, description, points, owner, paths and dependencies exactly the same unless the new spec gives a reason to change them.
   - Tasks for new requirements get no existingId.
   - Drop a task only if the new spec no longer asks for it AND it has 0% progress. A task with any progress must stay.
   - key: a short unique id you invent (e.g. "t1"), used only to link things inside this answer.
   - points: one of 1, 2, 3, 5, 8, 13 (effort; 1 point is roughly 3 hours).
   - ownerName: exactly one of the member names given. Rebalance owners only when the remaining work (points not yet done) becomes clearly unfair for people's weekly hours. Prefer leaving work with whoever already started it.
   - tracked: false for work that produces no code (slides, report, video); untracked tasks get no checkpoints.
   - reason: for a new or changed task, one short sentence saying what in the new spec caused it. Empty string when the task is unchanged.
2. checkpoints
   - To keep an existing checkpoint, set existingId to its id and repeat its taskKey, dueAt, targetCompletion, criteria and shared flag. Always keep checkpoints whose status is "met".
   - New checkpoints (no existingId) are frequent, feasible targets: a few days apart, dueAt after today and no later than the deadline, one concrete checkable criteria line, targetCompletion rising to 1 at a task's last checkpoint.
   - shared: true only for the rare whole-team checkpoint (at most two in the plan).
3. gracePeriodHours: keep the current value unless the spec change gives a reason. graceReason: one sentence.
4. summary: two or three sentences for the team: what changed in the spec, what is already done, and what this proposal changes.

Measure progress by requirements met, never by commit counts or activity.`;

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function buildReplanPrompt(input: ReplanPromptInput): { system: string; user: string } {
  const members = input.members
    .map((m) => `- ${m.name}: ${m.capacityHoursPerWeek ? `${m.capacityHoursPerWeek} hours/week` : "capacity not given"}`)
    .join("\n");
  const tasks = input.tasks
    .map((t) => [
      `- id ${t.id}: "${t.title}" (owner ${input.ownerName(t.ownerId)}, ${t.points} points, ${t.tracked ? `${pct(t.completion)} done` : "untracked"})`,
      t.description ? `  ${t.description}` : "",
      t.paths.length ? `  paths: ${t.paths.join(", ")}` : "",
      t.dependsOn.length ? `  depends on: ${t.dependsOn.join(", ")}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n");
  const checkpoints = input.checkpoints
    .map((c) => `- id ${c.id}: task ${c.taskId}, due ${c.dueAt}, target ${pct(c.targetCompletion)}, status ${c.status}${c.ownerId === null ? ", shared" : ""}: ${c.criteria}`)
    .join("\n");
  const files = input.repoFiles
    .map((r) => `${r.repo}${r.truncated ? " (first files only)" : ""}:\n${r.paths.length ? r.paths.join("\n") : "(could not read the file list)"}`)
    .join("\n\n");

  const user = `Today: ${input.today.toISOString()}
Deadline: ${input.deadline.toISOString()}

Team members:
${members}

Current tasks:
${tasks}

Current checkpoints:
${checkpoints || "(none)"}

Current grace period: ${input.gracePeriodHours} hours

Files in the repo now:
<files>
${files}
</files>

<new_spec>
${input.specText}
</new_spec>

Return JSON with this shape:
{
  "tasks": [{ "key": "t1", "existingId": "…or omit for a new task", "title": "...", "description": "...", "points": 5, "ownerName": "...", "paths": ["..."], "tracked": true, "dependsOn": [], "reason": "..." }],
  "checkpoints": [{ "taskKey": "t1", "existingId": "…or omit", "shared": false, "dueAt": "2026-01-01T18:00:00.000Z", "targetCompletion": 0.5, "criteria": "..." }],
  "gracePeriodHours": 48,
  "graceReason": "...",
  "summary": "..."
}`;
  return { system: SYSTEM, user };
}

const base = PlanLlmOutput.shape;
const ReplanLlmOutput = z.object({
  tasks: z.array(base.tasks.element.extend({ existingId: z.string().optional(), reason: z.string().default("") })).min(1),
  checkpoints: z.array(base.checkpoints.element.extend({ existingId: z.string().optional() })),
  gracePeriodHours: z.number().int().positive(),
  graceReason: z.string().default(""),
  summary: z.string().min(1),
});
export type ReplanLlm = z.infer<typeof ReplanLlmOutput>;

/**
 * The output schema plus the project-specific rules. Failing them triggers the LLM client's single
 * retry with the reason: progress is never thrown away, owners are real members, new dates fit.
 */
export function replanSchemaFor(input: ReplanPromptInput) {
  const names = new Set(input.members.map((m) => m.name.trim().toLowerCase()));
  const taskIds = new Set(input.tasks.map((t) => t.id));
  const checkpointById = new Map(input.checkpoints.map((c) => [c.id, c]));
  const start = input.today.getTime();
  const end = input.deadline.getTime();

  return ReplanLlmOutput.superRefine((plan, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    const keys = new Map<string, boolean>();
    const kept = new Set<string>();
    plan.tasks.forEach((t, i) => {
      if (keys.has(t.key)) issue(`duplicate task key "${t.key}"`, ["tasks", i, "key"]);
      keys.set(t.key, t.tracked);
      if (!names.has(t.ownerName.trim().toLowerCase())) issue(`ownerName "${t.ownerName}" is not one of the team members`, ["tasks", i, "ownerName"]);
      if (t.existingId !== undefined) {
        if (!taskIds.has(t.existingId)) issue(`existingId "${t.existingId}" is not a current task id`, ["tasks", i, "existingId"]);
        else if (kept.has(t.existingId)) issue(`task ${t.existingId} appears twice`, ["tasks", i, "existingId"]);
        kept.add(t.existingId);
      }
    });
    plan.tasks.forEach((t, i) => t.dependsOn.forEach((d) => {
      if (!keys.has(d) || d === t.key) issue(`dependsOn "${d}" is not another task's key`, ["tasks", i, "dependsOn"]);
    }));
    for (const t of input.tasks) {
      if (t.completion > 0 && !kept.has(t.id)) issue(`task ${t.id} ("${t.title}") has progress and must be kept with existingId`, ["tasks"]);
    }

    const keptCheckpoints = new Set<string>();
    plan.checkpoints.forEach((c, i) => {
      if (!keys.has(c.taskKey)) issue(`taskKey "${c.taskKey}" does not match a task`, ["checkpoints", i, "taskKey"]);
      else if (!keys.get(c.taskKey)) issue(`checkpoint on untracked task "${c.taskKey}"`, ["checkpoints", i, "taskKey"]);
      const old = c.existingId !== undefined ? checkpointById.get(c.existingId) : undefined;
      if (c.existingId !== undefined && !old) issue(`existingId "${c.existingId}" is not a current checkpoint id`, ["checkpoints", i, "existingId"]);
      if (old) keptCheckpoints.add(old.id);
      const due = new Date(c.dueAt).getTime();
      const sameDate = old !== undefined && due === new Date(old.dueAt).getTime();
      if (Number.isNaN(due) || (!sameDate && (due <= start || due > end))) {
        issue(`dueAt ${c.dueAt} must be after today and no later than the deadline`, ["checkpoints", i, "dueAt"]);
      }
    });
    for (const c of input.checkpoints) {
      if (c.status === "met" && !keptCheckpoints.has(c.id)) issue(`checkpoint ${c.id} is already met and must be kept with existingId`, ["checkpoints"]);
    }
    const owners = new Set(plan.tasks.map((t) => t.ownerName.trim().toLowerCase()));
    for (const n of names) if (!owners.has(n)) issue(`member "${n}" owns no task`, ["tasks"]);
  });
}
