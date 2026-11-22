// The Express app (owner: Person A). Used two ways: index.ts serves it locally (plus the Discord
// connection and node-cron), and api/index.js exports it as a Vercel function.
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { config } from "./config";
import { authRouter, requireMember, requireSignIn } from "./auth/auth";
import { projectsRouter } from "./routes/projects";
import { taskmapRouter } from "./routes/taskmap";
import { checkinRouter } from "./routes/checkin";
import { disputesRouter } from "./routes/disputes";
import { dashboardRouter } from "./routes/dashboard";
import { reportRouter } from "./routes/report";
import { specRouter } from "./routes/spec";
import { simulateRouter } from "./routes/simulate";
import { discordRouter } from "./routes/discord";
import { cronRouter } from "./routes/cron";
import { inboxRouter } from "./routes/inbox";
import { webhookRouter } from "./routes/webhook";

export const app = express();

// On Vercel the web app and the API share one origin, so CORS only matters for local dev.
app.use(cors({ origin: config.frontendUrl }));
// Verify GitHub's original bytes before the general JSON parser or browser authentication.
app.use("/api", webhookRouter);
// Keep the raw bytes: Discord signs the exact body it sent.
app.use(
  express.json({
    limit: "4mb",
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Discord and the scheduler authenticate themselves (signature / secret), not with a sign-in.
app.use("/api", discordRouter);
app.use("/api", cronRouter);

// Sign-in (#62): every /api request needs a Supabase token when sign-in is on, and any
// /api/projects/:id/... request must come from a member of that project.
const memberGuard: RequestHandler = (req, res, next) => {
  requireMember(req, res, next).catch(next);
};
app.use("/api", requireSignIn);
app.use("/api/projects/:id", memberGuard);
app.use("/api", authRouter);

app.use("/api", projectsRouter);
app.use("/api", taskmapRouter);
app.use("/api", checkinRouter);
app.use("/api", disputesRouter);
app.use("/api", dashboardRouter);
app.use("/api", reportRouter);
app.use("/api", specRouter);
app.use("/api", simulateRouter);
app.use("/api", inboxRouter);

// Invalid bodies (zod) → 400 with the issues; anything else → 500.
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid request", issues: err.issues });
    return;
  }
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
};
app.use(onError);

export default app;
