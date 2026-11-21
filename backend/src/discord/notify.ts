// notify(member, message, { buttons }) (owner: Person C). Called by agent/act.ts (#12).
// member = null → post in the group channel. Throws if the message couldn't be delivered.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { Member } from "@enforcer/shared";
import { postToChannel, sendDM } from "./bot";

export interface NotifyOptions {
  /** Add On it / Blocked / Need help under the DM, for this checkpoint. */
  buttons?: { checkpointId: string };
}

/** Button ids carry who the DM was for: `status:<action>:<memberId>`. */
export const statusButtonId = (action: "on_it" | "blocked" | "need_help", memberId: string) => `status:${action}:${memberId}`;

export function statusButtons(memberId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(statusButtonId("on_it", memberId)).setLabel("On it").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(statusButtonId("blocked", memberId)).setLabel("Blocked").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(statusButtonId("need_help", memberId)).setLabel("Need help").setStyle(ButtonStyle.Primary),
  );
}

export async function notify(member: Member | null, message: string, opts: NotifyOptions = {}): Promise<void> {
  if (member === null) {
    await postToChannel(message);
    return;
  }
  if (!member.discordId) throw new Error(`${member.name} hasn't linked Discord`);
  await sendDM(member.discordId, {
    content: message,
    components: opts.buttons ? [statusButtons(member.id)] : [],
  });
}
