// What the bot does when someone uses /link, presses a reminder button or picks who blocks them
// (owner: Person C). Plain data in, plain reply out, so the same logic serves both the HTTP
// interactions endpoint (Vercel) and the always-on bot connection (local dev). README §2.1, §2.7.
import { rules } from "../config";
import { getMember, getMemberProjectId, getMembers, linkDiscord, setMemberStatus } from "../db/db";

export type InteractionInput =
  | { kind: "command"; name: string; options: Record<string, string>; userId: string }
  | { kind: "button"; customId: string; userId: string }
  | { kind: "select"; customId: string; values: string[]; userId: string };

/** `reply` = a new message (private when `ephemeral`); `update` = replace the message that was clicked. */
export interface InteractionReply {
  type: "reply" | "update";
  content: string;
  components?: unknown[];
  ephemeral?: boolean;
}

// Raw Discord component JSON (types: 1 row, 2 button, 3 string select; button styles: 1 primary, 2 secondary, 3 success).
export const statusButtonId = (action: "on_it" | "blocked" | "need_help", memberId: string) => `status:${action}:${memberId}`;

export function statusButtons(memberId: string): unknown[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "On it", custom_id: statusButtonId("on_it", memberId) },
        { type: 2, style: 2, label: "Blocked", custom_id: statusButtonId("blocked", memberId) },
        { type: 2, style: 1, label: "Need help", custom_id: statusButtonId("need_help", memberId) },
      ],
    },
  ];
}

const BLOCKED_BY_MENU = "blockedby";

/** The member a button or menu was for, only if the person pressing it is that member. */
async function memberFor(memberId: string, discordUserId: string) {
  const member = await getMember(memberId);
  return member && member.discordId === discordUserId ? member : undefined;
}

export async function handleInteractionInput(input: InteractionInput): Promise<InteractionReply | null> {
  if (input.kind === "command" && input.name === "link") {
    const username = (input.options["github-username"] ?? "").trim().replace(/^@/, "");
    const linked = await linkDiscord(username, input.userId);
    return {
      type: "reply",
      ephemeral: true,
      content:
        linked > 0
          ? `Linked! You'll get private reminders about your own checkpoints here. (GitHub: ${username})`
          : `No teammate with the GitHub username "${username}" is in a project yet. Check the spelling, or ask whoever set up the project to add you.`,
    };
  }

  if (input.kind === "button" && input.customId.startsWith("status:")) {
    const [, action, memberId] = input.customId.split(":");
    const member = await memberFor(memberId, input.userId);
    if (!member) return { type: "reply", ephemeral: true, content: "These buttons are for someone else's reminder." };

    if (action === "blocked") {
      const projectId = await getMemberProjectId(member.id);
      const teammates = projectId ? (await getMembers(projectId)).filter((m) => m.id !== member.id) : [];
      if (teammates.length === 0) return { type: "reply", content: "There's no teammate to pick. Try **Need help** instead." };
      return {
        type: "reply",
        content: "Who are you waiting on?",
        components: [
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `${BLOCKED_BY_MENU}:${member.id}`,
                placeholder: "Who are you waiting on?",
                options: teammates.slice(0, 25).map((m) => ({ label: m.name, value: m.id })),
              },
            ],
          },
        ],
      };
    }
    if (action === "on_it" || action === "need_help") {
      await setMemberStatus(member.id, action);
      return {
        type: "reply",
        content:
          action === "on_it"
            ? `Great, thanks! No more reminders for ${rules.NUDGE_COOLDOWN_DAYS} days. (This doesn't move the grace period.)`
            : "Got it. I'll ask the team if someone can pair with you on this.",
      };
    }
    return null;
  }

  if (input.kind === "select" && input.customId.startsWith(`${BLOCKED_BY_MENU}:`)) {
    const memberId = input.customId.split(":")[1];
    const member = await memberFor(memberId, input.userId);
    const blocker = input.values[0] ? await getMember(input.values[0]) : undefined;
    if (!member || !blocker || (await getMemberProjectId(blocker.id)) !== (await getMemberProjectId(member.id))) {
      return { type: "reply", ephemeral: true, content: "That didn't work. Please press **Blocked** again." };
    }
    await setMemberStatus(member.id, "blocked", blocker.id);
    return {
      type: "update",
      content: `Thanks. Your reminders and grace clock are paused, and I'll let ${blocker.name} know you're waiting on them.`,
      components: [],
    };
  }
  return null;
}
