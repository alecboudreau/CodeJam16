// Scheduler (owner: Person C, C5). README §2.3, §10.
// Daily check-in at 18:00 and an extra check at 00:00, 06:00 and 12:00 for every active project,
// in config.timezone. The loop itself decides whether an extra check-in skips (no checkpoint due soon).
import cron, { type ScheduledTask } from "node-cron";
import { config, rules } from "../config";
import { getProjectPlanState, listActiveProjectIds } from "../db/db";
import { CheckinError, runCheckin } from "../agent/loop";

export type ScheduledKind = "daily" | "extra";

export interface ScheduledRun {
  projectId: string;
  outcome: "ran" | "skipped-demo-clock" | "busy" | "failed";
  checkinId?: string;
  error?: string;
}

/**
 * One scheduled tick: a check-in for every active project, one after another.
 * Projects on the demo clock are left alone: their time is driven by "Simulate 1 week".
 */
export async function runScheduled(kind: ScheduledKind): Promise<ScheduledRun[]> {
  const runs: ScheduledRun[] = [];
  for (const projectId of listActiveProjectIds()) {
    if (getProjectPlanState(projectId)?.demoNow) {
      runs.push({ projectId, outcome: "skipped-demo-clock" });
      continue;
    }
    try {
      const checkinId = await runCheckin(projectId, { kind });
      runs.push({ projectId, outcome: "ran", checkinId });
    } catch (e) {
      // A check-in already running for that project (409) is fine: it'll be picked up next time.
      const busy = e instanceof CheckinError && e.status === 409;
      runs.push({ projectId, outcome: busy ? "busy" : "failed", error: (e as Error).message });
      if (!busy) console.error(`scheduler: ${kind} check-in failed for ${projectId}:`, e);
    }
  }
  return runs;
}

let tasks: ScheduledTask[] = [];

/** Starts both schedules. Safe to call twice. Set DISABLE_SCHEDULER=true to turn it off (tests). */
export function startScheduler(): void {
  if (tasks.length > 0) return;
  if (process.env.DISABLE_SCHEDULER === "true") {
    console.log("scheduler: disabled (DISABLE_SCHEDULER=true)");
    return;
  }
  for (const [expr, kind] of [
    [rules.CHECKIN_CRON, "daily"],
    [rules.EXTRA_CHECK_CRON, "extra"],
  ] as const) {
    if (!cron.validate(expr)) throw new Error(`scheduler: invalid cron expression "${expr}"`);
    tasks.push(
      cron.schedule(
        expr,
        () => {
          runScheduled(kind)
            .then((runs) => {
              const ran = runs.filter((r) => r.outcome === "ran").length;
              if (runs.length) console.log(`scheduler: ${kind} tick, ${ran}/${runs.length} projects checked`);
            })
            .catch((e) => console.error("scheduler: tick failed", e));
        },
        { timezone: config.timezone },
      ),
    );
  }
  console.log(`scheduler: daily "${rules.CHECKIN_CRON}" and extra "${rules.EXTRA_CHECK_CRON}" in ${config.timezone}`);
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks = [];
}
