// Writes trace steps to the DB (owner: Person A). README §2.3: every check-in step is visible live.
import type { TraceStep } from "@enforcer/shared";
import { getTraceSteps, insertTraceStep, nowIso } from "../db/db";

export interface Tracer {
  step(step: TraceStep["step"], summary: string, details?: unknown): void;
}

/** Steps are numbered in the order they're written; `at` is wall-clock time so the UI can animate them. */
export function createTracer(checkinId: string): Tracer {
  let order = getTraceSteps(checkinId).length;
  return {
    step(step, summary, details) {
      insertTraceStep({ checkinId, order: order++, step, summary, details, at: nowIso() });
    },
  };
}

export const getTrace = getTraceSteps;
