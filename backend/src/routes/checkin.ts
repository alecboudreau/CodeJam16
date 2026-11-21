// /checkin and /trace (owner: Person A). README §7.
import { Router } from "express";
import { getCheckin, getCheckins, getProject } from "../db/db";
import { CheckinError, startCheckin } from "../agent/loop";
import { getTrace } from "../agent/trace";

export const checkinRouter = Router();

// POST /projects/:id/checkin → { checkinId }. Returns right away; poll /trace while it runs.
checkinRouter.post("/projects/:id/checkin", (req, res) => {
  try {
    const { checkinId } = startCheckin(req.params.id, { kind: "manual" });
    res.status(202).json({ checkinId });
  } catch (e) {
    if (e instanceof CheckinError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw e;
  }
});

// GET /projects/:id/trace?checkinId= → TraceStep[] (latest check-in when checkinId is omitted)
checkinRouter.get("/projects/:id/trace", (req, res) => {
  if (!getProject(req.params.id)) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const requested = typeof req.query.checkinId === "string" ? req.query.checkinId : undefined;
  const checkin = requested ? getCheckin(requested) : getCheckins(req.params.id).at(-1);
  if (!checkin || checkin.projectId !== req.params.id) {
    res.status(requested ? 404 : 200).json(requested ? { error: "check-in not found" } : []);
    return;
  }
  res.json(getTrace(checkin.id));
});

// GET /projects/:id/checkins → past check-ins, newest first (the Trace page's picker, #22)
checkinRouter.get("/projects/:id/checkins", (req, res) => {
  if (!getProject(req.params.id)) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json(getCheckins(req.params.id).reverse());
});
