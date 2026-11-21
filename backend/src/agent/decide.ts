// Decide rules (owner: Person A). README §2.7 and §10 Steps B + C.
// Plain code only: no model decides anything. The small model later writes the wording (act.ts).
import type { Checkpoint, Decision, Member, Task } from "@enforcer/shared";
import { rules } from "../config";
import {
  getCheckpoints,
  getLastCompletedCheckin,
  getMembers,
  getOpenDisputeCheckpointIds,
  getSentDecisions,
  getTasks,
  insertDecision,
  setMemberStatus,
  tx,
  upsertCheckpoint,
} from "../db/db";

export interface StoredDecision extends Decision {
  id: string;
}

const DAY_MS = 24 * 3600_000;
const DM_ACTIONS = new Set<Decision["action"]>(["nudge", "nudge_blocker"]);

/** Runs Steps B and C for one check-in, stores every decision, and returns them (act sends them). */
export function decide(projectId: string, checkinId: string, now: Date): StoredDecision[] {
  const members = getMembers(projectId);
  const tasks = new Map<string, Task>(getTasks(projectId).map((t) => [t.id, t]));
  const memberById = new Map<string, Member>(members.map((m) => [m.id, m]));
  const disputed = getOpenDisputeCheckpointIds(projectId);
  const nowMs = now.getTime();
  const cooldownMs = rules.NUDGE_COOLDOWN_DAYS * DAY_MS;

  // The previous check-in (this one isn't finished yet): used for the grace pause and "pressed since".
  const lastCheckinMs = (() => {
    const last = getLastCompletedCheckin(projectId);
    const t = last ? new Date(last.startedAt).getTime() : nowMs;
    return t < nowMs ? t : nowMs;
  })();

  // Last private DM per member, for the cooldown.
  const lastDmMs = new Map<string, number>();
  for (const d of getSentDecisions(projectId)) {
    if (d.memberId && d.sentAt && DM_ACTIONS.has(d.action)) {
      lastDmMs.set(d.memberId, Math.max(lastDmMs.get(d.memberId) ?? 0, new Date(d.sentAt).getTime()));
    }
  }
  const inCooldown = (memberId: string) => nowMs - (lastDmMs.get(memberId) ?? -Infinity) < cooldownMs;

  const responsibleFor = (c: Checkpoint) => c.ownerId ?? tasks.get(c.taskId)?.ownerId ?? "";
  const label = (c: Checkpoint) => `'${c.criteria}' (${tasks.get(c.taskId)?.title ?? "task"})`;
  const name = (id: string) => memberById.get(id)?.name ?? "someone";

  const open = getCheckpoints(projectId)
    .filter((c) => c.status === "missed" || c.status === "alerted")
    .sort((a, b) => new Date(a.graceEndsAt ?? a.dueAt).getTime() - new Date(b.graceEndsAt ?? b.dueAt).getTime());

  const decisions: Decision[] = [];
  const handled = new Set<string>(); // checkpoint ids handled in Step B (dispute or blocked)
  const blockerNudged = new Set<string>();
  const helpPosted = new Set<string>();

  return tx(() => {
    // ---------- Step B: per missed / alerted checkpoint ----------
    for (const c of open) {
      const who = responsibleFor(c);
      const member = memberById.get(who);

      // 1. open dispute
      if (disputed.has(c.id)) {
        decisions.push({ memberId: who, checkpointId: c.id, action: "wait", reason: `${label(c)}: dispute open, alerts paused` });
        handled.add(c.id);
        continue;
      }

      // 2. blocked: pause the grace clock, nudge the blocker
      if (member?.status === "blocked" && member.blockedById) {
        if (c.status === "missed" && c.graceEndsAt) {
          const paused = new Date(new Date(c.graceEndsAt).getTime() + (nowMs - lastCheckinMs)).toISOString();
          upsertCheckpoint(projectId, { ...c, graceEndsAt: paused });
          c.graceEndsAt = paused;
        }
        decisions.push({ memberId: who, checkpointId: c.id, action: "wait", reason: `${name(who)} blocked by ${name(member.blockedById)} on ${label(c)}: grace clock paused` });
        const blocker = member.blockedById;
        if (!blockerNudged.has(blocker)) {
          blockerNudged.add(blocker);
          decisions.push(
            inCooldown(blocker)
              ? { memberId: blocker, checkpointId: c.id, action: "none", reason: `${name(who)} is waiting on ${name(blocker)}, but ${name(blocker)} was reminded recently` }
              : { memberId: blocker, checkpointId: c.id, action: "nudge_blocker", reason: `${name(who)} is waiting on ${name(blocker)} for ${label(c)}` },
          );
        }
        handled.add(c.id);
        continue;
      }

      // 3. "Need help" pressed since the last check-in: one help post per member
      if (member?.status === "need_help" && member.statusAt && new Date(member.statusAt).getTime() >= lastCheckinMs && !helpPosted.has(who)) {
        helpPosted.add(who);
        decisions.push({ memberId: who, checkpointId: c.id, action: "help_post", reason: `${name(who)} asked for help on ${label(c)}` });
        setMemberStatus(who, "none");
        member.status = "none";
      }

      // 4. grace expired → one team alert
      if (c.status === "missed" && c.graceEndsAt && nowMs >= new Date(c.graceEndsAt).getTime()) {
        upsertCheckpoint(projectId, { ...c, status: "alerted" });
        c.status = "alerted";
        decisions.push({ memberId: null, checkpointId: c.id, action: "team_alert", reason: `${label(c)} still unmet after the grace period` });
      }
    }

    // ---------- Step C: per member, one reminder at most ----------
    const remindable = new Map<string, Checkpoint>(); // member → checkpoint whose grace ends first
    for (const c of open) {
      if (handled.has(c.id)) continue;
      const who = responsibleFor(c);
      if (!remindable.has(who)) remindable.set(who, c); // `open` is sorted by grace end
    }

    for (const m of members) {
      const c = remindable.get(m.id);
      if (!c) {
        const waiting = open.some((x) => handled.has(x.id) && responsibleFor(x) === m.id) || blockerNudged.has(m.id);
        if (!waiting) decisions.push({ memberId: m.id, checkpointId: null, action: "none", reason: `${m.name}: no missed checkpoints` });
        continue;
      }
      const onIt = m.status === "on_it" && m.statusAt && nowMs - new Date(m.statusAt).getTime() < cooldownMs;
      if (onIt) {
        decisions.push({ memberId: m.id, checkpointId: c.id, action: "wait", reason: `${m.name} pressed "On it" for ${label(c)}` });
      } else if (blockerNudged.has(m.id) || helpPosted.has(m.id)) {
        // Already contacted this check-in (blocker DM, or they just asked for help): one message is enough.
        const why = blockerNudged.has(m.id) ? "already nudged as a blocker" : "help post sent";
        decisions.push({ memberId: m.id, checkpointId: c.id, action: "none", reason: `${m.name}: ${label(c)} missed, ${why} this check-in` });
      } else if (inCooldown(m.id)) {
        decisions.push({ memberId: m.id, checkpointId: c.id, action: "none", reason: `${m.name}: ${label(c)} missed, reminded recently` });
      } else {
        const hoursLeft = c.graceEndsAt ? Math.max(0, Math.round((new Date(c.graceEndsAt).getTime() - nowMs) / 3600_000)) : 0;
        decisions.push({
          memberId: m.id,
          checkpointId: c.id,
          action: "nudge",
          reason: `${label(c)} missed, ${c.status === "alerted" ? "team already alerted" : `${hoursLeft}h of grace left`}`,
        });
      }
    }

    return decisions.map((d) => ({ ...d, id: insertDecision(checkinId, d) }));
  });
}
