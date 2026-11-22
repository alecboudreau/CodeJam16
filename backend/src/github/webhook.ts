// GitHub push ingestion (C9). A webhook stores evidence; only scheduled/manual check-ins judge it.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { dbAll, dbGet, insertRawCommit, tx, type RawCommit } from "../db/db";
import { parseCoAuthors } from "../agent/observe";
import { getCommitDiff } from "./client";

export class WebhookError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function verifyGitHubSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

const Push = z.object({
  ref: z.string(),
  deleted: z.boolean().default(false),
  repository: z.object({ full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/), default_branch: z.string().min(1) }),
  commits: z.array(z.object({
    id: z.string().regex(/^(?:[a-f\d]{40}|[a-f\d]{64})$/i),
    message: z.string(),
    timestamp: z.string().datetime({ offset: true }),
    author: z.object({ username: z.string().nullish(), email: z.string().nullish(), name: z.string().nullish() }),
  })).max(2048),
});

function repositories(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((repo): repo is string => typeof repo === "string") : [];
  } catch { return []; }
}

/** Store only default-branch pushes, matching the commits pulled by observe(). */
export async function storeGitHubPush(payload: unknown): Promise<void> {
  const parsed = Push.safeParse(payload);
  if (!parsed.success) throw new WebhookError(400, "Invalid GitHub push payload");
  const push = parsed.data;
  if (push.deleted || push.ref !== `refs/heads/${push.repository.default_branch}` || !push.commits.length) return;
  const repo = push.repository.full_name;
  const projects = (await dbAll<{ id: string; repos: string }>("SELECT id, repos FROM projects"))
    .filter((project) => repositories(project.repos).some((name) => name.toLowerCase() === repo.toLowerCase()));
  if (!projects.length) return; // Unconfigured repositories never cause API calls or writes.
  // The current schema keys raw_commits by SHA globally. Do not silently credit only one project.
  if (projects.length > 1) throw new WebhookError(409, "Webhook ingestion requires the repository to belong to one project");
  const projectId = projects[0].id;
  const commits = [...new Map(push.commits.map((commit) => [commit.id, commit])).values()];
  const pending: RawCommit[] = [];
  // Limit GitHub API concurrency, and fetch complete diffs before any rows are inserted.
  for (let offset = 0; offset < commits.length; offset += 5) {
    const batch = await Promise.all(commits.slice(offset, offset + 5).map(async (commit): Promise<RawCommit | null> => {
      const existing = await dbGet<{ project_id: string }>("SELECT project_id FROM raw_commits WHERE sha = ?", commit.id);
      if (existing) {
        if (existing.project_id !== projectId) throw new WebhookError(409, "A pushed commit is already associated with another project");
        return null;
      }
      const { files, diff } = await getCommitDiff(repo, commit.id);
      return {
        sha: commit.id, repo, authorLogin: commit.author.username || commit.author.email || commit.author.name || "unknown",
        coAuthors: parseCoAuthors(commit.message), message: commit.message, committedAt: commit.timestamp, files, diff,
      };
    }));
    pending.push(...batch.filter((commit): commit is RawCommit => commit !== null));
  }
  await tx(async () => {
    // ON CONFLICT in insertRawCommit makes retries and simultaneous deliveries idempotent.
    for (const commit of pending) {
      if (!await insertRawCommit(projectId, commit)) {
        const existing = await dbGet<{ project_id: string }>("SELECT project_id FROM raw_commits WHERE sha = ?", commit.sha);
        if (existing?.project_id !== projectId) throw new WebhookError(409, "A pushed commit is already associated with another project");
      }
    }
  });
}
