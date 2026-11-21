// /link command (owner: Person C). README §2.1: each teammate opts in with `/link <github-username>`.
import { MessageFlags, REST, Routes, SlashCommandBuilder, type Interaction } from "discord.js";
import { config } from "../config";
import { linkDiscord } from "../db/db";

const linkCommand = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Connect your Discord account to the project (and opt in to reminders)")
  .addStringOption((o) => o.setName("github-username").setDescription("Your GitHub username").setRequired(true));

/** Registers /link on the team's server (guild commands update instantly). */
export async function registerCommands(): Promise<void> {
  if (!config.discordAppId || !config.discordGuildId) {
    console.log("discord: DISCORD_APP_ID / DISCORD_GUILD_ID not set, /link not registered");
    return;
  }
  const rest = new REST().setToken(config.discordBotToken);
  await rest.put(Routes.applicationGuildCommands(config.discordAppId, config.discordGuildId), {
    body: [linkCommand.toJSON()],
  });
  console.log("discord: /link registered");
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand() && interaction.commandName === "link") {
    const username = interaction.options.getString("github-username", true).trim().replace(/^@/, "");
    const linked = linkDiscord(username, interaction.user.id);
    await interaction.reply({
      content:
        linked > 0
          ? `Linked! You'll get private reminders about your own checkpoints here. (GitHub: ${username})`
          : `No teammate with the GitHub username "${username}" is in a project yet. Check the spelling, or ask whoever set up the project to add you.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
