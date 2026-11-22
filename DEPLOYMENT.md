# C11 deployment handoff

The deployment architecture is now Vercel + Supabase, as agreed in #71 and README §4. The frontend and Express API share one Vercel project; Discord uses signed HTTP interactions and REST sends. Render/Railway and an always-on Discord gateway are not required in production.

Project: https://vercel.com/boudsdream/codejam16

Live demo: https://codejam16.vercel.app/demo

## Current verification and blocker (2026-11-21)

- The live frontend and `/demo` load. `/api/health` returns 200 with `{"ok":true}`.
- `/api/auth/config` reports sign-in enabled. A private project request without a token returns 401; unauthenticated cron requests return 401.
- The deployed demo's simulation fails with `Invalid time zone specified: :UTC`. This branch strips POSIX's leading colon from `TZ` before using it with Intl/node-cron. Set `TZ=America/Toronto` explicitly so demo dates match the Toronto schedule.
- GitHub reports main commit `ec40ad10832e66b802a6a085d23c66bc0ffa1c9d` as blocked by Vercel. Josh's Vercel account cannot access the Boudsdream project; the team membership request previously reported a full team. Alec must deploy with his existing access or resolve membership.
- The fixed code has not been deployed. C11 remains open until the deployed demo passes, including presenter Discord delivery.
- Local verification with `TZ=:UTC` passes demo reset, an approved plan, 28 simulated check-ins, complete traces, Dashboard, Inbox/team alerts, Sam's Blocked → Alex flow, compute totals, and report generation against isolated native PostgreSQL. AI responses were mocked and no Discord/GitHub sends were made; this is not a substitute for the live release verification below.

## Deployment settings

Use the repository root, Node 22, and the checked-in `vercel.json` build command, output directory, function bundle includes, region and rewrites. Do not set the project root to `frontend`: the backend bundle and `api/index.js` must be deployed too. The production Git branch is `main`.

Configure these in Vercel's Production environment (and Preview separately if needed):

| Setting | Value / purpose |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler connection string; run the current schema migration with `npm run db:init` from an authorized local environment before deployment. Do not initialize the database on each request. |
| `SUPABASE_URL` | Supabase project URL, keeping production sign-in enabled. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Matching Supabase project's browser-safe sign-in configuration. Build-time values: redeploy after changes. |
| `AUTH_DISABLED` | `false`. |
| `FRONTEND_URL` | `https://codejam16.vercel.app` (or the production custom domain). |
| `VITE_API_URL` | `/api`. |
| `VITE_USE_MOCKS` | `false`. |
| `TZ` | `America/Toronto`. |
| `ANTHROPIC_API_KEY`, `SMALL_MODEL`, `BIG_MODEL` | The project's authorized Anthropic key and available model IDs. |
| `GITHUB_TOKEN` | GitHub API access when required. |
| `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`, `DISCORD_GROUP_CHANNEL_ID`, `DISCORD_PUBLIC_KEY` | Existing Discord application, server and channel configuration. |
| `CRON_SECRET` | Secret used by Supabase cron requests. |
| `DEMO_PRESENTER_KEY` | Presenter-only authorization for demo Discord sends. |
| `GITHUB_WEBHOOK_SECRET` | C9 webhook HMAC secret, matching GitHub configuration. |
| `LLM_CACHE` | `off` for normal live use; `fallback` only if a cache has deliberately been prepared. `replay` requires matching cached prompts. |

Keep secret values in Vercel/Supabase settings, never in Git or browser-prefixed variables. `.env.example` documents local defaults; do not copy its mock/local URL values into production unchanged.

For C10 after PR #79 is merged, Alec also needs `RESEND_API_KEY`, a verified `EMAIL_FROM`, and an agreed test recipient. Live email testing is deferred; no email test has been sent.

## External service wiring

1. In Supabase Auth, set the production Site URL and allowed redirect URLs for the app's sign-in return paths. Use the same Supabase project as the Vercel browser settings.
2. In the Discord Developer Portal, set the application's Interactions Endpoint URL to `https://codejam16.vercel.app/api/discord/interactions`. Preserve the existing `/link` command registration and bot/channel permissions. Vercel handles messages through HTTP; do not start the local Discord gateway there.
3. In Supabase, verify the existing `pg_cron` / `pg_net` jobs call `POST /api/cron/daily` at 18:00 Toronto and `POST /api/cron/extra` at 00:00, 06:00 and 12:00 Toronto with `Authorization: Bearer <CRON_SECRET>`. Check actual job history and daylight-saving behavior; cron must keep working without a laptop process. These jobs were not inspected from Josh's account.
4. For C9, configure a GitHub push webhook to `https://codejam16.vercel.app/api/webhook/github`, content type `application/json`, with the matching secret. Verify a delivery is accepted and its commits reach the project's next check-in.

## Alec's release verification

1. Merge the C11 timezone fix and deploy the intended main commit from Boudsdream. Confirm the deployment is Ready and the production alias points to it. Do not overwrite an existing environment configuration with local `.env` files.
2. Check `/api/health`, normal-app sign-in, and `/demo`. Ensure the demo uses the real API rather than frontend fixtures.
3. In the disposable public demo, reset then simulate a week without a presenter key. Confirm Trace completes without errors, Dashboard and compute totals refresh, Inbox receives reminders, and no Discord messages are sent.
4. Open `/demo?key=<DEMO_PRESENTER_KEY>` on the presenter's own device. Do not share or record that URL. Reset the demo, simulate a week, and verify Discord nudges and Jordan's one-time team alert. Use Sam's Blocked response to select Alex, run the next simulated day, and verify Sam's grace pause and Alex's blocker reminder. Check On it / Need help and the app's report flow as part of rehearsal.
5. Verify one real scheduled check-in from Supabase's cron history and a signed Discord interaction round trip. Only then mark C11's deployed-demo acceptance complete. Report any remaining service/configuration failures rather than treating a health check as a full demo pass.
