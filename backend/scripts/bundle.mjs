// Bundles the Express app (src/app.ts) into one ESM file for Vercel: dist/app.js.
// npm dependencies stay external (Vercel installs them); our own workspace package @enforcer/shared
// (TypeScript source) is bundled in.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((d) => d !== "@enforcer/shared");

await build({
  entryPoints: [new URL("../src/app.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  outfile: new URL("../dist/app.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: [...external, ...external.map((d) => `${d}/*`)],
  sourcemap: true,
  logLevel: "info",
});
