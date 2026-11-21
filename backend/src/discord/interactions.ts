// /link command, DM buttons and the "blocked by" menu (owner: Person C). README §2.1, §2.7.
import {
  ActionRowBuilder,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Interaction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { MemberStatus } from "@enforcer/shared";
import { config, rules } from "../config";
import { getMember, getMemberProjectId, getMembers, linkDiscord, setMemberStatus } from "../db/db";

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

const BLOCKED_BY_MENU = "blockedby";

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
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith("status:")) {
    await onStatusButton(interaction);
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${BLOCKED_BY_MENU}:`)) {
    await onBlockedBy(interaction);
  }
}

/** The member a button or menu was for, only if the person pressing it is that member. */
function memberFor(memberId: string, discordUserId: string) {
  const member = getMember(memberId);
  return member && member.discordId === discordUserId ? member : undefined;
}

// On it / Blocked / Need help
async function onStatusButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, memberId] = interaction.customId.split(":") as [string, MemberStatus, string];
  const member = memberFor(memberId, interaction.user.id);
  if (!member) {
    await interaction.reply({ content: "These buttons are for someone else's reminder.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "blocked") {
    const projectId = getMemberProjectId(member.id);
    const teammates = projectId ? getMembers(projectId).filter((m) => m.id !== member.id) : [];
    if (teammates.length === 0) {
      await interaction.reply({ content: "There's no teammate to pick. Try **Need help** instead." });
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${BLOCKED_BY_MENU}:${member.id}`)
      .setPlaceholder("Who are you waiting on?")
      .addOptions(teammates.slice(0, 25).map((m) => ({ label: m.name, value: m.id })));
    await interaction.reply({
      content: "Who are you waiting on?",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
    return;
  }

  if (action === "on_it" || action === "need_help") {
    setMemberStatus(member.id, action);
    await interaction.reply({
      content:
        action === "on_it"
          ? `Great, thanks! No more reminders for ${rules.NUDGE_COOLDOWN_DAYS} days. (This doesn't move the grace period.)`
          : "Got it. I'll ask the team if someone can pair with you on this.",
    });
  }
}

// Blocked → who
async function onBlockedBy(interaction: StringSelectMenuInteraction): Promise<void> {
  const memberId = interaction.customId.split(":")[1];
  const member = memberFor(memberId, interaction.user.id);
  const blockerId = interaction.values[0];
  const blocker = blockerId ? getMember(blockerId) : undefined;
  if (!member || !blocker || getMemberProjectId(blocker.id) !== getMemberProjectId(member.id)) {
    await interaction.reply({ content: "That didn't work. Please press **Blocked** again.", flags: MessageFlags.Ephemeral });
    return;
  }
  setMemberStatus(member.id, "blocked", blocker.id);
  await interaction.update({
    content: `Thanks. Your reminders and grace clock are paused, and I'll let ${blocker.name} know you're waiting on them.`,
    components: [],
  });
}
