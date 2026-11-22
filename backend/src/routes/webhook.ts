// GitHub authenticates with its HMAC, independently of browser sign-in.
import express, { Router, type ErrorRequestHandler } from "express";
import { config } from "../config";
import { storeGitHubPush, verifyGitHubSignature, WebhookError } from "../github/webhook";

export const webhookRouter = Router();

webhookRouter.post("/webhook/github", express.raw({ type: "application/json", limit: "25mb", inflate: false }), (req, res, next) => {
  if (!config.githubWebhookSecret) {
    res.status(503).json({ error: "GitHub webhooks are not configured" });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(415).json({ error: "Configure the GitHub webhook to use application/json" });
    return;
  }
  if (!verifyGitHubSignature(req.body, req.get("x-hub-signature-256"), config.githubWebhookSecret)) {
    res.status(401).json({ error: "Invalid GitHub webhook signature" });
    return;
  }
  const event = req.get("x-github-event");
  if (!event) {
    res.status(400).json({ error: "Missing GitHub event header" });
    return;
  }
  if (event !== "push") { res.status(204).end(); return; }
  let payload: unknown;
  try { payload = JSON.parse(req.body.toString("utf8")); }
  catch { res.status(400).json({ error: "Invalid JSON payload" }); return; }
  storeGitHubPush(payload).then(() => res.status(204).end()).catch(next);
});

const onWebhookError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof WebhookError) { res.status(error.status).json({ error: error.message }); return; }
  // Raw parser failures must stay client errors instead of being converted to 500 by the app.
  if (error?.type === "entity.too.large") { res.status(413).json({ error: "GitHub webhook payload is too large" }); return; }
  if (error?.type === "encoding.unsupported") { res.status(415).json({ error: "Compressed GitHub webhook bodies are not supported" }); return; }
  next(error);
};
webhookRouter.use(onWebhookError);
