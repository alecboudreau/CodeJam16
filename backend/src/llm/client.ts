// One wrapper for every LLM call (owner: Person A). README §11, §16.
// callSmall() / callBig() return JSON validated with a zod schema, retry once on bad JSON,
// and log tokens, cost and energy for every attempt in llm_calls.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ZodType, ZodTypeDef } from "zod";
import { config, ROOT_DIR } from "../config";
import { db, newId, nowIso } from "../db/db";
import { costOf } from "./meter";

// ---------- cached fallback for the live demo (README §15) ----------
// LLM_CACHE=off      (default) no cache
// LLM_CACHE=fallback every successful answer is saved; if a call fails (no Wi-Fi, API down, bad key),
//                    the saved answer for the exact same prompt is used instead
// LLM_CACHE=replay   saved answers only: no network, no cost (rehearsals); a missing answer is an error
// Answers live in demo/llm-cache.json (LLM_CACHE_PATH), keyed by model + effort + prompt.
type CacheMode = "off" | "fallback" | "replay";
const cacheMode: CacheMode = (["fallback", "replay"] as const).find((m) => m === process.env.LLM_CACHE) ?? "off";
const cachePath = resolve(ROOT_DIR, process.env.LLM_CACHE_PATH ?? "demo/llm-cache.json");

interface CacheEntry {
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  savedAt: string;
}
let cache: Record<string, CacheEntry> | undefined;

function readCache(): Record<string, CacheEntry> {
  if (!cache) {
    try {
      cache = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, CacheEntry>) : {};
    } catch {
      console.warn(`llm cache: couldn't read ${cachePath}, starting empty`);
      cache = {};
    }
  }
  return cache;
}

function saveToCache(key: string, entry: CacheEntry): void {
  const c = readCache();
  c[key] = entry;
  writeFileSync(cachePath, JSON.stringify(c, null, 1) + "\n");
}

const cacheKey = (model: string, effort: Effort, system: string, messages: Anthropic.MessageParam[]) =>
  createHash("sha256").update(JSON.stringify({ model, effort, system, messages })).digest("hex");

/** No saved answer for this exact prompt (LLM_CACHE=replay). */
export class LlmCacheMissError extends Error {}

export type LlmPurpose = "taskmap" | "judge" | "escalate" | "dispute" | "nudge" | "report";
export type Effort = "low" | "medium" | "high";

export interface LlmRequest<T> {
  purpose: LlmPurpose;
  projectId: string;
  checkinId?: string | null;
  system: string;
  user: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  maxTokens?: number;
  effort?: Effort;
}

/** The model declined the request (stop_reason = "refusal"). */
export class LlmRefusalError extends Error {
  constructor(public readonly model: string, public readonly category: string | null) {
    super(`${model} declined the request${category ? ` (${category})` : ""}`);
  }
}

/** The model returned something that isn't valid JSON for the schema, twice. */
export class LlmBadJsonError extends Error {}

const JSON_ONLY =
  "Reply with one JSON object only: no prose before or after it, no markdown code fences.";

let anthropic: Anthropic | undefined;
function getClient(): Anthropic {
  // With no key in .env the SDK falls back to ANTHROPIC_API_KEY / an `ant auth login` profile.
  // With the fallback on, fail fast (no 10-minute hang on bad Wi-Fi) so the cached answer kicks in.
  const fast = cacheMode === "fallback" ? { timeout: 90_000, maxRetries: 1 } : {};
  anthropic ??= new Anthropic({ ...(config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : {}), ...fast });
  return anthropic;
}

/** Small model: batched judging, nudge wording, status report. Cheap by default (effort low). */
export function callSmall<T>(req: LlmRequest<T>): Promise<T> {
  return call(config.smallModel, req.effort ?? "low", req);
}

/** Big model: plan generation, escalations, disputes. Only where it matters (effort medium). */
export function callBig<T>(req: LlmRequest<T>): Promise<T> {
  return call(config.bigModel, req.effort ?? "medium", req);
}

async function call<T>(model: string, effort: Effort, req: LlmRequest<T>): Promise<T> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: req.user }];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await send(model, effort, req, messages);
    const result = parseJson(text, req.schema);
    if (result.ok) return result.value;
    if (attempt === 2) throw new LlmBadJsonError(`${req.purpose}: ${result.error}`);
    // Retry once, telling the model what was wrong.
    messages.push(
      { role: "assistant", content: text || "(empty)" },
      { role: "user", content: `That reply was not valid: ${result.error}\n${JSON_ONLY}` },
    );
  }
  throw new Error("unreachable");
}

async function send<T>(
  model: string,
  effort: Effort,
  req: LlmRequest<T>,
  messages: Anthropic.MessageParam[],
): Promise<string> {
  const system = `${req.system}\n\n${JSON_ONLY}`;
  const key = cacheKey(model, effort, system, messages);

  // Cached answers are logged with their original token counts, so the compute meter is unchanged.
  const fromCache = (entry: CacheEntry): string => {
    logCall(req, entry.model, entry.inputTokens, entry.outputTokens);
    return entry.text;
  };

  if (cacheMode === "replay") {
    const entry = readCache()[key];
    if (!entry) throw new LlmCacheMissError(`no cached answer for this ${req.purpose} prompt (LLM_CACHE=replay)`);
    return fromCache(entry);
  }

  const params = { model, max_tokens: req.maxTokens ?? 16000, system, messages, output_config: { effort } };
  let response;
  try {
    // The big model gets server-side refusal fallbacks: if it declines, the API re-runs the same
    // request on a fallback model inside the same call. The small model has no fallback.
    response =
      model === config.bigModel
        ? await getClient().beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await getClient().messages.create(params);
  } catch (e) {
    const entry = cacheMode === "fallback" ? readCache()[key] : undefined;
    if (!entry) throw e;
    console.warn(`llm cache: ${req.purpose} call failed (${(e as Error).message.slice(0, 80)}), using the saved answer`);
    return fromCache(entry);
  }

  // Log the model that actually served the request (it differs after a fallback).
  logCall(req, response.model, response.usage.input_tokens, response.usage.output_tokens);

  if (response.stop_reason === "refusal") {
    throw new LlmRefusalError(response.model, response.stop_details?.category ?? null);
  }
  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  if (cacheMode === "fallback") {
    saveToCache(key, { model: response.model, text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, savedAt: nowIso() });
  }
  return text;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseJson<T>(text: string, schema: ZodType<T, ZodTypeDef, unknown>): Parsed<T> {
  // Tolerate code fences or stray prose: take the outermost {...}.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "no JSON object found" };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: `invalid JSON (${(e as Error).message})` };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: `JSON does not match the schema (${issues})` };
}

function logCall<T>(req: LlmRequest<T>, model: string, inputTokens: number, outputTokens: number): void {
  const { usd, wh } = costOf(model, inputTokens, outputTokens);
  db.prepare(
    `INSERT INTO llm_calls (id, project_id, checkin_id, purpose, model, input_tokens, output_tokens, usd, wh, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId(), req.projectId, req.checkinId ?? null, req.purpose, model, inputTokens, outputTokens, usd, wh, nowIso());
}
