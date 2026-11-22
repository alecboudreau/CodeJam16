// Demo mode (#76). The PayLite demo project is public (no sign-in) so it can be shown at /demo;
// every other project still needs sign-in and membership. Discord messages from demo check-ins
// only go out with the presenter key, so random visitors can't send DMs to the presenter.
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { config } from "../config";

export const DEMO_PROJECT_ID = "demo-paylite";

export const isDemoProject = (projectId: string | undefined): boolean => projectId === DEMO_PROJECT_ID;

/** Paths (relative to /api) that belong to the demo: its project routes and /demo/*. */
export const isDemoPath = (path: string): boolean =>
  path === `/projects/${DEMO_PROJECT_ID}` || path.startsWith(`/projects/${DEMO_PROJECT_ID}/`) || path.startsWith("/demo/");

/** True when the request carries the presenter key (header X-Demo-Presenter-Key). */
export function hasPresenterKey(req: Request): boolean {
  const expected = config.demoPresenterKey;
  const given = String(req.headers["x-demo-presenter-key"] ?? "");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether a check-in started by this request may send Discord messages. */
export const discordAllowed = (req: Request, projectId: string): boolean => !isDemoProject(projectId) || hasPresenterKey(req);
