#!/usr/bin/env bash
# Creates the PayLite demo repo with 3 weeks of dated commits (owner: Person C, C6). README §15.
#   Week 1 (Nov 2-8)   setup history, defined below
#   Week 2 (Nov 9-15)  demo/commits-week2.json: the week "Simulate 1 week" replays
#   Week 3 (Nov 16-17) a little polish, defined below
# Authors: Alex, Priya and Jordan (GitHub noreply emails), plus Jordan on an unlinked laptop identity.
# Sam never commits.
#
# Usage: bash demo/make-demo-repo.sh [target-dir]   (default: ../codejam-demo-repo next to this project)
# Then, to put it on GitHub:  cd <target-dir> && gh repo create <name> --public --source . --push
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$HERE/../../codejam-demo-repo}"

if [ -e "$TARGET/.git" ]; then
  echo "$TARGET already has a git repo. Delete it or pass another directory." >&2
  exit 1
fi
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

git -C "$TARGET" init -q -b main
git -C "$TARGET" config core.autocrlf false

OTHER_WEEKS=$(cat <<'JSON'
[{"sha": "45e37b0df1e5e3768c7705a26079a5d7719671a3", "authorLogin": "priya-demo", "authorName": "Priya Nair", "authorEmail": "priya-demo@users.noreply.github.com", "coAuthors": [], "message": "Scaffold frontend", "committedAt": "2026-11-02T14:10:00Z", "files": ["package.json", "package-lock.json", "frontend/App.tsx", "frontend/settings/SettingsPage.tsx", "frontend/settings/PreferencesForm.tsx", "frontend/settings/settingsApi.ts"], "diff": "diff --git a/package.json b/package.json\n@@ -0,0 +1,12 @@\n+{\n+  \"name\": \"paylite\",\n+  \"private\": true,\n+  \"scripts\": {\n+    \"dev\": \"vite\",\n+    \"test\": \"vitest\"\n+  },\n+  \"dependencies\": {\n+    \"react\": \"18.3.1\",\n+    \"stripe\": \"17.4.0\"\n+  }\n+}\ndiff --git a/package-lock.json b/package-lock.json\n@@ -0,0 +1,8 @@\n+{\n+  \"name\": \"paylite\",\n+  \"lockfileVersion\": 3,\n+  \"packages\": {\n+    \"node_modules/react\": { \"version\": \"18.3.1\" },\n+    \"node_modules/stripe\": { \"version\": \"17.4.0\" }\n+  }\n+}\ndiff --git a/frontend/App.tsx b/frontend/App.tsx\n@@ -0,0 +1,10 @@\n+import { SettingsPage } from './settings/SettingsPage'\n+\n+export function App() {\n+  return (\n+    <main>\n+      <h1>PayLite</h1>\n+      <SettingsPage />\n+    </main>\n+  )\n+}\ndiff --git a/frontend/settings/SettingsPage.tsx b/frontend/settings/SettingsPage.tsx\n@@ -0,0 +1,13 @@\n+import { useState } from 'react'\n+import { PreferencesForm } from './PreferencesForm'\n+import { loadPrefs, savePrefs } from './settingsApi'\n+\n+export function SettingsPage() {\n+  const [prefs, setPrefs] = useState(loadPrefs())\n+  return (\n+    <section>\n+      <h2>Settings</h2>\n+      <PreferencesForm value={prefs} onChange={setPrefs} onSave={() => savePrefs(prefs)} />\n+    </section>\n+  )\n+}\ndiff --git a/frontend/settings/PreferencesForm.tsx b/frontend/settings/PreferencesForm.tsx\n@@ -0,0 +1,13 @@\n+import type { Prefs } from './settingsApi'\n+\n+export function PreferencesForm({ value, onChange, onSave }: { value: Prefs, onChange: (p: Prefs) => void, onSave: () => void }) {\n+  return (\n+    <form onSubmit={(e) => { e.preventDefault(); onSave() }}>\n+      <label>\n+        Business name\n+        <input value={value.businessName} onChange={(e) => onChange({ ...value, businessName: e.target.value })} />\n+      </label>\n+      <button type='submit'>Save</button>\n+    </form>\n+  )\n+}\ndiff --git a/frontend/settings/settingsApi.ts b/frontend/settings/settingsApi.ts\n@@ -0,0 +1,13 @@\n+export type Prefs = { businessName: string, currency: string, emailReceipts: boolean }\n+\n+const key = 'paylite-settings'\n+const defaults: Prefs = { businessName: '', currency: 'CAD', emailReceipts: true }\n+\n+export function loadPrefs(): Prefs {\n+  return defaults\n+}\n+\n+export function savePrefs(prefs: Prefs) {\n+  // TODO: persist preferences (key: paylite-settings)\n+  console.log('save', key, prefs)\n+}", "after": {"package.json": "{\n  \"name\": \"paylite\",\n  \"private\": true,\n  \"scripts\": {\n    \"dev\": \"vite\",\n    \"test\": \"vitest\"\n  },\n  \"dependencies\": {\n    \"react\": \"18.3.1\",\n    \"stripe\": \"17.4.0\"\n  }\n}\n", "package-lock.json": "{\n  \"name\": \"paylite\",\n  \"lockfileVersion\": 3,\n  \"packages\": {\n    \"node_modules/react\": { \"version\": \"18.3.1\" },\n    \"node_modules/stripe\": { \"version\": \"17.4.0\" }\n  }\n}\n", "frontend/App.tsx": "import { SettingsPage } from './settings/SettingsPage'\n\nexport function App() {\n  return (\n    <main>\n      <h1>PayLite</h1>\n      <SettingsPage />\n    </main>\n  )\n}\n", "frontend/settings/SettingsPage.tsx": "import { useState } from 'react'\nimport { PreferencesForm } from './PreferencesForm'\nimport { loadPrefs, savePrefs } from './settingsApi'\n\nexport function SettingsPage() {\n  const [prefs, setPrefs] = useState(loadPrefs())\n  return (\n    <section>\n      <h2>Settings</h2>\n      <PreferencesForm value={prefs} onChange={setPrefs} onSave={() => savePrefs(prefs)} />\n    </section>\n  )\n}\n", "frontend/settings/PreferencesForm.tsx": "import type { Prefs } from './settingsApi'\n\nexport function PreferencesForm({ value, onChange, onSave }: { value: Prefs, onChange: (p: Prefs) => void, onSave: () => void }) {\n  return (\n    <form onSubmit={(e) => { e.preventDefault(); onSave() }}>\n      <label>\n        Business name\n        <input value={value.businessName} onChange={(e) => onChange({ ...value, businessName: e.target.value })} />\n      </label>\n      <button type='submit'>Save</button>\n    </form>\n  )\n}\n", "frontend/settings/settingsApi.ts": "export type Prefs = { businessName: string, currency: string, emailReceipts: boolean }\n\nconst key = 'paylite-settings'\nconst defaults: Prefs = { businessName: '', currency: 'CAD', emailReceipts: true }\n\nexport function loadPrefs(): Prefs {\n  return defaults\n}\n\nexport function savePrefs(prefs: Prefs) {\n  // TODO: persist preferences (key: paylite-settings)\n  console.log('save', key, prefs)\n}\n"}}, {"sha": "6b14b07c0e75841051a1db0ec49c0ecf570be568", "authorLogin": "alex-demo", "authorName": "Alex Chen", "authorEmail": "alex-demo@users.noreply.github.com", "coAuthors": [], "message": "Scaffold payments service", "committedAt": "2026-11-02T19:30:00Z", "files": ["backend/payments/index.ts", "backend/payments/charge.ts"], "diff": "diff --git a/backend/payments/index.ts b/backend/payments/index.ts\n@@ -0,0 +1,8 @@\n+import express from 'express'\n+import { charge } from './charge'\n+\n+export const payments = express.Router()\n+\n+payments.post('/charge', async (req, res) => {\n+  res.status(501).json({ error: 'not implemented' })\n+})\ndiff --git a/backend/payments/charge.ts b/backend/payments/charge.ts\n@@ -0,0 +1,3 @@\n+export async function charge() {\n+  throw new Error('not implemented')\n+}", "after": {"backend/payments/index.ts": "import express from 'express'\nimport { charge } from './charge'\n\nexport const payments = express.Router()\n\npayments.post('/charge', async (req, res) => {\n  res.status(501).json({ error: 'not implemented' })\n})\n", "backend/payments/charge.ts": "export async function charge() {\n  throw new Error('not implemented')\n}\n"}}, {"sha": "44298962dcdb0f1ec4dbe19af3d9cc84b0f64fdb", "authorLogin": "alex-demo", "authorName": "Alex Chen", "authorEmail": "alex-demo@users.noreply.github.com", "coAuthors": [], "message": "Add Stripe test-mode client", "committedAt": "2026-11-04T16:05:00Z", "files": ["backend/payments/stripe.ts"], "diff": "diff --git a/backend/payments/stripe.ts b/backend/payments/stripe.ts\n@@ -0,0 +1,7 @@\n+import Stripe from 'stripe'\n+\n+const key = process.env.STRIPE_TEST_KEY\n+if (!key) throw new Error('STRIPE_TEST_KEY is required')\n+\n+// Test mode only: no real money moves.\n+export const stripe = new Stripe(key)", "after": {"backend/payments/stripe.ts": "import Stripe from 'stripe'\n\nconst key = process.env.STRIPE_TEST_KEY\nif (!key) throw new Error('STRIPE_TEST_KEY is required')\n\n// Test mode only: no real money moves.\nexport const stripe = new Stripe(key)\n"}}, {"sha": "7589c3c6811241b3faf3ce7eb71a1ff4ec801f4e", "authorLogin": "priya-demo", "authorName": "Priya Nair", "authorEmail": "priya-demo@users.noreply.github.com", "coAuthors": [], "message": "Add README and dev setup", "committedAt": "2026-11-06T21:40:00Z", "files": ["README.md"], "diff": "diff --git a/README.md b/README.md\n@@ -0,0 +1,12 @@\n+# PayLite\n+\n+Take card payments, issue refunds, see payment history.\n+\n+## Dev\n+\n+```\n+npm install\n+npm run dev\n+```\n+\n+Stripe runs in test mode (`STRIPE_TEST_KEY`).", "after": {"README.md": "# PayLite\n\nTake card payments, issue refunds, see payment history.\n\n## Dev\n\n```\nnpm install\nnpm run dev\n```\n\nStripe runs in test mode (`STRIPE_TEST_KEY`).\n"}}, {"sha": "38bb6599e3048ae3dcd54792a41454c4ef55b479", "authorLogin": "priya-demo", "authorName": "Priya Nair", "authorEmail": "priya-demo@users.noreply.github.com", "coAuthors": [], "message": "Checkout styles", "committedAt": "2026-11-16T15:00:00Z", "files": ["frontend/checkout/checkout.css"], "diff": "diff --git a/frontend/checkout/checkout.css b/frontend/checkout/checkout.css\n@@ -0,0 +1,3 @@\n+.checkout { display: grid; gap: 12px; max-width: 360px; }\n+.checkout .error { color: #b42318; margin: 0; }\n+.confirmation { text-align: center; }", "after": {"frontend/checkout/checkout.css": ".checkout { display: grid; gap: 12px; max-width: 360px; }\n.checkout .error { color: #b42318; margin: 0; }\n.confirmation { text-align: center; }\n"}}]
JSON
)
export OTHER_WEEKS TARGET WEEK2="$HERE/commits-week2.json"

node --input-type=module <<'NODE'
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const commits = [...JSON.parse(process.env.OTHER_WEEKS), ...JSON.parse(readFileSync(process.env.WEEK2, "utf8"))]
  .sort((a, b) => a.committedAt.localeCompare(b.committedAt));
const git = (args, env = {}, input) =>
  execFileSync("git", ["-C", process.env.TARGET, ...args], { env: { ...process.env, ...env }, input, stdio: ["pipe", "ignore", "inherit"] });

for (const c of commits) {
  for (const [path, content] of Object.entries(c.after)) {
    const file = join(process.env.TARGET, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-F", "-"], {
    GIT_AUTHOR_NAME: c.authorName, GIT_AUTHOR_EMAIL: c.authorEmail, GIT_AUTHOR_DATE: c.committedAt,
    GIT_COMMITTER_NAME: c.authorName, GIT_COMMITTER_EMAIL: c.authorEmail, GIT_COMMITTER_DATE: c.committedAt,
  }, c.message);
}
console.log(`Created ${commits.length} commits in ${process.env.TARGET}`);
NODE
