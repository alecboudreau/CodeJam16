# Group Project Enforcer

> An AI agent that tracks who is really doing the work in a student group project, nudges anyone falling behind on Discord, and writes a fair, evidence-backed contribution report. Built for **McGill CodeJam 16** (36 hours, team of 3).

**Primary track:** Agent Solution (judged on efficient use of compute, financially and environmentally, and on a demo that shows *how* the solution works).
**Backup track:** People First.

---

## 1. What it does

**Inputs:** one or more GitHub repos + a project spec document (PDF, Word or Markdown).

1. **Setup:** a user pastes the repo links, uploads the spec, and adds teammates (GitHub username, Discord ID, email), the deadline, the check-in frequency and a mode (`auto` or `approve_first`).
2. **Task map:** the big model reads the spec once and returns a task map. Each task has points (effort weight), an owner and repo paths.
3. **Approval:** the team edits and locks the task map. Scores are always based on this agreed map.
4. **Agent loop (every check-in):** observe → filter → judge → decide → act. Every step is written to a trace.
5. **Dashboard:** contribution share per member, task progress, evidence behind each score, a live **agent trace** and a **compute meter**.
6. **Nudges:** the Discord bot DMs a member who is behind, or posts in the group channel.
7. **Report:** a one-click peer-evaluation summary with points and evidence.

### The agent loop (core of the project)

| Step | What happens | Compute |
|---|---|---|
| 1. Observe | Pull new commits since the last check-in from all repos | GitHub API |
| 2. Filter | Drop lock files, `dist/`, `build/`, `vendor/`, `node_modules/`, minified files, whitespace/formatting-only diffs, and already-judged SHAs (cache) | **No AI** |
| 3. Judge | Rate each remaining change `substantial` or `light`, match it to a task, estimate % of task completed | **Small model**, batched |
| 3b. Escalate | Judgments with confidence < 0.6 are re-judged | **Big model**, only when unsure |
| 4. Decide | For each member compare progress vs owned tasks and deadline → `none`, `nudge`, `escalate`, `suggest_reassign`, each with a one-line reason | Plain code + small model for wording |
| 5. Act | Send or draft the Discord message, log it | discord.js |

Every LLM call logs tokens, cost and estimated energy. The **compute meter** compares this run with a naive baseline that sends every commit to the big model.

### Scoring

- Each task has `points` from the approved task map.
- Each judged change adds `points × completion_delta` to its author (light changes are capped at 10% of their estimate).
- **Member share = member's completed points ÷ total completed points.**
- Every score links to the tasks and example commits behind it.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Monorepo | npm workspaces (`frontend`, `backend`, `shared`) |
| Frontend | React + Vite, Tailwind CSS, Recharts, React Router |
| Backend | Node 20 + Express |
| Database | SQLite via `better-sqlite3` |
| GitHub | `@octokit/rest` + webhooks (`push` event) |
| LLM | Anthropic API: small model = `claude-haiku-5-5`, big model = `claude-sonnet-5-5` (set in `.env`) |
| Spec parsing | `pdf-parse` (PDF), `mammoth` (Word), raw text for Markdown |
| Discord | `discord.js` |
| Scheduler | `node-cron` |
| Validation | `zod` (shared schemas, LLM JSON output) |
| Local tunnel | `ngrok` (for GitHub webhooks during dev) |
| Deploy | Vercel (frontend), Render or Railway (backend + bot) |

---

## 3. Repo structure

