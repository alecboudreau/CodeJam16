// notify(member, message, { buttons }) (owner: Person C). Called by agent/act.ts (#12).
// member = null → post in the group channel. Throws if the message couldn't be delivered.
import type { Member } from "@enforcer/shared";
import { z } from "zod";
import { config } from "../config";
import { statusButtons } from "./handlers";
import { postToChannel, sendDM } from "./rest";

export interface NotifyOptions {
  /** Add On it / Blocked / Need help under the DM, for this checkpoint. */
  buttons?: { checkpointId: string };
}

export async function notify(member: Member | null, message: string, opts: NotifyOptions = {}): Promise<"discord" | "email"> {
  if (member === null) {
    await postToChannel({ content: message });
    return "discord";
  }
  if (member.discordId) {
    await sendDM(member.discordId, { content: message, components: opts.buttons ? statusButtons(member.id) : [] });
    return "discord";
  }
  if (!member.email) throw new Error(`${member.name} hasn't linked Discord or provided an email`);
  if (!z.string().email().safeParse(member.email).success) throw new Error("The member's email address is invalid");
  if (!config.resendApiKey || !config.emailFrom) throw new Error("Email isn't configured (RESEND_API_KEY / EMAIL_FROM)");
  const inboxUrl = new URL("/inbox", config.frontendUrl);
  if (!["https:", "http:"].includes(inboxUrl.protocol)) throw new Error("FRONTEND_URL must be an HTTP(S) app URL");
  const responseHint = opts.buttons
    ? "Sign in to the app, open your project, and use Inbox to respond: On it, Blocked, or Need help."
    : "Sign in to the app and open your project's Inbox to view this reminder.";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [member.email], // Private: never send a reminder to the rest of the team.
      subject: "Project checkpoint reminder",
      text: `${message}\n\n${responseHint}\n${inboxUrl.href}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  // Don't include provider response bodies in traces: they can echo personal data or credentials.
  if (!res.ok) throw new Error(`Email delivery failed (${res.status})`);
  const receipt: unknown = await res.json();
  if (!z.object({ id: z.string().min(1) }).safeParse(receipt).success) throw new Error("Email provider did not acknowledge the message");
  return "email";
}
