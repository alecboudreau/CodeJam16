// Local dev only: turns interactions from the always-on bot connection into the shared handler.
// On Vercel, Discord POSTs them to /api/discord/interactions instead (routes/discord.ts).
import { MessageFlags, type Interaction } from "discord.js";
import { handleInteractionInput, type InteractionInput } from "./handlers";

export { registerCommands } from "./rest";

export async function handleInteraction(interaction: Interaction): Promise<void> {
  let input: InteractionInput | undefined;
  if (interaction.isChatInputCommand()) {
    const options: Record<string, string> = {};
    for (const o of interaction.options.data) if (typeof o.value === "string") options[o.name] = o.value;
    input = { kind: "command", name: interaction.commandName, options, userId: interaction.user.id };
  } else if (interaction.isButton()) {
    input = { kind: "button", customId: interaction.customId, userId: interaction.user.id };
  } else if (interaction.isStringSelectMenu()) {
    input = { kind: "select", customId: interaction.customId, values: interaction.values, userId: interaction.user.id };
  }
  if (!input) return;

  const reply = await handleInteractionInput(input);
  if (!reply || !interaction.isRepliable()) return;
  const payload = { content: reply.content, components: reply.components as never };
  if (reply.type === "update" && (interaction.isButton() || interaction.isStringSelectMenu())) {
    await interaction.update(payload);
  } else {
    await interaction.reply({ ...payload, ...(reply.ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
  }
}