```
group-project-enforcer/
├── README.md
├── package.json                 # npm workspaces root + scripts
├── .nvmrc                       # 20
├── .env.example
├── .gitignore
│
├── shared/                      # OWNER: Person A (contract; changes need a heads-up to all)
│   ├── package.json
│   └── src/
│       ├── types.ts             # all shared TS types (see section 6)
│       └── schemas.ts           # zod schemas for API + LLM output
│
├── backend/
│   ├── package.json
│   └── src/
│       ├── index.ts             # Express app, mounts routes          (A)
│       ├── config.ts            # env loading                          (A)
│       ├── db/
│       │   ├── schema.sql       # tables (see section 7)               (A)
│       │   └── db.ts            # better-sqlite3 helpers               (A)
│       ├── routes/
│       │   ├── projects.ts      # /api/projects, setup                 (A)
│       │   ├── taskmap.ts       # /api/projects/:id/taskmap            (A)
│       │   ├── checkin.ts       # /api/projects/:id/checkin, /trace    (A)
│       │   ├── dashboard.ts     # /api/projects/:id/dashboard, /meter  (A)
│       │   ├── report.ts        # /api/projects/:id/report             (A)
│       │   ├── spec.ts          # /api/projects/:id/spec (upload)      (C)
│       │   ├── webhook.ts       # /api/webhook/github                  (C)
│       │   └── simulate.ts      # /api/projects/:id/simulate           (C)
│       ├── agent/               # OWNER: Person A
│       │   ├── loop.ts          # runCheckin(projectId): orchestrates all steps
│       │   ├── observe.ts       # fetch new commits + diffs
│       │   ├── filter.ts        # plain-code filters + SHA cache
│       │   ├── judge.ts         # small-model batch judging + escalation
│       │   ├── decide.ts        # per-member decision rules
│       │   ├── act.ts           # hands messages to discord/notify
│       │   ├── scoring.ts       # points → shares, evidence
│       │   └── trace.ts         # writes trace steps to DB
│       ├── llm/                 # OWNER: Person A
│       │   ├── client.ts        # one wrapper: callSmall(), callBig(); logs tokens/cost/energy
│       │   ├── meter.ts         # cost + energy estimates, naive baseline
│       │   └── prompts/
│       │       ├── taskmap.ts
│       │       ├── judge.ts
│       │       ├── nudge.ts
│       │       └── report.ts
│       ├── github/              # OWNER: Person C
│       │   ├── client.ts        # Octokit wrapper: listCommits, getCommitDiff
│       │   └── webhook.ts       # verify signature, store raw push events
│       ├── spec/                # OWNER: Person C
│       │   └── extract.ts       # PDF/Word/MD → plain text
│       ├── discord/             # OWNER: Person C
│       │   ├── bot.ts           # login, sendDM(), postToChannel()
│       │   └── notify.ts        # notify(member, message) (Discord, later email)
│       ├── scheduler/           # OWNER: Person C
│       │   └── cron.ts          # runs runCheckin() every N days per project
│       └── demo/                # OWNER: Person C
│           ├── seed.ts          # seeds the demo project + members
│           └── replay.ts        # "Simulate 1 week": feeds pre-made commits into the loop
│
├── frontend/                    # OWNER: Person B
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              # routes
│       ├── api/
│       │   ├── client.ts        # fetch wrapper
│       │   └── mock.ts          # mock data matching shared types (use until backend is ready)
│       ├── pages/
│       │   ├── Setup.tsx        # repos, spec upload, team, deadline, mode
│       │   ├── TaskMap.tsx      # editable task table + "Lock map"
│       │   ├── Dashboard.tsx    # shares, task progress, timeline, evidence
│       │   ├── Trace.tsx        # agent trace (main demo view)
│       │   └── Report.tsx       # peer-eval report + copy/download
│       └── components/
│           ├── ShareChart.tsx
│           ├── TaskProgress.tsx
│           ├── ActivityTimeline.tsx
│           ├── EvidenceDrawer.tsx
│           ├── TraceStep.tsx
│           ├── ComputeMeter.tsx
│           └── SimulateButton.tsx
│
└── demo/                        # OWNER: Person C
    ├── spec.md                  # one-page demo spec (payments app)
    ├── make-demo-repo.sh        # creates the fake repo with dated commits
    └── commits-week2.json       # pre-made commits used by "Simulate 1 week"
```

---

## 4. Team split (3 people)

Each person owns folders, so we rarely edit the same files. Only `shared/` is common ground: change it only after telling the team.

### Person A: Agent + AI + API (backend core)
- `shared/` types and zod schemas (**first hour**: publish the contract so B and C can start)
- DB schema and helpers
- LLM wrapper with token/cost/energy logging, model routing (small vs big)
- Prompts: task map, judge, nudge, report (all return JSON validated with zod)
- Agent loop: observe → filter → judge → escalate → decide → act, trace logging
- Scoring and evidence
- Routes: projects, taskmap, checkin, trace, dashboard, meter, report

### Person B: Frontend
- Vite + React + Tailwind setup, routing
- `api/mock.ts` built from `shared/types.ts` so all pages work before the backend does
- Pages: Setup, TaskMap (editable + lock), Dashboard, Trace, Report
- Components: share chart, task progress, timeline, evidence drawer, trace steps (animated one by one), compute meter (ours vs naive), Simulate button
- Swap mocks for real API calls after the hour-14 integration point
- Final UI polish and loading/error states

