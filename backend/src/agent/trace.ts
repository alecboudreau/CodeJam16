// Writes trace steps to the DB (owner: Person A). README §2.3: every check-in step is visible live.
import type { TraceStep } from "@enforcer/shared";
import { getTraceSteps, insertTraceStep, nowIso } from "../db/db";

export interface Tracer {
  step(step: TraceStep["step"], summary: string, details?: unknown): Promise<void>;
}

/** Steps are numbered in the order they're written; `at` is wall-clock time so the UI can animate them. */
export async function createTracer(checkinId: string): Promise<Tracer> {
  let order = (await getTraceSteps(checkinId)).length;
  return {
    async step(step, summary, details) {
      await insertTraceStep({ checkinId, order: order++, step, summary, details, at: nowIso() });
    },
  };
}

export const getTrace = getTraceSteps;
