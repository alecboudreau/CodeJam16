// Env loading + tunable agent constants (owner: Person A). Reads the root .env. See README section 10.
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: resolve(ROOT_DIR, ".env") });

/**
 * The team's time zone for check-in times and the demo clock. APP_TIMEZONE wins, then TZ, but only if
 * it's a real IANA zone: Vercel sets TZ=":UTC" for its servers, which Intl rejects ("Invalid time zone").
 */
function appTimezone(): string {
  for (const candidate of [process.env.APP_TIMEZONE, process.env.TZ]) {
    if (!candidate) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate });
      return candidate;
    } catch {
      /* not a zone name, e.g. ":UTC" */
    }
  }
  return "America/Toronto";
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databasePath: resolve(ROOT_DIR, process.env.DATABASE_PATH ?? "./data/enforcer.db"),
  databaseUrl: process.env.DATABASE_URL ?? "", // Supabase Postgres (transaction pooler)
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
  discordPublicKey: process.env.DISCORD_PUBLIC_KEY ?? "", // verifies /api/discord/interactions
  cronSecret: process.env.CRON_SECRET ?? "", // Supabase pg_cron sends it to /api/cron/*
  demoPresenterKey: process.env.DEMO_PRESENTER_KEY ?? "", // demo check-ins only send Discord messages with it (#76)
  timezone: appTimezone(),
  supabaseUrl: (process.env.SUPABASE_URL ?? "").replace(/\/+$/, ""),
  // Sign-in is on whenever Supabase is configured, unless explicitly disabled (local demo only).
  authDisabled: process.env.AUTH_DISABLED === "true",
};

// Agent rules (README section 10). Tune here, nowhere else.
export const rules = {
  NUDGE_COOLDOWN_DAYS: 2,           // max one reminder per person per 2 days; "On it" lasts this long
  CHECKIN_CRON: "0 18 * * *",       // daily at 6 pm (in config.timezone)
  EXTRA_CHECK_CRON: "0 0,6,12 * * *", // every 6 hours, skipping the 18:00 daily slot
  EXTRA_CHECK_EVERY_HOURS: 6,
  CHECKPOINT_WINDOW_HOURS: 48,      // extra check-ins only run if a checkpoint is due this soon
  DEFAULT_GRACE_PERIOD_HOURS: 48,   // only used if the plan prompt didn't propose one
  LIGHT_CAP: 0.1,                   // light changes count for at most 10% of their estimate
  ESCALATE_BELOW: 0.6,              // re-judge with the big model below this confidence
  DISPUTE_MAX_FILES: 5,             // files fetched for a dispute
  DISPUTE_FILE_MAX_LINES: 200,      // each file trimmed to this many lines
} as const;

// Compute meter constants (README §11). USD per 1M tokens; Wh per token are rough estimates
// (labelled "estimate" in the UI). Unknown model ids are priced as the big model.
export const pricing: Record<string, { inPerM: number; outPerM: number; whPerToken: number }> = {
  "claude-haiku-5-5": { inPerM: 0.1, outPerM: 0.5, whPerToken: 0.00003 },
  "claude-sonnet-5-5": { inPerM: 2, outPerM: 10, whPerToken: 0.0003 },
};

export const meterRules = {
  NAIVE_OUTPUT_TOKENS_PER_COMMIT: 200, // naive baseline: assumed answer size per commit sent alone
} as const;