### Person C: Integrations + demo + pitch
- GitHub client (commits, diffs) and webhook endpoint with signature check
- Spec upload + text extraction (PDF, Word, Markdown)
- Discord bot: DM a member, post to the group channel
- Scheduler (`node-cron`)
- Demo: `demo/spec.md`, the fake repo script, `commits-week2.json`, `seed.ts`, `replay.ts`
- Deploy (Vercel + Render/Railway), ngrok for dev
- Pitch slides, backup screen recording, rehearsal

### Who calls whom
- C's `github/client.ts` is called by A's `agent/observe.ts`
- C's `spec/extract.ts` output is passed to A's task-map prompt
- A's `agent/act.ts` calls C's `discord/notify.ts`
- C's `scheduler/cron.ts` and `demo/replay.ts` call A's `agent/loop.ts → runCheckin()`
- B only talks to the backend through the REST API below

---

## 5. API contract (REST, JSON, prefix `/api`)

| Method | Path | Body | Returns | Owner |
|---|---|---|---|---|
| POST | `/projects` | `{ name, repos: string[], members: MemberInput[], deadline, checkinEveryDays, mode }` | `Project` | A |
| GET | `/projects/:id` | – | `Project` | A |
| POST | `/projects/:id/spec` | multipart `file` | `{ chars: number }` | C |
| POST | `/projects/:id/taskmap/generate` | – | `TaskMap` | A |
| PUT | `/projects/:id/taskmap` | `{ tasks: Task[] }` | `TaskMap` | A |
| POST | `/projects/:id/taskmap/lock` | – | `TaskMap` | A |
| POST | `/projects/:id/checkin` | – | `{ checkinId }` | A |
| GET | `/projects/:id/trace?checkinId=` | – | `TraceStep[]` | A |
| GET | `/projects/:id/dashboard` | – | `Dashboard` | A |
| GET | `/projects/:id/meter` | – | `ComputeMeter` | A |
| GET | `/projects/:id/report` | – | `Report` | A |
| POST | `/projects/:id/simulate` | `{ days: 7 }` | `{ checkinId }` | C |
| POST | `/webhook/github` | GitHub push payload | `204` | C |

The trace endpoint is polled every 500 ms by the Trace page while a check-in runs (simple and reliable for the demo).

---

## 6. Shared types (`shared/src/types.ts`)

```ts
export type Mode = "auto" | "approve_first";

export interface Member {
  id: string;
  name: string;
  githubUsername: string;
  discordId?: string;
  email?: string;
}

export interface Project {
  id: string;
  name: string;
  repos: string[];            // "owner/repo"
  members: Member[];
  deadline: string;           // ISO date
  checkinEveryDays: number;
  mode: Mode;
  taskMapLocked: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  points: number;             // effort weight, 1–13
  ownerId: string;            // Member.id
  paths: string[];            // e.g. ["backend/payments/**"]
  completion: number;         // 0–1
}

export interface TaskMap { projectId: string; tasks: Task[]; locked: boolean; }

export interface Judgment {
  sha: string;
  repo: string;
  authorId: string;
  taskId: string | null;
  kind: "substantial" | "light" | "filtered";
  completionDelta: number;    // 0–1 of the task
  confidence: number;         // 0–1
  model: "none" | "small" | "big";
  reason: string;             // one line, shown as evidence
}

export type Action = "none" | "nudge" | "escalate" | "suggest_reassign";

export interface Decision {
  memberId: string;
  action: Action;
  reason: string;
  message?: string;
  sent: boolean;              // false when mode = approve_first and not yet approved
}

export interface TraceStep {
  checkinId: string;
  order: number;
  step: "observe" | "filter" | "judge" | "escalate" | "decide" | "act";
  summary: string;            // e.g. "Filtered 9 of 14 commits (no AI)"
  details?: unknown;
  at: string;
}

export interface MemberScore {
  memberId: string;
  commits: number;
  points: number;
  share: number;              // 0–1
  evidence: { taskId: string; points: number; shas: string[] }[];
}

export interface Dashboard {
  project: Project;
  scores: MemberScore[];
  tasks: Task[];
  timeline: { date: string; memberId: string; points: number }[];
}

export interface ComputeMeter {
  ours:  { tokens: number; usd: number; wh: number; aiCalls: number };
  naive: { tokens: number; usd: number; wh: number; aiCalls: number };
  filteredWithoutAi: number;
}

export interface Report { markdown: string; generatedAt: string; }
```

