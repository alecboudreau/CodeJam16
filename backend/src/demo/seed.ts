// `npm run demo:seed`: seeds the PayLite demo project (owner: Person C, C8). README §15.
//
//   npm run demo:seed                         # reuses the Discord account that last ran /link
//   npm run demo:seed -- --discord <user-id>  # or say which Discord account gets the demo DMs
//
// Creates (or recreates) project "demo-paylite": 4 members all linked to ONE Discord account (the
// presenter's), so every demo DM lands on the presenter's screen; an approved plan with the
// checkpoints from README §15; and the demo clock set to Sat Nov 7, 18:00, so "Simulate 1 week"
// plays Sun Nov 8 → Sat Nov 14. Re-running it wipes and recreates only this project.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Checkpoint, MemberInput, Task } from "@enforcer/shared";
import { config, ROOT_DIR } from "../config";
import { closeDb, dbAll, dbGet, dbRun, initDb, insertMember, nowIso, setMemberDiscordId, tx, updateProjectPlanState, upsertCheckpoint, upsertTask } from "../db/db";
import { zonedInstant } from "./replay";

export const DEMO_PROJECT_ID = "demo-paylite";

const MEMBERS: (MemberInput & { key: string })[] = [
  { key: "alex", name: "Alex", githubUsername: "alex-demo", capacityHoursPerWeek: 8 },
  { key: "priya", name: "Priya", githubUsername: "priya-demo", capacityHoursPerWeek: 8 },
  { key: "jordan", name: "Jordan", githubUsername: "jordan-demo", capacityHoursPerWeek: 6 },
  { key: "sam", name: "Sam", githubUsername: "sam-demo", capacityHoursPerWeek: 6 },
];

type TaskSpec = Omit<Task, "id" | "ownerId" | "completion" | "approvedBy" | "dependsOn"> & { key: string; owner: string; dependsOn?: string[] };
const TASKS: TaskSpec[] = [
  { key: "api", owner: "alex", title: "Payment API", description: "POST /payments/charge and /payments/refund with validation and unit tests.", points: 8, paths: ["backend/payments/**"], tracked: true },
  { key: "history", owner: "alex", title: "Payment history endpoint", description: "GET /payments/history: paginated charges and refunds, filterable by date.", points: 5, paths: ["backend/history/**"], tracked: true },
  { key: "checkout", owner: "priya", title: "Checkout page", description: "Card form with inline validation and a confirmation screen.", points: 5, paths: ["frontend/checkout/**"], tracked: true },
  { key: "dashboard", owner: "sam", title: "Dashboard UI", description: "Table of recent payments with daily and weekly totals and a date filter.", points: 5, paths: ["frontend/dashboard/**"], tracked: true, dependsOn: ["history"] },
  { key: "settings", owner: "jordan", title: "Settings page", description: "Business name, default currency and receipt preference; saves and reloads.", points: 3, paths: ["frontend/settings/**"], tracked: true },
  { key: "slides", owner: "priya", title: "Pitch slides", description: "5-minute final demo presentation.", points: 2, paths: [], tracked: false },
];

// [task, owner (null = shared), local date, local hour, target, criteria]
const CHECKPOINTS: [string, string | null, string, number, number, string][] = [
  ["settings", "jordan", "2026-11-10", 12, 0.4, "Settings page saves preferences"],
  ["checkout", "priya", "2026-11-10", 12, 0.15, "Checkout form renders all card fields"],
  ["api", "alex", "2026-11-11", 12, 0.3, "Charging works end to end in test mode"],
  ["checkout", "priya", "2026-11-12", 12, 0.4, "Checkout form validates and submits"],
  ["api", "alex", "2026-11-13", 12, 0.5, "Refunds work, with tests"],
  ["dashboard", "sam", "2026-11-14", 12, 0.2, "Dashboard shows the payment list"],
  ["history", "alex", "2026-11-19", 12, 0.5, "Payment history endpoint returns paginated results"],
  ["dashboard", null, "2026-12-02", 12, 1, "The full demo runs end to end"],
];

const GRACE_HOURS = 48;
const DEMO_CLOCK = { date: "2026-11-07", hour: 18 }; // Simulate then plays Sun Nov 8 → Sat Nov 14

function discordIdFromArgs(): string | undefined {
  const i = process.argv.indexOf("--discord");
  return (i >= 0 ? process.argv[i + 1] : undefined) ?? process.env.DEMO_DISCORD_ID ?? undefined;
}

