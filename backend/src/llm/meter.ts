// Cost + energy estimates and the naive baseline (owner: Person A). README §11 (Compute meter math).
import type { ComputeMeter } from "@enforcer/shared";
import { config, meterRules, pricing } from "../config";
import { dbAll, dbGet } from "../db/db";

function priceOf(model: string) {
  return pricing[model] ?? pricing[config.bigModel] ?? { inPerM: 2, outPerM: 10, whPerToken: 0.0003 };
}

/** usd = in × in_price + out × out_price; wh = (in + out) × WH_PER_TOKEN[model]. */
export function costOf(model: string, inputTokens: number, outputTokens: number): { usd: number; wh: number } {
  const p = priceOf(model);
  return {
    usd: (inputTokens * p.inPerM + outputTokens * p.outPerM) / 1_000_000,
    wh: (inputTokens + outputTokens) * p.whPerToken,
  };
}

type Totals = ComputeMeter["ours"];
const empty = (): Totals => ({ tokens: 0, usd: 0, wh: 0, aiCalls: 0 });

function add(t: Totals, model: string, inputTokens: number, outputTokens: number): void {
  const { usd, wh } = costOf(model, inputTokens, outputTokens);
  t.tokens += inputTokens + outputTokens;
  t.usd += usd;
  t.wh += wh;
  t.aiCalls += 1;
}

interface CallRow { purpose: string; model: string; input_tokens: number; output_tokens: number }

/**
 * Ours = every logged LLM call.
 * Naive = what a system with no filter, no small model and no batching would spend:
 * every observed commit sent alone to the big model with its full diff (diff_chars / 4 input tokens),
 * plus the same non-judging calls we make (plan, nudges, report, disputes), so the two sides are comparable.
 */
export async function getComputeMeter(projectId: string): Promise<ComputeMeter> {
  const calls = await dbAll<CallRow>("SELECT purpose, model, input_tokens, output_tokens FROM llm_calls WHERE project_id = ?", projectId);

  const ours = empty();
  const naive = empty();
  for (const c of calls) {
    add(ours, c.model, Number(c.input_tokens), Number(c.output_tokens));
    if (c.purpose !== "judge" && c.purpose !== "escalate") add(naive, c.model, Number(c.input_tokens), Number(c.output_tokens));
  }

  const commits = await dbAll<{ chars: number }>("SELECT length(coalesce(diff, '')) AS chars FROM raw_commits WHERE project_id = ?", projectId);
  for (const c of commits) {
    add(naive, config.bigModel, Math.ceil(Number(c.chars) / 4), meterRules.NAIVE_OUTPUT_TOKENS_PER_COMMIT);
  }

  // count(*) is a bigint in Postgres and comes back as a string.
  const count = async (sql: string): Promise<number> => Number((await dbGet<{ n: string }>(sql, projectId))?.n ?? 0);

  return {
    ours,
    naive,
    filteredWithoutAi: await count("SELECT count(*) AS n FROM judgments WHERE project_id = ? AND kind = 'filtered'"),
    skippedCheckins: await count("SELECT count(*) AS n FROM checkins WHERE project_id = ? AND skipped = 1"),
    disputeRejudges: await count("SELECT count(*) AS n FROM llm_calls WHERE project_id = ? AND purpose = 'dispute'"),
  };
}
