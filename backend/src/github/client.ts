// Octokit wrapper (owner: Person C). Called by agent/observe.ts and by the dispute re-judge.
import { Octokit } from "@octokit/rest";
import { config } from "../config";

let octokit: Octokit | undefined;
function gh(): Octokit {
  // Without a token, public repos still work (at a much lower rate limit).
  octokit ??= new Octokit(config.githubToken ? { auth: config.githubToken } : {});
  return octokit;
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`repo must be "owner/repo", got "${repo}"`);
  return { owner, repo: name };
}

export interface CommitSummary {
  sha: string;
  /** GitHub login when GitHub can link the commit to an account, else the git author email or name. */
  authorLogin: string;
  /** Full commit message, including any `Co-authored-by:` trailers. */
  message: string;
  committedAt: string;
}

/** Commits on the default branch since `since` (ISO), oldest first. */
export async function listCommits(repo: string, since?: string): Promise<CommitSummary[]> {
  const items = await gh().paginate(gh().rest.repos.listCommits, { ...splitRepo(repo), since, per_page: 100 });
  return items
    .map((c) => ({
      sha: c.sha,
      authorLogin: c.author?.login ?? c.commit.author?.email ?? c.commit.author?.name ?? "unknown",
      message: c.commit.message,
      committedAt: c.commit.author?.date ?? c.commit.committer?.date ?? new Date(0).toISOString(),
    }))
    .sort((a, b) => a.committedAt.localeCompare(b.committedAt));
}

export interface CommitDiff {
  files: string[];
  /** Unified diff of every file, each preceded by a `diff --git` header. */
  diff: string;
}

/** Files and diff of one commit. Binary or very large files have no patch and appear as a header only. */
export async function getCommitDiff(repo: string, sha: string): Promise<CommitDiff> {
  const { data } = await gh().rest.repos.getCommit({ ...splitRepo(repo), ref: sha });
  const files = data.files ?? [];
  return {
    files: files.map((f) => f.filename),
    diff: files
      .map((f) => `diff --git a/${f.previous_filename ?? f.filename} b/${f.filename}\n${f.patch ?? "(no textual diff)"}`)
      .join("\n"),
  };
}

export interface FileContents {
  path: string;
  content: string;
}

/**
 * Current contents of a file on the default branch (or `ref`). If `path` is a directory, returns the
 * files directly inside it (not recursive), so a dispute can point at "src/settings/".
 * Returns [] when the path doesn't exist.
 */
export async function getFileContents(repo: string, path: string, ref?: string): Promise<FileContents[]> {
  const where = { ...splitRepo(repo), ref };
  const clean = path.replace(/^\/+|\/+$/g, "");
  let data;
  try {
    ({ data } = await gh().rest.repos.getContent({ ...where, path: clean }));
  } catch (e) {
    if ((e as { status?: number }).status === 404) return [];
    throw e;
  }

  if (Array.isArray(data)) {
    const files = data.filter((entry) => entry.type === "file");
    const nested = await Promise.all(files.map((f) => getFileContents(repo, f.path, ref)));
    return nested.flat();
  }
  if (data.type !== "file" || !("content" in data)) return [];
  return [{ path: data.path, content: Buffer.from(data.content, "base64").toString("utf8") }];
}

/**
 * Every file path on the repo's default branch (one recursive tree call), capped at `limit`.
 * Used when re-planning from an updated spec, so the model can see what already exists.
 */
export async function listRepoFiles(repo: string, limit = 600): Promise<{ paths: string[]; truncated: boolean }> {
  const where = splitRepo(repo);
  const { data: info } = await gh().rest.repos.get(where);
  const { data } = await gh().rest.git.getTree({ ...where, tree_sha: info.default_branch, recursive: "true" });
  const paths = data.tree.filter((entry) => entry.type === "blob" && entry.path).map((entry) => entry.path!);
  return { paths: paths.slice(0, limit), truncated: data.truncated || paths.length > limit };
}
