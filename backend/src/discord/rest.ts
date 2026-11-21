// Discord's HTTP API (owner: Person C). Sending DMs and channel posts needs no open connection,
// so it works the same on Vercel and locally.
import { config } from "../config";

const API = "https://discord.com/api/v10";

export interface DiscordMessage {
  content: string;
  components?: unknown[];
}

async function discord<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!config.discordBotToken) throw new Error("Discord isn't configured (DISCORD_BOT_TOKEN)");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${config.discordBotToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord ${method} ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Sends a private message. Throws if the user can't be reached (e.g. DMs closed). */
export async function sendDM(discordId: string, message: DiscordMessage): Promise<void> {
  const channel = await discord<{ id: string }>("POST", "/users/@me/channels", { recipient_id: discordId });
  await discord("POST", `/channels/${channel.id}/messages`, message);
}

/** Posts in the team's group channel (DISCORD_GROUP_CHANNEL_ID). */
export async function postToChannel(message: DiscordMessage): Promise<void> {
  if (!config.discordGroupChannelId) throw new Error("DISCORD_GROUP_CHANNEL_ID isn't set");
  await discord("POST", `/channels/${config.discordGroupChannelId}/messages`, message);
}

/** Registers /link on the team's server (guild commands update instantly). */
export async function registerCommands(): Promise<void> {
  if (!config.discordAppId || !config.discordGuildId) {
    console.log("discord: DISCORD_APP_ID / DISCORD_GUILD_ID not set, /link not registered");
    return;
  }
  await discord("PUT", `/applications/${config.discordAppId}/guilds/${config.discordGuildId}/commands`, [
    {
      name: "link",
      description: "Connect your Discord account to the project (and opt in to reminders)",
      options: [{ type: 3, name: "github-username", description: "Your GitHub username", required: true }],
    },
  ]);
  console.log("discord: /link registered");
}
