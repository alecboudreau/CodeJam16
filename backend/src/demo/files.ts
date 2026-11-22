// The demo's repo ("demo/paylite") isn't on GitHub. Its files come from the replay data instead:
// every commit in demo/commits-week2.json carries the full contents of the files it touched ("after"),
// so a file's current version is the latest "after". Used by disputes, which read the repo as it is now.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT_DIR } from "../config";

export const DEMO_REPO = "demo/paylite";
const WEEK2_PATH = resolve(ROOT_DIR, "demo/commits-week2.json");

interface CommitWithFiles {
  committedAt: string;
  after?: Record<string, string>;
}

/** Current files at `path` (one file, or everything under a folder), from the demo replay data. */
export function demoFileContents(path: string): { path: string; content: string }[] {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const commits = (JSON.parse(readFileSync(WEEK2_PATH, "utf8")) as CommitWithFiles[])
    .sort((a, b) => a.committedAt.localeCompare(b.committedAt));
  const latest = new Map<string, string>();
  for (const c of commits) for (const [file, content] of Object.entries(c.after ?? {})) latest.set(file, content);
  return [...latest]
    .filter(([file]) => file === clean || file.startsWith(`${clean}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, content]) => ({ path: file, content }));
}
