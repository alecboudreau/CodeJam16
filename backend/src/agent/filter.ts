// Step 2, filter (owner: Person A). README §2.3. Plain code, no AI.
// Drops changes that can't be real progress and records them as "filtered" judgments,
// so they're never sent to a model (and count in the compute meter's filteredWithoutAi).
import type { Judgment, Member } from "@enforcer/shared";
import type { RawCommit } from "../db/db";
import { resolveAuthors } from "./observe";

const IGNORED_PATH = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|Pipfile\.lock|go\.sum)$/i,
  /\.lock$/i,
  /(^|\/)(dist|build|vendor|node_modules|out|coverage|\.next)\//i,
  /\.min\.(js|css|mjs)$/i,
  /\.map$/i,
];

export const isIgnoredPath = (path: string): boolean => IGNORED_PATH.some((re) => re.test(path));

interface FileDiff {
  path: string;
  text: string;
}

/** Splits a stored diff (one `diff --git a/X b/Y` header per file) into per-file chunks. */
export function splitDiff(diff: string): FileDiff[] {
  const parts: FileDiff[] = [];
  const re = /^diff --git a\/(.+?) b\/(.+)$/gm;
  const heads = [...diff.matchAll(re)];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : diff.length;
    parts.push({ path: h[2], text: diff.slice(h.index, end).replace(/\n$/, "") });
  });
  return parts;
}

/**
 * True when the added and removed lines are the same once whitespace, semicolons, commas and quote
 * style are ignored: re-indenting, prettier runs, quote swaps. Renames with no content change also count.
 */
export function isFormattingOnly(fileDiffs: FileDiff[]): boolean {
  const norm = (line: string) => line.slice(1).replace(/[\s;,'"`]/g, "");
  const added: string[] = [];
  const removed: string[] = [];
  for (const f of fileDiffs) {
    for (const line of f.text.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) added.push(norm(line));
      else if (line.startsWith("-")) removed.push(norm(line));
    }
  }
  const a = added.filter(Boolean).sort().join("\n");
  const r = removed.filter(Boolean).sort().join("\n");
  return a === r;
}

export interface FilterResult {
  /** Commits worth judging, with ignored files removed from `files` and `diff`. */
  keep: RawCommit[];
  /** "filtered" judgments for everything dropped (model "none", no progress). */
  filtered: Judgment[];
}

/** Already-judged SHAs never reach this step: observe only returns commits without a judgment. */
export function filterCommits(commits: RawCommit[], members: Member[]): FilterResult {
  const keep: RawCommit[] = [];
  const filtered: Judgment[] = [];

  for (const c of commits) {
    const fileDiffs = splitDiff(c.diff);
    const kept = fileDiffs.filter((f) => !isIgnoredPath(f.path));
    const keptFiles = c.files.filter((f) => !isIgnoredPath(f));

    let reason: string | undefined;
    if (keptFiles.length === 0 && kept.length === 0) {
      reason = c.files.length === 0 ? "Empty commit" : "Only lock, build, vendor or minified files";
    } else if (kept.length > 0 && isFormattingOnly(kept)) {
      reason = "Whitespace or formatting changes only";
    }

    if (reason) {
      filtered.push({
        sha: c.sha,
        repo: c.repo,
        ...resolveAuthors(c, members),
        taskId: null,
        kind: "filtered",
        completionDelta: 0,
        confidence: 1,
        model: "none",
        reason,
      });
    } else {
      keep.push({ ...c, files: keptFiles, diff: kept.map((f) => f.text).join("\n") });
    }
  }
  return { keep, filtered };
}
