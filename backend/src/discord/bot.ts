// Discord bot: login, sendDM(), postToChannel() (owner: Person C). README §2.1, §6.
import { Client, Events, GatewayIntentBits, Partials, type MessageCreateOptions } from "discord.js";
import { config } from "../config";
import { handleInteraction, registerCommands } from "./interactions";

let client: Client | undefined;
let ready: Promise<Client> | undefined;

export const discordConfigured = (): boolean => Boolean(config.discordBotToken);

/** Logs the bot in and registers /link. Does nothing (with a log line) when no token is configured. */
export function startBot(): Promise<Client> | undefined {
  if (!discordConfigured()) {
    console.log("discord: DISCORD_BOT_TOKEN not set, bot not started");
    return undefined;
  }
  if (ready) return ready;

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel], // needed to receive interactions in DMs
  });
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((e) => console.error("discord: interaction failed", e));
  });

  const c = client;
  ready = new Promise<Client>((resolve, reject) => {
    c.once(Events.ClientReady, async (logged) => {
      console.log(`discord: logged in as ${logged.user.tag}`);
      try {
        await registerCommands();
      } catch (e) {
        console.error("discord: couldn't register /link", e);
      }
      resolve(c);
    });
    c.login(config.discordBotToken).catch(reject);
  });
  return ready;
}

async function getClient(): Promise<Client> {
  const r = startBot();
  if (!r) throw new Error("Discord isn't configured (DISCORD_BOT_TOKEN)");
  return r;
}

/** Sends a private message. Throws if the user can't be reached (e.g. DMs closed). */
export async function sendDM(discordId: string, message: string | MessageCreateOptions): Promise<void> {
  const c = await getClient();
  const user = await c.users.fetch(discordId);
  await user.send(message);
}

/** Posts in the team's group channel (DISCORD_GROUP_CHANNEL_ID). */
export async function postToChannel(message: string | MessageCreateOptions): Promise<void> {
  if (!config.discordGroupChannelId) throw new Error("DISCORD_GROUP_CHANNEL_ID isn't set");
  const c = await getClient();
  const channel = await c.channels.fetch(config.discordGroupChannelId);
  if (!channel || !channel.isSendable()) throw new Error("the group channel can't be posted to");
  await channel.send(message);
}
