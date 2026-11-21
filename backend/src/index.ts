// Express app, mounts routes (owner: Person A).
import express from "express";
import cors from "cors";
import { config } from "./config";

const app = express();
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// TODO: mount routes from ./routes/* under /api

app.listen(config.port, () => {
  console.log(`backend listening on http://localhost:${config.port}`);
});
