// Demo endpoints (#76). Public, like the demo project itself: anyone can reset the PayLite demo
// and play it again. Discord messages still need the presenter key (see demo/mode.ts).
import { Router, type RequestHandler } from "express";
import { getMembers } from "../db/db";
import { DEMO_PROJECT_ID, hasPresenterKey } from "../demo/mode";
import { seedDemo } from "../demo/seed";

export const demoRouter = Router();

const asyncRoute =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// POST /api/demo/reset → { projectId } — back to Sat Nov 7, plan approved, nothing simulated.
demoRouter.post(
  "/demo/reset",
  asyncRoute(async (_req, res) => {
    // Keep whichever Discord account the demo members were linked to (the presenter's).
    const presenter = (await getMembers(DEMO_PROJECT_ID)).find((m) => m.discordId)?.discordId;
    const { projectId } = await seedDemo(presenter, { init: false });
    res.json({ projectId });
  }),
);

// GET /api/demo/presenter → { presenter } — whether this browser's presenter key is right.
demoRouter.get("/demo/presenter", (req, res) => {
  res.json({ presenter: hasPresenterKey(req) });
});
