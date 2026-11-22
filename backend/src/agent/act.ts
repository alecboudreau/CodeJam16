// Step 5, act (owner: Person A). README §2.3, §2.7.
// For each decision that sends something: the small model writes the wording, discord/notify.ts
// delivers it, and the decision is marked sent. Nothing here decides whether to send.
import { NudgeLlmOutput } from "@enforcer/shared";
import type { Member } from "@enforcer/shared";
import { getCheckpoint, getMembers, getTask, markDecisionSent } from "../db/db";
import { callSmall } from "../llm/client";
import { buildNudgePrompt, type NudgeInput } from "../llm/prompts/nudge";
import type { StoredDecision } from "./decide";

/**
 * What act needs from Person C's discord/notify.ts (#32):
 *   export async function notify(member: Member | null, message: string, opts: NotifyOptions): Promise<void>
 * `member` null = post in the group channel. `buttons` = add On it / Blocked / Need help for that checkpoint.
 * It should throw if the message couldn't be delivered.
 */
export interface NotifyOptions {
  buttons?: { checkpointId: string };
}
export type Notify = (member: Member | null, message: string, opts: NotifyOptions) => Promise<void>;

/** Resolves discord/notify.ts's `notify`, or undefined while it isn't built yet. */
async function defaultNotify(): Promise<Notify | undefined> {
  try {
    const mod = (await import("../discord/notify")) as { notify?: Notify };
    return typeof mod.notify === "function" ? mod.notify : undefined;
  } catch {
    return undefined;
  }
}

export interface ActResult {
  sent: string[];
  notSent: string[];
}

const SENDING = new Set(["nudge", "nudge_blocker", "help_post", "team_alert"]);

export async function act(opts: {
  projectId: string;
  checkinId: string;
  decisions: StoredDecision[];
  now: Date;
  notify?: Notify;
}): Promise<ActResult> {
  const { projectId, checkinId, now } = opts;
  const members = new Map((await getMembers(projectId)).map((m) => [m.id, m]));
  const notify = opts.notify ?? (await defaultNotify());
  const result: ActResult = { sent: [], notSent: [] };

  for (const d of opts.decisions.filter((x) => SENDING.has(x.action))) {
    const checkpoint = d.checkpointId ? await getCheckpoint(d.checkpointId) : undefined;
    const task = checkpoint ? await getTask(checkpoint.taskId) : undefined;
    if (!checkpoint || !task) {
      result.notSent.push(`${d.action}: checkpoint no longer exists`);
      continue;
    }
    // Whose checkpoint it is (for blocker DMs, the one who's waiting).
    const ownerId = checkpoint.ownerId ?? task.ownerId;
    const owner = members.get(ownerId);
    const recipient = d.memberId ? members.get(d.memberId) : undefined;
    const ownerName = owner?.name ?? "a teammate";
    const base = { taskTitle: task.title, criteria: checkpoint.criteria };

    let input: NudgeInput;
    let to: Member | null;
    let buttons: NotifyOptions["buttons"];
    let label: string;
    switch (d.action) {
      case "nudge": {
        const hoursLeft = checkpoint.graceEndsAt
          ? Math.max(0, Math.round((new Date(checkpoint.graceEndsAt).getTime() - now.getTime()) / 3600_000))
          : 0;
        input = { kind: "dm", memberName: recipient?.name ?? ownerName, ...base, hoursOfGraceLeft: hoursLeft, teamAlerted: checkpoint.status === "alerted" };
        to = recipient ?? null;
        buttons = { checkpointId: checkpoint.id };
        label = `DM to ${recipient?.name}`;
        break;
      }
      case "nudge_blocker":
        input = { kind: "blocker_dm", memberName: recipient?.name ?? "a teammate", waitingName: ownerName, ...base };
        to = recipient ?? null;
        label = `blocker DM to ${recipient?.name}`;
        break;
      case "help_post":
        input = { kind: "help_post", memberName: recipient?.name ?? ownerName, ...base };
        to = null;
        label = `help post for ${recipient?.name ?? ownerName}`;
        break;
      default:
        input = { kind: "team_alert", memberName: ownerName, ...base };
        to = null;
        label = `team alert on '${checkpoint.criteria}'`;
    }

    let message: string;
    try {
      const { system, user } = buildNudgePrompt(input);
      message = (await callSmall({ purpose: "nudge", projectId, checkinId, system, user, schema: NudgeLlmOutput })).message;
    } catch (e) {
      result.notSent.push(`${label}: wording failed (${(e as Error).message})`);
      continue;
    }

    // The in-app Inbox (#59) always gets the message, so it counts as sent (and starts the cooldown)
    // even when Discord can't deliver it. Discord is tried on top; discordSent records whether it got there.
    let discordSent = false;
    let discordProblem = "";
    if (!notify) discordProblem = "Discord isn't set up yet";
    else if (to !== null && !to?.discordId) discordProblem = "hasn't linked Discord";
    else {
      try {
        await notify(to, message, { buttons });
        discordSent = true;
      } catch (e) {
        discordProblem = `Discord delivery failed (${(e as Error).message})`;
      }
    }
    await markDecisionSent(d.id, message, now.toISOString(), discordSent); // the check-in's clock, so cooldowns work on the demo clock
    if (discordSent) result.sent.push(label);
    else result.notSent.push(`${label}: Inbox only, ${discordProblem}`);
  }
  return result;
}
