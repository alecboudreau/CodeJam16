// Local dev only: the always-on Discord connection that *receives* /link and button presses
// (owner: Person C). Sending (DMs, channel posts) goes through rest.ts and works everywhere.
// On Vercel there's no long-running process; Discord POSTs interactions to /api/discord/interactions.
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { config } from "../config";
import { handleInteraction, registerCommands } from "./interactions";

let ready: Promise<Client> | undefined;

export const discordConfigured = (): boolean => Boolean(config.discordBotToken);

/** Logs the bot in and registers /link. Does nothing (with a log line) when no token is configured. */
export function startBot(): Promise<Client> | undefined {
  if (!discordConfigured()) {
    console.log("discord: DISCORD_BOT_TOKEN not set, bot not started");
    return undefined;
  }
  if (ready) return ready;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel], // needed to receive interactions in DMs
  });
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((e) => console.error("discord: interaction failed", e));
  });

  ready = new Promise<Client>((resolve, reject) => {
    client.once(Events.ClientReady, async (logged) => {
      console.log(`discord: logged in as ${logged.user.tag}`);
      try {
        await registerCommands();
      } catch (e) {
        console.error("discord: couldn't register /link", e);
      }
      resolve(client);
    });
    client.login(config.discordBotToken).catch(reject);
  });
  return ready;
}
