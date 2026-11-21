// Env loading + tunable agent constants (owner: Person A). Reads the root .env. See README section 10.
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
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "", // Should: push webhooks only
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  smallModel: process.env.SMALL_MODEL ?? "claude-haiku-5-5",
  bigModel: process.env.BIG_MODEL ?? "claude-sonnet-5-5",
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
  discordAppId: process.env.DISCORD_APP_ID ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  discordGroupChannelId: process.env.DISCORD_GROUP_CHANNEL_ID ?? "",
  timezone: process.env.TZ ?? "America/Toronto",
};

// Agent rules (README section 10). Tune here, nowhere else.
export const rules = {
  BEHIND_CLOCK_THRESHOLD: 0.25,   // progress more than 25 pts below time elapsed
  QUIET_DAYS: 5,                  // no substantial commit for 5 days
  NUDGE_COOLDOWN_DAYS: 2,         // max one nudge per person per 2 days; "On it" lasts this long
  IGNORED_DMS_BEFORE_GROUP: 2,    // 2 ignored DMs → group post
  CHECKIN_CRON: "0 18 * * *",     // daily at 6 pm (in config.timezone)
  LIGHT_CAP: 0.1,                 // light changes count for at most 10% of their estimate
  ESCALATE_BELOW: 0.6,            // re-judge with the big model below this confidence
} as const;
