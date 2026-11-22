// /checkin and /trace (owner: Person A). README §7.
import { Router, type RequestHandler } from "express";
import { getCheckin, getCheckins, getProject } from "../db/db";
import { CheckinError, startCheckin } from "../agent/loop";
import { getTrace } from "../agent/trace";
import { keepAlive } from "../platform";

export const checkinRouter = Router();

const asyncRoute =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// POST /projects/:id/checkin → { checkinId }. Returns right away; poll /trace while it runs.
checkinRouter.post(
  "/projects/:id/checkin",
  asyncRoute(async (req, res) => {
    try {
      const { checkinId, done } = await startCheckin(req.params.id, { kind: "manual" });
      keepAlive(done); // on Vercel, keeps the function running after the response
      res.status(202).json({ checkinId });
    } catch (e) {
      if (e instanceof CheckinError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }
  }),
);

// GET /projects/:id/trace?checkinId= → TraceStep[] (latest check-in when checkinId is omitted)
checkinRouter.get(
  "/projects/:id/trace",
  asyncRoute(async (req, res) => {
    if (!(await getProject(req.params.id))) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const requested = typeof req.query.checkinId === "string" ? req.query.checkinId : undefined;
    const checkin = requested ? await getCheckin(requested) : (await getCheckins(req.params.id)).at(-1);
    if (!checkin || checkin.projectId !== req.params.id) {
      res.status(requested ? 404 : 200).json(requested ? { error: "check-in not found" } : []);
      return;
    }
    res.json(await getTrace(checkin.id));
  }),
);

// GET /projects/:id/checkins → past check-ins, newest first (the Trace page's picker, #22)
checkinRouter.get(
  "/projects/:id/checkins",
  asyncRoute(async (req, res) => {
    if (!(await getProject(req.params.id))) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    res.json((await getCheckins(req.params.id)).reverse());
  }),
);
