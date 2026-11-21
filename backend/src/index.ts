// Express app, mounts routes (owner: Person A).
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { config } from "./config";
import { startBot } from "./discord/bot";
import { projectsRouter } from "./routes/projects";
import { taskmapRouter } from "./routes/taskmap";
import { checkinRouter } from "./routes/checkin";
import { disputesRouter } from "./routes/disputes";
import { dashboardRouter } from "./routes/dashboard";
import { reportRouter } from "./routes/report";

const app = express();
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", projectsRouter);
app.use("/api", taskmapRouter);
app.use("/api", checkinRouter);
app.use("/api", disputesRouter);
app.use("/api", dashboardRouter);
app.use("/api", reportRouter);

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

app.listen(config.port, () => {
  console.log(`backend listening on http://localhost:${config.port}`);
  startBot()?.catch((e) => console.error("discord: login failed", e));
});
