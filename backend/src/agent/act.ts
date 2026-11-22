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
 *   notify(member: Member | null, message: string, opts: NotifyOptions): Promise<"discord" | "email">
 * `member` null = post in the group channel. `buttons` = add On it / Blocked / Need help for that checkpoint.
 * Returns the delivery channel (legacy test overrides may return void). Throws on delivery failure.
 */
export interface NotifyOptions {
  buttons?: { checkpointId: string };
}
export type Notify = (member: Member | null, message: string, opts: NotifyOptions) => Promise<void | "discord" | "email">;

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
  /** false = Inbox only; disables both Discord and email (public demo without the presenter key, #76). */
  discord?: boolean;
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
        label = `reminder to ${recipient?.name}`;
        break;
      }
      case "nudge_blocker":
        input = { kind: "blocker_dm", memberName: recipient?.name ?? "a teammate", waitingName: ownerName, ...base };
        to = recipient ?? null;
        label = `blocker reminder to ${recipient?.name}`;
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
    // even when external delivery fails. discordSent records Discord only, never email.
    let discordSent = false;
    let delivered = false;
    let deliveryProblem = "";
    if (opts.discord === false) deliveryProblem = "public demo, external notifications are off without the presenter key";
    else if (!notify) deliveryProblem = "Notifications aren't set up yet";
    else if (to !== null && !to.discordId && !to.email) deliveryProblem = "hasn't linked Discord or provided an email";
    else {
      try {
        const channel = await notify(to, message, { buttons });
        discordSent = channel !== "email";
        delivered = true;
      } catch (e) {
        deliveryProblem = `Notification delivery failed (${(e as Error).message})`;
      }
    }
    await markDecisionSent(d.id, message, now.toISOString(), discordSent); // the check-in's clock, so cooldowns work on the demo clock
    if (delivered) result.sent.push(label);
    else result.notSent.push(`${label}: Inbox only, ${deliveryProblem}`);
  }
  return result;
}
