// POST /api/cron/daily and /api/cron/extra (owner: Person C). On Vercel there's no long-running
// process for node-cron, so Supabase pg_cron calls these on schedule (README §2.3) with
// `Authorization: Bearer <CRON_SECRET>`. The work keeps running after the 202 via waitUntil.
import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { config } from "../config";
import { keepAlive } from "../platform";
import { runScheduled } from "../scheduler/cron";

export const cronRouter = Router();

function authorized(header: string | undefined): boolean {
  if (!config.cronSecret) return false;
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${config.cronSecret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

cronRouter.post("/cron/:kind", (req, res) => {
  const kind = req.params.kind;
  if (kind !== "daily" && kind !== "extra") {
    res.status(404).json({ error: "unknown schedule" });
    return;
  }
  if (!authorized(req.headers.authorization)) {
    res.status(401).json({ error: "bad cron secret" });
    return;
  }
  keepAlive(
    runScheduled(kind).then((runs) => console.log(`cron ${kind}: ${runs.filter((r) => r.outcome === "ran").length}/${runs.length} projects checked`)),
  );
  res.status(202).json({ ok: true, kind });
});