/** Whoever ran /link most recently in any project (the presenter, usually). */
async function lastLinkedDiscordId(): Promise<string | undefined> {
  const row = await dbGet<{ discord_id: string }>(
    "SELECT discord_id FROM members WHERE discord_id IS NOT NULL AND project_id != ? ORDER BY seq DESC LIMIT 1",
    DEMO_PROJECT_ID,
  );
  return row?.discord_id;
}

/** Deletes the demo project and everything that belongs to it. */
async function wipeDemoProject(): Promise<void> {
  const checkins = (await dbAll<{ id: string }>("SELECT id FROM checkins WHERE project_id = ?", DEMO_PROJECT_ID)).map((r) => r.id);
  for (const id of checkins) {
    await dbRun("DELETE FROM trace_steps WHERE checkin_id = ?", id);
    await dbRun("DELETE FROM decisions WHERE checkin_id = ?", id);
  }
  for (const table of ["checkins", "llm_calls", "disputes", "judgments", "raw_commits", "checkpoints", "tasks", "members"]) {
    await dbRun(`DELETE FROM ${table} WHERE project_id = ?`, DEMO_PROJECT_ID);
  }
  await dbRun("DELETE FROM projects WHERE id = ?", DEMO_PROJECT_ID);
}

export async function seedDemo(discordId?: string): Promise<{ projectId: string; discordId?: string }> {
  await initDb();
  const presenter = discordId ?? (await lastLinkedDiscordId());
  const specText = readFileSync(resolve(ROOT_DIR, "demo/spec.md"), "utf8");

  await tx(async () => {
    await wipeDemoProject();
    await dbRun(
      "INSERT INTO projects (id, name, repos, deadline, created_at) VALUES (?, ?, ?, ?, ?)",
      DEMO_PROJECT_ID, "PayLite (demo)", JSON.stringify(["demo/paylite"]), "2026-12-04", nowIso(),
    );

    const memberId = new Map<string, string>();
    for (const m of MEMBERS) {
      const created = await insertMember(DEMO_PROJECT_ID, m);
      memberId.set(m.key, created.id);
      if (presenter) await setMemberDiscordId(created.id, presenter);
    }
    const everyone = [...memberId.values()];

    const taskId = (key: string) => `${DEMO_PROJECT_ID}-${key}`;
    for (const t of TASKS) {
      const owner = memberId.get(t.owner)!;
      await upsertTask(DEMO_PROJECT_ID, {
        id: taskId(t.key), title: t.title, description: t.description, points: t.points, ownerId: owner,
        paths: t.paths, tracked: t.tracked, dependsOn: (t.dependsOn ?? []).map(taskId), completion: 0, approvedBy: [owner],
      });
    }
    for (const [i, [task, owner, date, hour, target, criteria]] of CHECKPOINTS.entries()) {
      const ownerId = owner ? memberId.get(owner)! : null;
      const checkpoint: Checkpoint = {
        id: `${DEMO_PROJECT_ID}-cp${i + 1}`, taskId: taskId(task), ownerId, dueAt: zonedInstant(date, hour).toISOString(),
        targetCompletion: target, criteria, status: "pending", approvedBy: ownerId ? [ownerId] : everyone,
      };
      await upsertCheckpoint(DEMO_PROJECT_ID, checkpoint);
    }

    await updateProjectPlanState(DEMO_PROJECT_ID, {
      specText,
      gracePeriodHours: GRACE_HOURS,
      graceApprovedBy: everyone,
      planActive: true,
      planVersion: 1,
      pendingPlan: null,
      demoNow: zonedInstant(DEMO_CLOCK.date, DEMO_CLOCK.hour).toISOString(),
    });
  });
  return { projectId: DEMO_PROJECT_ID, discordId: presenter };
}

// Run directly: `npm run demo:seed`
if (process.argv[1] && resolve(process.argv[1]).replace(/\.ts$/, "") === resolve(ROOT_DIR, "backend/src/demo/seed")) {
  const { projectId, discordId } = await seedDemo(discordIdFromArgs());
  console.log(`Seeded "${projectId}" (PayLite demo): 4 members, approved plan, demo clock at Sat Nov 7 18:00 ${config.timezone}.`);
  console.log(
    discordId
      ? `All four demo members are linked to Discord user ${discordId}, so every demo DM goes to that account.`
      : "No Discord account found: run /link in Discord once (any project), or pass --discord <user-id>, then seed again.",
  );
  console.log(`\nTo open it in the web app (live mode), run this once in the browser console:\n  localStorage.setItem("enforcer:project:live", "${projectId}"); location.reload()`);
  await closeDb();
}