---

## 7. Database (`backend/src/db/schema.sql`)

```sql
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, repos TEXT, deadline TEXT,
  checkin_every_days INTEGER, mode TEXT, spec_text TEXT, taskmap_locked INTEGER DEFAULT 0);
CREATE TABLE members (id TEXT PRIMARY KEY, project_id TEXT, name TEXT,
  github_username TEXT, discord_id TEXT, email TEXT);
CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, description TEXT,
  points INTEGER, owner_id TEXT, paths TEXT, completion REAL DEFAULT 0);
CREATE TABLE raw_commits (sha TEXT PRIMARY KEY, project_id TEXT, repo TEXT,
  author_login TEXT, committed_at TEXT, files TEXT, diff TEXT, received_at TEXT);
CREATE TABLE judgments (sha TEXT PRIMARY KEY, project_id TEXT, author_id TEXT, task_id TEXT,
  kind TEXT, completion_delta REAL, confidence REAL, model TEXT, reason TEXT, checkin_id TEXT);
CREATE TABLE checkins (id TEXT PRIMARY KEY, project_id TEXT, started_at TEXT, finished_at TEXT);
CREATE TABLE trace_steps (checkin_id TEXT, ord INTEGER, step TEXT, summary TEXT,
  details TEXT, at TEXT);
CREATE TABLE decisions (id TEXT PRIMARY KEY, checkin_id TEXT, member_id TEXT, action TEXT,
  reason TEXT, message TEXT, sent INTEGER);
CREATE TABLE llm_calls (id TEXT PRIMARY KEY, project_id TEXT, checkin_id TEXT, purpose TEXT,
  model TEXT, input_tokens INTEGER, output_tokens INTEGER, usd REAL, wh REAL, at TEXT);
```

Lists (`repos`, `paths`, `files`) are stored as JSON strings.

---

## 8. LLM prompts (all return strict JSON, validated with zod; retry once on bad JSON)

- **Task map (big model, once per project):** input = spec text + member list. Output = `{ tasks: [{ title, description, points (1,2,3,5,8,13), ownerName, paths[] }] }`. Points must reflect effort, not count of files.
- **Judge (small model, batched up to 10 changes per call):** input = locked task map (id, title, paths) + for each change: author, files, trimmed diff (max ~150 lines each). Output per change = `{ sha, taskId|null, kind: substantial|light, completionDelta, confidence, reason }`. Rules: formatting, renames, comments and config tweaks are `light`; new logic, endpoints, UI features and tests are `substantial`.
- **Escalate (big model):** same prompt, only for confidence < 0.6.
- **Nudge (small model):** input = member name, their open tasks, days to deadline, tone = friendly. Output = `{ message }`, max 3 sentences, names one specific task.
- **Report (small model):** input = scores + evidence. Output = `{ markdown }`, neutral tone, one paragraph per member.

### Compute meter math (`llm/meter.ts`)
- `usd = input_tokens × in_price + output_tokens × out_price` (prices per model in `config.ts`)
- `wh = (input_tokens + output_tokens) × WH_PER_TOKEN[model]` (rough constants in config; label as "estimate" in the UI)
- **Naive baseline:** every observed commit sent alone to the big model with its full diff (estimate tokens as `diff_chars / 4`).

---

## 9. Getting started

```bash
nvm use                       # Node 20
npm install                   # installs all workspaces
cp .env.example .env          # fill in the keys (shared privately on Discord, never committed)
npm run db:init               # creates SQLite file from schema.sql
npm run dev                   # runs backend (:3001) + frontend (:5173) together
npm run demo:seed             # seeds the demo project
ngrok http 3001               # only needed to test real GitHub webhooks
```

### `.env.example`
```
PORT=3001
DATABASE_PATH=./data/enforcer.db
GITHUB_TOKEN=
GITHUB_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
SMALL_MODEL=claude-haiku-5-5
BIG_MODEL=claude-sonnet-5-5
DISCORD_BOT_TOKEN=
DISCORD_GROUP_CHANNEL_ID=
FRONTEND_URL=http://localhost:5173
VITE_API_URL=http://localhost:3001/api
VITE_USE_MOCKS=true
```

