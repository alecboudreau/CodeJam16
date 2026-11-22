// POST /projects/:id/simulate { days } → { checkinId } (owner: Person C, C7). README §7.
// Waits for the whole simulated week, then returns the last daily check-in for the Trace page.
import { Router, type RequestHandler } from "express";
import { SimulateBody } from "@enforcer/shared";
import { getProject } from "../db/db";
import { isSimulating, simulateDays } from "../demo/replay";
import { discordAllowed } from "../demo/mode";

export const simulateRouter = Router();

const asyncRoute =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

simulateRouter.post(
  "/projects/:id/simulate",
  asyncRoute(async (req, res) => {
    const { days } = SimulateBody.parse(req.body ?? {});
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    if (!project.planActive) {
      res.status(409).json({ error: "approve the plan before simulating" });
      return;
    }
    if (isSimulating(project.id)) {
      res.status(409).json({ error: "a simulation is already running for this project" });
      return;
    }
    const result = await simulateDays(project.id, days, { discord: discordAllowed(req, project.id) });
    res.json({ checkinId: result.checkinId, days: result.days, checkins: result.checkins, skipped: result.skipped, commits: result.commitsFed });
  }),
);
