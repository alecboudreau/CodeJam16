// Plan prompt: tasks + checkpoints + grace period (owner: Person A). README §2.1, §11 (Plan).
// Big model, called once per project.
import { PlanLlmOutput } from "@enforcer/shared";
import type { Member } from "@enforcer/shared";
import { z } from "zod";

export interface PlanPromptInput {
  specText: string;
  members: Pick<Member, "name" | "capacityHoursPerWeek">[];
  today: Date;
  deadline: Date;
}

const SYSTEM = `You plan student group software projects. You turn a project spec into a fair, realistic plan that the team will approve item by item.

Produce:
1. tasks: the work in the spec, split so each task has one clear owner.
   - key: a short unique id you invent (e.g. "t1"), used only to link things inside this answer.
   - points: effort weight, one of 1, 2, 3, 5, 8, 13. Points reflect effort, not number of files. Assume 1 point is roughly 3 hours of work.
   - ownerName: exactly one of the member names given. Spread effort fairly, taking each member's weekly capacity into account. Every member owns at least one task.
   - paths: repo path globs the task's code will live in (e.g. "backend/payments/**"). Empty for untracked tasks.
   - tracked: false for work that produces no code (slides, written report, video). Untracked tasks get no checkpoints.
   - dependsOn: keys of tasks that must make progress before this one can.
2. checkpoints: frequent, feasible targets for every tracked task.
   - Space a task's checkpoints a few days apart (roughly every 2-4 days). Bigger tasks get more checkpoints.
   - targetCompletion is the fraction of the task done by dueAt (0-1). It increases across a task's checkpoints, and the task's last checkpoint has targetCompletion 1.
   - criteria: one concrete, checkable line describing what works at that point (e.g. "Login form submits and shows validation errors"), not an activity ("work on login").
   - Make each checkpoint feasible for its owner's capacity, and schedule it after the tasks it depends on have reached a useful checkpoint.
   - Every dueAt is an ISO 8601 date-time after today and no later than the deadline.
   - shared: true only for the rare checkpoint the whole team is responsible for (e.g. "the full demo runs end to end"). Use at most two.
3. gracePeriodHours: how long a missed checkpoint may stay unmet before the team is told. Usually 24-72 hours: shorter for short projects, longer when checkpoints are far apart. graceReason: one sentence explaining the choice.

Measure progress by requirements met, never by commit counts or activity.`;

export function buildPlanPrompt(input: PlanPromptInput): { system: string; user: string } {
  const members = input.members
    .map((m) => `- ${m.name}: ${m.capacityHoursPerWeek ? `${m.capacityHoursPerWeek} hours/week` : "capacity not given"}`)
    .join("\n");

  const user = `Today: ${input.today.toISOString()}
Deadline: ${input.deadline.toISOString()}

Team members:
${members}

<spec>
${input.specText}
</spec>

Return JSON with this shape:
{
  "tasks": [{ "key": "t1", "title": "...", "description": "...", "points": 5, "ownerName": "...", "paths": ["..."], "tracked": true, "dependsOn": [] }],
  "checkpoints": [{ "taskKey": "t1", "shared": false, "dueAt": "2026-01-01T18:00:00.000Z", "targetCompletion": 0.5, "criteria": "..." }],
  "gracePeriodHours": 48,
  "graceReason": "..."
}`;

  return { system: SYSTEM, user };
}

/**
 * PlanLlmOutput plus the checks that depend on this project (known owner names, valid keys, dates
 * inside the project). Failing them triggers the LLM client's single retry with the reason.
 * gracePeriodHours may be missing: the caller falls back to DEFAULT_GRACE_PERIOD_HOURS.
 */
export function planSchemaFor(input: PlanPromptInput) {
  const names = new Set(input.members.map((m) => m.name.trim().toLowerCase()));
  const start = input.today.getTime();
  const end = input.deadline.getTime();

  return PlanLlmOutput.extend({
    gracePeriodHours: z.number().int().positive().optional(),
    graceReason: z.string().optional(),
  }).superRefine((plan, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    const keys = new Map<string, boolean>(); // key → tracked
    plan.tasks.forEach((t, i) => {
      if (keys.has(t.key)) issue(`duplicate task key "${t.key}"`, ["tasks", i, "key"]);
      keys.set(t.key, t.tracked);
      if (!names.has(t.ownerName.trim().toLowerCase())) {
        issue(`ownerName "${t.ownerName}" is not one of the team members`, ["tasks", i, "ownerName"]);
      }
    });
    plan.tasks.forEach((t, i) =>
      t.dependsOn.forEach((d) => {
        if (!keys.has(d) || d === t.key) issue(`dependsOn "${d}" is not another task's key`, ["tasks", i, "dependsOn"]);
      }),
    );
    plan.checkpoints.forEach((c, i) => {
      if (!keys.has(c.taskKey)) issue(`taskKey "${c.taskKey}" does not match a task`, ["checkpoints", i, "taskKey"]);
      const due = new Date(c.dueAt).getTime();
      if (Number.isNaN(due) || due <= start || due > end) {
        issue(`dueAt ${c.dueAt} must be after today and no later than the deadline`, ["checkpoints", i, "dueAt"]);
      }
    });
    const ownersWithTasks = new Set(plan.tasks.map((t) => t.ownerName.trim().toLowerCase()));
    for (const n of names) if (!ownersWithTasks.has(n)) issue(`member "${n}" owns no task`, ["tasks"]);
  });
}
