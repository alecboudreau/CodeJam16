// "Simulate 1 week" (owner: Person C, C7). README §15.
// Advances projects.demo_now day by day on the real schedule (extra check-ins at 00:00, 06:00 and
// 12:00, the daily one at 18:00, in config.timezone). Each day's commits from demo/commits-week2.json
// are delivered at that day's 18:00 check-in.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, ROOT_DIR } from "../config";
import { getCheckin, getProject, getProjectPlanState, insertRawCommit, updateProjectPlanState } from "../db/db";
import type { Notify } from "../agent/act";
import { runCheckin } from "../agent/loop";

export const WEEK2_PATH = resolve(ROOT_DIR, "demo/commits-week2.json");

interface ReplayCommit {
  sha: string;
  authorLogin: string;
  coAuthors: string[];
  message: string;
  committedAt: string;
  files: string[];
  diff: string;
}

const EXTRA_HOURS = [0, 6, 12];
const DAILY_HOUR = 18;

export function loadWeek2(path = WEEK2_PATH): ReplayCommit[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as ReplayCommit[];
  return raw.sort((a, b) => a.committedAt.localeCompare(b.committedAt));
}

/** Offset (ms) of `timeZone` from UTC at instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant of `hour`:00 local time on local date `ymd` ("2026-11-09") in `timeZone`. */
export function zonedInstant(ymd: string, hour: number, timeZone = config.timezone): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return new Date(guess - zoneOffsetMs(first, timeZone)); // second pass handles DST edges
}

/** Local calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function localDate(at: Date, timeZone = config.timezone): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

const nextDay = (ymd: string): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export interface SimulateResult {
  /** The last daily check-in: what the Trace page opens. */
  checkinId: string;
  days: string[];
  checkins: number;
  skipped: number;
  commitsFed: number;
}

const simulating = new Set<string>();
export const isSimulating = (projectId: string): boolean => simulating.has(projectId);

/**
 * Runs `days` simulated days. Starts on the day of the first replay commit, or the day after the
 * demo clock if a simulation already ran, so pressing Simulate again continues the story.
 */
export async function simulateDays(projectId: string, days: number, opts: { notify?: Notify; commits?: ReplayCommit[]; discord?: boolean } = {}): Promise<SimulateResult> {
  const project = await getProject(projectId);
  if (!project) throw new Error("project not found");
  if (simulating.has(projectId)) throw new Error("a simulation is already running for this project");
  simulating.add(projectId);
  try {
    const commits = opts.commits ?? loadWeek2();
    const repo = project.repos[0] ?? "demo/paylite";
    const demoNow = (await getProjectPlanState(projectId))?.demoNow;
    let day = demoNow ? nextDay(localDate(new Date(demoNow))) : localDate(new Date(commits[0]?.committedAt ?? Date.now()));

    const result: SimulateResult = { checkinId: "", days: [], checkins: 0, skipped: 0, commitsFed: 0 };
    for (let i = 0; i < days; i++, day = nextDay(day)) {
      result.days.push(day);
      const slots = [...EXTRA_HOURS.map((h) => ({ h, kind: "extra" as const })), { h: DAILY_HOUR, kind: "simulate" as const }];
      for (const slot of slots) {
        const at = zonedInstant(day, slot.h);
        // Each day's commits arrive at the 18:00 check-in, so every daily trace tells the whole day.
        // Extra check-ins still run (or skip) on the real deadline rule; they just get no new commits.
        for (const c of slot.kind === "simulate" ? commits : []) {
          if (new Date(c.committedAt) > at) break;
          if (await insertRawCommit(projectId, { sha: c.sha, repo, authorLogin: c.authorLogin, coAuthors: c.coAuthors, message: c.message, committedAt: c.committedAt, files: c.files, diff: c.diff })) {
            result.commitsFed++;
          }
        }
        await updateProjectPlanState(projectId, { demoNow: at.toISOString() });
        const checkinId = await runCheckin(projectId, { kind: slot.kind, skipGitHub: true, notify: opts.notify, discord: opts.discord });
        result.checkins++;
        if ((await getCheckin(checkinId))?.skipped) result.skipped++;
        if (slot.kind === "simulate") result.checkinId = checkinId;
      }
    }
    return result;
  } finally {
    simulating.delete(projectId);
  }
}
