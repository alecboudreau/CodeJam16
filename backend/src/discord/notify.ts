// notify(member, message, { buttons }) (owner: Person C). Called by agent/act.ts (#12).
// member = null → post in the group channel. Throws if the message couldn't be delivered.
import type { Member } from "@enforcer/shared";
import { statusButtons } from "./handlers";
import { postToChannel, sendDM } from "./rest";

export interface NotifyOptions {
  /** Add On it / Blocked / Need help under the DM, for this checkpoint. */
  buttons?: { checkpointId: string };
}

export async function notify(member: Member | null, message: string, opts: NotifyOptions = {}): Promise<void> {
  if (member === null) {
    await postToChannel({ content: message });
    return;
  }
  if (!member.discordId) throw new Error(`${member.name} hasn't linked Discord`);
  await sendDM(member.discordId, { content: message, components: opts.buttons ? statusButtons(member.id) : [] });
}
