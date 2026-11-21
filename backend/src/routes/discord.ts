// POST /api/discord/interactions (owner: Person C). Discord sends /link and button presses here
// when the app's "Interactions Endpoint URL" points at it. Every request is Ed25519-signed by
// Discord; anything that doesn't verify against DISCORD_PUBLIC_KEY is rejected.
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { Router, type Request } from "express";
import { config } from "../config";
import { handleInteractionInput, type InteractionInput } from "../discord/handlers";

export const discordRouter = Router();

let publicKey: KeyObject | undefined;
function discordKey(): KeyObject {
  // Discord gives a 32-byte Ed25519 key as hex; wrap it as a JWK so Node can verify with it.
  publicKey ??= createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(config.discordPublicKey, "hex").toString("base64url") },
    format: "jwk",
  });
  return publicKey;
}

export function verifyDiscordSignature(rawBody: Buffer, signature: string, timestamp: string): boolean {
  if (!config.discordPublicKey || !signature || !timestamp) return false;
  try {
    return verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), discordKey(), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

interface RawInteraction {
  type: number; // 1 ping, 2 slash command, 3 component
  data?: { name?: string; options?: { name: string; value: unknown }[]; custom_id?: string; component_type?: number; values?: string[] };
  user?: { id: string };
  member?: { user?: { id: string } };
}

discordRouter.post("/discord/interactions", (req: Request & { rawBody?: Buffer }, res, next) => {
  const ok = verifyDiscordSignature(
    req.rawBody ?? Buffer.alloc(0),
    String(req.headers["x-signature-ed25519"] ?? ""),
    String(req.headers["x-signature-timestamp"] ?? ""),
  );
  if (!ok) {
    res.status(401).send("invalid request signature");
    return;
  }

  const i = req.body as RawInteraction;
  if (i.type === 1) {
    res.json({ type: 1 }); // PONG: Discord checks the endpoint with this when you save the URL
    return;
  }
  const userId = i.user?.id ?? i.member?.user?.id ?? "";
  let input: InteractionInput | undefined;
  if (i.type === 2 && i.data?.name) {
    const options: Record<string, string> = {};
    for (const o of i.data.options ?? []) if (typeof o.value === "string") options[o.name] = o.value;
    input = { kind: "command", name: i.data.name, options, userId };
  } else if (i.type === 3 && i.data?.custom_id) {
    input =
      i.data.component_type === 3
        ? { kind: "select", customId: i.data.custom_id, values: i.data.values ?? [], userId }
        : { kind: "button", customId: i.data.custom_id, userId };
  }
  if (!input) {
    res.json({ type: 4, data: { content: "Sorry, I don't know that one.", flags: 64 } });
    return;
  }

  handleInteractionInput(input)
    .then((reply) => {
      if (!reply) {
        res.json({ type: 4, data: { content: "Sorry, I don't know that one.", flags: 64 } });
        return;
      }
      const data = { content: reply.content, components: reply.components ?? [], ...(reply.ephemeral ? { flags: 64 } : {}) };
      res.json({ type: reply.type === "update" ? 7 : 4, data }); // 4 = new message, 7 = update the clicked one
    })
    .catch(next);
});
