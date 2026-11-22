// Local server (owner: Person A): the API, plus the parts Vercel doesn't run (the always-on
// Discord connection and node-cron). On Vercel, api/index.js serves app.ts instead.
import { app } from "./app";
import { config } from "./config";
import { startBot } from "./discord/bot";
import { startScheduler } from "./scheduler/cron";

app.listen(config.port, () => {
  console.log(`backend listening on http://localhost:${config.port}`);
  startBot()?.catch((e) => console.error("discord: login failed", e));
  startScheduler();
});
