// Env loading (owner: Person A). Reads the root .env.
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: resolve(ROOT_DIR, ".env") });

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databasePath: resolve(ROOT_DIR, process.env.DATABASE_PATH ?? "./data/enforcer.db"),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  smallModel: process.env.SMALL_MODEL ?? "claude-haiku-5-5",
  bigModel: process.env.BIG_MODEL ?? "claude-sonnet-5-5",
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
  discordGroupChannelId: process.env.DISCORD_GROUP_CHANNEL_ID ?? "",
};