### Root scripts (`package.json`)
`dev`, `dev:backend`, `dev:frontend`, `db:init`, `demo:seed`, `demo:repo`, `build`, `lint`.

---

## 10. How we work

- **Branches:** never push to `main`. One branch per feature: `a/judge`, `b/dashboard`, `c/discord-bot`.
- **Merge small and often:** a quick PR every 2–3 hours; any teammate can skim and merge.
- **Pull before you start** something new.
- **Contract first:** `shared/` is published in hour 1. Changing it = message the team.
- **Mocks first:** the frontend runs on `VITE_USE_MOCKS=true` until hour 14.
- **Secrets:** `.env` is git-ignored; keys go in a private Discord DM.
- **Check-in:** 5 minutes every ~4 hours on what's done, what's blocked.
- **Issues:** one GitHub Issue per feature, assigned to its owner.

---

## 11. Timeline (36 hours)

| Hours | Person A (agent + API) | Person B (frontend) | Person C (integrations + demo) |
|---|---|---|---|
| 0–2 | Monorepo, `shared/` types, DB schema | Vite + Tailwind, routing, mocks | Discord bot app, GitHub token, demo spec, fake repo script |
| 2–8 | LLM wrapper + meter, task-map prompt, projects/taskmap routes | Setup + TaskMap pages | GitHub client, spec upload/extract, webhook |
| 8–14 | Filter, judge, escalate, scoring | Dashboard + Trace pages (on mocks) | Discord notify, scheduler, `replay.ts` |
| **14** | **Integration: frontend switches to the real API** | | |
| 14–20 | Decide + act, report, trace/meter endpoints | Compute meter, evidence drawer, Simulate button | Seed demo project, end-to-end demo run |
| **20** | **Checkpoint: full demo works end to end** | | |
| 20–26 | Sleep in shifts; bug fixes | Sleep in shifts; polish | Sleep in shifts; deploy |
| 26–30 | Should: dispute a judgment | Should: non-code work log UI | Should: email nudges |
| 30–34 | Cached fallback for the LLM | Loading/error states, final UI | Slides, backup recording |
| 34–36 | Rehearse pitch ×3 (all) | | |

**Rule:** no Should or Stretch work before the hour-20 checkpoint.

---

## 12. Demo script (3 minutes)

1. **Hook:** "Raise your hand if you've carried a group project."
2. **Problem:** peer evals run on memory and politics, and commit counts are easy to game.
3. **Live:**
   - Paste the repo, upload `demo/spec.md` → the task map appears with points → lock it
   - Click **Simulate 1 week** → the **agent trace** plays step by step:
     *Pulled 14 commits → filtered 9 with no AI → small model judged 5 → 1 escalated → Sam is behind on "Dashboard UI" → nudge sent*
   - The nudge pops up in Discord on screen
   - Dashboard: **"Jordan: 22 commits but 8%"** vs **"Alex: 6 commits but 45%"**; open Jordan's evidence (mostly formatting)
   - Point at the **compute meter**: this run cost cents vs dollars for the naive approach
   - Click **Generate report**
4. **Close:** an agent that spends compute only where it matters, shows every decision, and keeps group work fair.

### Demo data
- 4 members: **Alex** (6 big commits, finishes the payment API, ~45%), **Priya** (frontend, ~35%), **Jordan** (22 small formatting commits, ~8%), **Sam** (nothing, gets nudged).
- `demo/make-demo-repo.sh` uses `git commit --date` so the timeline looks like 3 real weeks.
- Keep a **cached fallback** of the task map, judgments, nudge and report in case the Wi-Fi or API fails, plus a **screen recording** of the full demo.

---

## 13. Out of scope (for this hackathon)

Private repos / GitHub OAuth, Google Docs tracking, Slack, SMS, mobile app, grading or penalties. The tool informs; it never decides marks.

---

## 14. Notes for Claude Code

- Read this README first; `shared/src/types.ts` is the source of truth for data shapes.
- Work only inside the folders owned by the person you are helping (section 4) unless told otherwise.
- Every LLM call goes through `backend/src/llm/client.ts` so tokens and cost are always logged.
- LLM outputs must be validated with the zod schemas in `shared/src/schemas.ts`.
- Prefer simple, readable code over clever abstractions: this is a 36-hour build.
