// Step 1, observe (owner: Person A). README §2.3, §2.4.
// Pulls new commits from every repo, stores them in raw_commits, and maps authors to members.
import type { Member } from "@enforcer/shared";
import { getLastCompletedCheckin, getProject, getRawCommit, getUnjudgedCommits, insertRawCommit, type RawCommit } from "../db/db";
import { getCommitDiff, listCommits } from "../github/client";

const SINCE_LOOKBACK_MS = 14 * 24 * 3600_000;

export interface ObserveResult {
  /** Commits stored for the project that have no judgment yet (new ones plus any left over). */
  commits: RawCommit[];
  fetched: number;
  repos: string[];
}

/**
 * `skipGitHub` is for the demo replay, which writes raw_commits itself.
 * Diffs are stored in the GitHub client's format: one `diff --git a/X b/Y` header per file.
 */
export async function observe(projectId: string, opts: { skipGitHub?: boolean } = {}): Promise<ObserveResult> {
  const project = await getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  let fetched = 0;
  if (!opts.skipGitHub) {
    // GitHub filters `since` on the commit's author date, and a commit can be pushed days after it was
    // written, so look back a little further. Already-stored SHAs are skipped below.
    const last = (await getLastCompletedCheckin(projectId))?.startedAt;
    const since = last ? new Date(new Date(last).getTime() - SINCE_LOOKBACK_MS).toISOString() : undefined;
    for (const repo of project.repos) {
      for (const c of await listCommits(repo, since)) {
        if (await getRawCommit(c.sha)) continue; // `since` is inclusive; already stored
        const { files, diff } = await getCommitDiff(repo, c.sha);
        const stored = await insertRawCommit(projectId, {
          sha: c.sha,
          repo,
          authorLogin: c.authorLogin,
          coAuthors: parseCoAuthors(c.message),
          message: c.message,
          committedAt: c.committedAt,
          files,
          diff,
        });
        if (stored) fetched++;
      }
    }
  }

  return { commits: await getUnjudgedCommits(projectId), fetched, repos: project.repos };
}

/** `Co-authored-by: Name <email>` trailers → ["Name <email>", ...]. */
export function parseCoAuthors(message: string): string[] {
  const out: string[] = [];
  for (const m of message.matchAll(/^\s*co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)) {
    out.push(`${m[1]} <${m[2]}>`);
  }
  return out;
}

const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** GitHub noreply addresses carry the login: "123+login@users.noreply.github.com" or "login@users.noreply.github.com". */
function loginFromEmail(email: string): string | undefined {
  const m = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email.trim());
  return m?.[1];
}

function findMember(members: Member[], login: string, email?: string, name?: string): Member | undefined {
  const candidates = [login, email ? loginFromEmail(email) : undefined].filter(Boolean).map((s) => lower(s));
  return (
    members.find((m) => candidates.some((c) => c === lower(m.githubUsername) || m.githubAliases.some((a) => lower(a) === c))) ??
    (email ? members.find((m) => m.email && lower(m.email) === lower(email)) : undefined) ??
    (name ? members.find((m) => lower(m.name) === lower(name)) : undefined)
  );
}

/**
 * Author + co-authors → member ids (deduplicated). If the author matches no member,
 * `unmatchedLogin` is set so the dashboard can offer to assign that login.
 */
export function resolveAuthors(commit: RawCommit, members: Member[]): { authorIds: string[]; unmatchedLogin?: string } {
  const ids: string[] = [];
  const add = (m: Member | undefined) => {
    if (m && !ids.includes(m.id)) ids.push(m.id);
  };

  const author = findMember(members, commit.authorLogin, commit.authorLogin.includes("@") ? commit.authorLogin : undefined);
  add(author);
  for (const co of commit.coAuthors) {
    const m = /^(.*?)\s*<([^>]+)>$/.exec(co);
    if (m) add(findMember(members, m[2], m[2], m[1]));
  }
  return author ? { authorIds: ids } : { authorIds: ids, unmatchedLogin: commit.authorLogin };
}
