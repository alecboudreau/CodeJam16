# Group Project Enforcer *(working name, final name TBD)*

> Keeps student group projects on track. The team agrees on a plan up front, then an AI agent watches the repo, notices when someone is falling behind on their part, and gives them a friendly nudge on Discord before it turns into a problem. If it never gets fixed, there's a fair, evidence-backed contribution summary at the end.

Built for **McGill CodeJam 16** (36 hours, team of 3).

**Primary track:** Agent Solution (judged on efficient use of compute, financially and environmentally, and on a demo that shows *how* the solution works).
**Backup track:** People First.

---

## 1. The problem and the idea

Every group project has the same awkward moment: someone has gone quiet, the deadline is getting close, and nobody wants to be the person who says something. By the time it comes up, it's too late, and peer evaluations end up running on memory and politics.

**Group Project Enforcer is a fairness tool the whole team opts into.** It does the awkward part for you:

- **Nudges, not punishments.** When someone falls behind on *their* agreed tasks, the bot DMs them a friendly, specific reminder. Only if that's ignored does it post a gentle "this task could use a hand" note in the group channel.
- **It listens before it judges.** Every nudge has buttons: *On it*, *Blocked*, *Need help*. If Sam is blocked by Alex, the bot stops nudging Sam and nudges Alex.
- **Commit counts lie, so it reads the work.** 22 formatting commits count for less than one commit that ships the payment API.
- **Every score shows its evidence, and anyone can dispute it.**

### Why trust it?

> It judges every commit against the same plan the whole team agreed on, shows the evidence behind every score, and anyone can dispute a judgment.

It's consistent, transparent and open to challenge. It doesn't claim to be "objective", and it **never decides marks**: it informs the team.

### Principles

1. **Consent first.** Everyone links their own Discord account and approves the task map. Nobody gets tracked secretly.
2. **The plan is the referee.** Progress is measured against the agreed task map, not against teammates.
3. **Help, don't shame.** Public messages name the *task* and offer help. They never show percentages or blame.
4. **No human gatekeeper.** The rules are agreed up front and the bot applies them automatically, so no single student holds power over the others.
5. **Spend compute only where it matters.** Plain code filters most commits, a small model judges the rest, and the big model only sees the hard cases.

---

## 2. How it works

### 2.1 Setup (once per project)

1. One person creates the project: GitHub repo links, the project spec (PDF, Word or Markdown), the deadline, and each teammate's name and GitHub username.
2. Each teammate joins the team's Discord server and types **`/link <github-username>`**. This connects their Discord account and counts as their opt-in.
3. The big model reads the spec **once** and drafts a **task map**: tasks with effort points, an owner and repo paths. Tasks with no code (slides, written report) are marked **untracked**.
4. The team edits the map. It **locks only when every member clicks "I agree."**

### 2.2 Changing the plan

Plans change. Anyone can propose an edit to a locked map (add, drop or reassign tasks, change points). The change only applies once **every member agrees again**. Progress already made is kept.

### 2.3 The daily check-in (core of the project)

Every day at **6 pm** the agent runs one check-in: observe → filter → judge → decide → act. Each step is written to a **trace** the team can watch live.

| Step | What happens | Compute |
|---|---|---|
| 1. Observe | Pull new commits since the last check-in from all repos | GitHub API |
| 2. Filter | Drop lock files, `dist/`, `build/`, `vendor/`, `node_modules/`, minified files, whitespace/formatting-only diffs, and already-judged SHAs | **No AI** |
| 3. Judge | Rate each remaining change `substantial` or `light`, match it to a task, estimate % of the task completed | **Small model**, batched |
| 3b. Escalate | Judgments with confidence < 0.6 are re-judged | **Big model**, only when unsure |
| 4. Decide | For each member: are they behind? Did they press a button? Are they in cooldown? → an action and a one-line reason | **Plain code** |
| 5. Act | Write the message and send it on Discord, then log it | **Small model** for wording, discord.js |

Every LLM call logs tokens, cost and estimated energy. The **compute meter** compares the real run with a naive baseline that sends every commit to the big model.

### 2.4 Who gets credit

- A commit is credited to its **GitHub author** plus anyone listed in a `Co-authored-by:` line, **split evenly**.
- Commits from an unknown GitHub account show as **unmatched** on the dashboard, where a teammate can assign that account to a member (e.g. Jordan's laptop with a different git identity).

### 2.5 What "behind" means

A member is **behind** on their tracked tasks if either is true:

- **Behind the clock:** their progress is more than **25 points below** the share of project time that has passed.
  *Example: 40% of the time has gone and Sam's tasks are 10% done, which is 30 behind, so Sam is behind.*
- **Gone quiet:** **5 days** with no substantial commit while they still have unfinished tracked tasks.

Time elapsed is measured from the moment the task map was locked to the deadline. How a member compares with teammates is **never a trigger**. It may be used in the wording ("the rest of the team is about halfway").

**Untracked tasks** (slides, report, anything without code) never trigger a nudge.

### 2.6 Nudges, buttons and escalation

When a member is behind, the agent follows this ladder:

1. **Friendly DM** naming one specific task, with three buttons:
   - **On it**: no more nudges for 2 days.
   - **Blocked** → pick who you're waiting on: the member's nudges pause, and the **blocker** gets a nudge ("Sam is waiting on *Payment history endpoint*").
   - **Need help**: a group post right away asking if anyone can pair on that task.
2. **Second DM**, a bit firmer, if the first was **ignored**: no button pressed and no progress on that task by the next nudge window.
3. **Group post** after **2 ignored DMs**: names the task, offers help, never shames.
   *"Dashboard UI could use a hand. Anyone free to pair with Sam this week?"*

**Rate limit:** at most **one nudge per person every 2 days**, so the group post comes about 4–5 days after someone first falls behind.

### 2.7 Scoring

- Each task has `points` (1, 2, 3, 5, 8, 13) from the agreed task map.
- Each judged change adds `points × completionDelta` to its author(s). Light changes are capped at 10% of their estimate.
- **Member share = the member's completed points ÷ total completed points.**
- Every score links to the tasks and example commits behind it.

### 2.8 Disputes *(Should)*

If a member thinks a judgment is wrong, they click **Dispute** and add a one-line note ("this is the core chart logic, not a tweak"). The **big model re-judges** the commit with that note as context, and its answer is final. The trace shows `disputed → re-judged → 2% → 12%`.

### 2.9 The report

At any time, one click produces a neutral contribution summary for the team: one paragraph per member with points and evidence. It's the safety net, not the main feature, so it's kept simple: one small-model call.

---

## 3. Scope

| Priority | Feature |
|---|---|
| **Must** | Setup, spec upload, task map generation, unanimous lock, daily check-in loop, filter / judge / escalate, scoring + evidence, decide rules, Discord DMs with buttons, `/link`, group posts, dashboard, live trace, compute meter, simple report, "Simulate 1 week" demo |
| **Should** | Disputes, proposing changes to a locked map, GitHub push webhooks (check-ins pull commits anyway), email nudges, cached LLM fallback for the demo |
| **Stretch** | Free-text replies to the bot ("blocked, waiting on Alex") read by the small model |
| **Future ideas** | Professor/TA view of reports, Slack, Google Docs/Figma evidence |
| **Out of scope** | Private repos / GitHub OAuth, user accounts, mobile app, grading or penalties |

**Rule:** no Should or Stretch work before the hour-20 checkpoint.

---

## 4. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Monorepo | npm workspaces (`frontend`, `backend`, `shared`) |
| Frontend | React + Vite, Tailwind CSS, Recharts, React Router |
| Backend | Node 20 + Express |
| Database | SQLite via `better-sqlite3` |
| GitHub | `@octokit/rest` (webhooks are Should) |
| LLM | Anthropic API: small model = `claude-haiku-5-5`, big model = `claude-sonnet-5-5` (set in `.env`) |
| Spec parsing | `pdf-parse` (PDF), `mammoth` (Word), raw text for Markdown |
| Discord | `discord.js`: DMs, group posts, buttons, select menus, `/link` slash command |
| Scheduler | `node-cron` (daily at 18:00) |
| Validation | `zod` (shared schemas, LLM JSON output) |
| Deploy | Vercel (frontend), Render or Railway (backend + bot) |

**No user accounts.** For the hackathon the web app has a "Who are you?" member picker (used for "I agree" and disputes). Real auth is out of scope.

---

## 5. Repo structure

```
group-project-enforcer/
├── README.md
├── package.json                 # npm workspaces root + scripts
├── .nvmrc                       # 20
├── .env.example
├── .gitignore
│
├── shared/                      # OWNER: Person A (contract; changes need a heads-up to all)
│   └── src/
│       ├── types.ts             # all shared TS types (see section 8)
│       └── schemas.ts           # zod schemas for API + LLM output
│
├── backend/src/
│   ├── index.ts                 # Express app, mounts routes             (A)
│   ├── config.ts                # env + tunable constants (section 10)   (A)
│   ├── db/
│   │   ├── schema.sql           # tables (see section 9)                 (A)
│   │   └── db.ts                # better-sqlite3 helpers                 (A)
│   ├── routes/
│   │   ├── projects.ts          # /api/projects, members, aliases        (A)
│   │   ├── taskmap.ts           # taskmap generate / edit / agree        (A)
│   │   ├── checkin.ts           # /checkin, /trace                       (A)
│   │   ├── dashboard.ts         # /dashboard, /meter                     (A)
│   │   ├── report.ts            # /report                                (A)
│   │   ├── judgments.ts         # /judgments/:sha/dispute (Should)       (A)
│   │   ├── spec.ts              # /spec (upload)                         (C)
│   │   ├── simulate.ts          # /simulate                              (C)
│   │   └── webhook.ts           # /webhook/github (Should)               (C)
│   ├── agent/                   # OWNER: Person A
│   │   ├── loop.ts              # runCheckin(projectId): orchestrates all steps
│   │   ├── observe.ts           # fetch new commits + diffs, parse Co-authored-by
│   │   ├── filter.ts            # plain-code filters + SHA cache
│   │   ├── judge.ts             # small-model batch judging + escalation + dispute re-judge
│   │   ├── decide.ts            # behind rules, button statuses, cooldown, ladder
│   │   ├── act.ts               # writes messages, hands them to discord/notify
│   │   ├── scoring.ts           # points → shares, evidence
│   │   └── trace.ts             # writes trace steps to DB
│   ├── llm/                     # OWNER: Person A
│   │   ├── client.ts            # callSmall(), callBig(); logs tokens/cost/energy
│   │   ├── meter.ts             # cost + energy estimates, naive baseline
│   │   └── prompts/
│   │       ├── taskmap.ts
│   │       ├── judge.ts
│   │       ├── nudge.ts         # DM, blocker DM and group post wording
│   │       └── report.ts
│   ├── github/                  # OWNER: Person C
│   │   ├── client.ts            # Octokit wrapper: listCommits, getCommitDiff
│   │   └── webhook.ts           # verify signature, store raw push events (Should)
│   ├── spec/                    # OWNER: Person C
│   │   └── extract.ts           # PDF/Word/MD → plain text
│   ├── discord/                 # OWNER: Person C
│   │   ├── bot.ts               # login, sendDM(), postToChannel()
│   │   ├── interactions.ts      # /link command, nudge buttons, "blocked by" select menu
│   │   └── notify.ts            # notify(member, nudge) (Discord, later email)
│   ├── scheduler/               # OWNER: Person C
│   │   └── cron.ts              # runs runCheckin() daily at 18:00 per project
│   └── demo/                    # OWNER: Person C
│       ├── seed.ts              # seeds the demo project + members
│       └── replay.ts            # "Simulate 1 week": feeds pre-made commits into the loop
│
├── frontend/src/                # OWNER: Person B
│   ├── main.tsx
│   ├── App.tsx                  # routes + "Who are you?" member picker
│   ├── api/
│   │   ├── client.ts            # fetch wrapper
│   │   └── mock.ts              # mock data matching shared types (until hour 14)
│   ├── pages/
│   │   ├── Setup.tsx            # repos, spec upload, team, deadline, /link status
│   │   ├── TaskMap.tsx          # editable task table, tracked toggle, "I agree" per member
│   │   ├── Dashboard.tsx        # shares, task progress, statuses, unmatched commits, evidence
│   │   ├── Trace.tsx            # agent trace (main demo view)
│   │   └── Report.tsx           # contribution report + copy/download
│   └── components/
│       ├── ShareChart.tsx
│       ├── TaskProgress.tsx
│       ├── ActivityTimeline.tsx
│       ├── EvidenceDrawer.tsx   # incl. Dispute button (Should)
│       ├── MemberStatus.tsx     # "On it" / "Blocked by Alex" / "Needs help" badges
│       ├── AgreeBar.tsx         # who has agreed to the current task map
│       ├── TraceStep.tsx
│       ├── ComputeMeter.tsx
│       └── SimulateButton.tsx
│
└── demo/                        # OWNER: Person C
    ├── spec.md                  # one-page demo spec (payments app)
    ├── make-demo-repo.sh        # creates the fake repo with dated commits
    └── commits-week2.json       # pre-made commits used by "Simulate 1 week"
```

---

## 6. Team split (3 people)

Each person owns folders, so we rarely edit the same files. Only `shared/` is common ground: change it only after telling the team.

### Person A: Agent + AI + API (backend core)
- `shared/` types and zod schemas (**first hour**: publish the contract so B and C can start)
- DB schema and helpers
- LLM wrapper with token/cost/energy logging and model routing (small vs big)
- Prompts: task map, judge, nudge (DM / blocker / group post), report, all returning JSON validated with zod
- Agent loop: observe → filter → judge → escalate → decide → act, with trace logging
- Decide rules: behind-the-clock, gone-quiet, button statuses, cooldown, escalation ladder
- Scoring with co-author splitting, and evidence
- Routes: projects, members/aliases, taskmap (generate / edit / agree), checkin, trace, dashboard, meter, report

### Person B: Frontend
- Vite + React + Tailwind setup, routing, member picker
- `api/mock.ts` built from `shared/types.ts` so every page works before the backend does
- Pages: Setup (with per-member `/link` status), TaskMap (editable, tracked toggle, unanimous agree), Dashboard, Trace, Report
- Components: share chart, task progress, member status badges, unmatched-commit assignment, timeline, evidence drawer, animated trace steps, compute meter (ours vs naive), Simulate button
- Switch the mocks to real API calls at the hour-14 integration point
- Final UI polish and loading/error states

### Person C: Integrations + demo + pitch
- GitHub client (commits, diffs)
- Spec upload + text extraction (PDF, Word, Markdown)
- Discord bot: DMs, group posts, `/link` command, nudge buttons + "blocked by" select menu, all feeding member statuses back to the backend
- Scheduler (`node-cron`, daily at 18:00)
- Demo: `demo/spec.md`, the fake repo script, `commits-week2.json`, `seed.ts`, `replay.ts`
- Deploy (Vercel + Render/Railway)
- Pitch slides, backup screen recording, rehearsal
- *Should:* GitHub push webhook with signature check, email nudges

### Who calls whom
- C's `github/client.ts` is called by A's `agent/observe.ts`
- C's `spec/extract.ts` output is passed to A's task-map prompt
- A's `agent/act.ts` calls C's `discord/notify.ts`
- C's `discord/interactions.ts` writes `/link` and button presses through A's DB helpers (`linkDiscord()`, `setMemberStatus()`)
- C's `scheduler/cron.ts` and `demo/replay.ts` call A's `agent/loop.ts → runCheckin()`
- B only talks to the backend through the REST API below

---

## 7. API contract (REST, JSON, prefix `/api`)

| Method | Path | Body | Returns | Owner |
|---|---|---|---|---|
| POST | `/projects` | `{ name, repos: string[], members: MemberInput[], deadline }` | `Project` | A |
| GET | `/projects/:id` | – | `Project` | A |
| POST | `/projects/:id/members/:memberId/aliases` | `{ githubLogin }` | `Member` | A |
| POST | `/projects/:id/spec` | multipart `file` | `{ chars: number }` | C |
| POST | `/projects/:id/taskmap/generate` | – | `TaskMap` | A |
| PUT | `/projects/:id/taskmap` | `{ tasks: Task[] }` | `TaskMap` | A |
| POST | `/projects/:id/taskmap/agree` | `{ memberId }` | `TaskMap` | A |
| POST | `/projects/:id/checkin` | – | `{ checkinId }` | A |
| GET | `/projects/:id/trace?checkinId=` | – | `TraceStep[]` | A |
| GET | `/projects/:id/dashboard` | – | `Dashboard` | A |
| GET | `/projects/:id/meter` | – | `ComputeMeter` | A |
| GET | `/projects/:id/report` | – | `Report` | A |
| POST | `/projects/:id/simulate` | `{ days: 7 }` | `{ checkinId }` | C |
| POST | `/projects/:id/judgments/:sha/dispute` | `{ memberId, note }` | `Judgment` | A *(Should)* |
| POST | `/webhook/github` | GitHub push payload | `204` | C *(Should)* |

**Task map editing and agreeing:**
- Before the first lock, `PUT /taskmap` edits the draft. After the lock, it creates a **pending change** (Should). Either way, every `PUT` clears all agreements.
- `POST /taskmap/agree` records one member's agreement. Once **every member** has agreed, the draft locks, or the pending change is applied, and `version` goes up by one.

The trace endpoint is polled every 500 ms by the Trace page while a check-in runs (simple and reliable for the demo).

---

## 8. Shared types (`shared/src/types.ts`)

```ts
export interface MemberInput {
  name: string;
  githubUsername: string;
  email?: string;
}

export type MemberStatus = "none" | "on_it" | "blocked" | "need_help";

export interface Member {
  id: string;
  name: string;
  githubUsername: string;
  githubAliases: string[];    // extra logins assigned from "unmatched"
  discordId?: string;         // set by /link; undefined = not opted in yet
  email?: string;
  status: MemberStatus;       // latest button press
  blockedById?: string;       // Member.id, when status = "blocked"
  statusAt?: string;          // ISO; "on_it" expires after NUDGE_COOLDOWN_DAYS
}

export interface Project {
  id: string;
  name: string;
  repos: string[];            // "owner/repo"
  members: Member[];
  deadline: string;           // ISO date
  createdAt: string;
  lockedAt?: string;          // first lock; start of the "behind the clock" timeline
  taskMapLocked: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  points: number;             // effort weight: 1, 2, 3, 5, 8, 13
  ownerId: string;            // Member.id
  paths: string[];            // e.g. ["backend/payments/**"]; empty when untracked
  tracked: boolean;           // false = non-code task, never nudged
  completion: number;         // 0–1
}

export interface TaskMap {
  projectId: string;
  version: number;            // bumps on every lock / applied change
  locked: boolean;
  tasks: Task[];              // the current agreed (or draft, if never locked) map
  pending: Task[] | null;     // proposed change to a locked map (Should)
  agreedBy: string[];         // Member.ids agreeing to the draft / pending change
}

export interface Judgment {
  sha: string;
  repo: string;
  authorIds: string[];        // author + Co-authored-by, credit split evenly
  unmatchedLogin?: string;    // set when the author matches no member
  taskId: string | null;
  kind: "substantial" | "light" | "filtered";
  completionDelta: number;    // 0–1 of the task
  confidence: number;         // 0–1
  model: "none" | "small" | "big";
  reason: string;             // one line, shown as evidence
  dispute?: { memberId: string; note: string; previousDelta: number }; // Should
}

export type Action =
  | "none"                    // on track, or in cooldown
  | "wait"                    // pressed "On it", or blocked (nudges paused)
  | "nudge"                   // DM to the member
  | "nudge_blocker"           // DM to whoever is blocking a teammate
  | "group_post";             // after 2 ignored DMs, or "Need help"

export interface Decision {
  memberId: string;
  taskId: string | null;
  action: Action;
  reason: string;             // one line, e.g. "30 pts behind the clock on Dashboard UI"
  ignoredCount: number;       // ignored DMs so far for this task (drives tone + ladder)
  message?: string;
  sentAt?: string;
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
  unmatched: { login: string; commits: number }[];
}

export interface ComputeMeter {
  ours:  { tokens: number; usd: number; wh: number; aiCalls: number };
  naive: { tokens: number; usd: number; wh: number; aiCalls: number };
  filteredWithoutAi: number;
}

export interface Report { markdown: string; generatedAt: string; }
```

---

## 9. Database (`backend/src/db/schema.sql`)

```sql
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, repos TEXT, deadline TEXT,
  spec_text TEXT, created_at TEXT, locked_at TEXT, taskmap_locked INTEGER DEFAULT 0,
  taskmap_version INTEGER DEFAULT 0, pending_tasks TEXT);
CREATE TABLE members (id TEXT PRIMARY KEY, project_id TEXT, name TEXT,
  github_username TEXT, github_aliases TEXT DEFAULT '[]', discord_id TEXT, email TEXT,
  status TEXT DEFAULT 'none', blocked_by_id TEXT, status_at TEXT);
CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, description TEXT,
  points INTEGER, owner_id TEXT, paths TEXT, tracked INTEGER DEFAULT 1,
  completion REAL DEFAULT 0);
CREATE TABLE taskmap_agreements (project_id TEXT, member_id TEXT, at TEXT,
  PRIMARY KEY (project_id, member_id));
CREATE TABLE raw_commits (sha TEXT PRIMARY KEY, project_id TEXT, repo TEXT,
  author_login TEXT, co_authors TEXT, message TEXT, committed_at TEXT, files TEXT,
  diff TEXT, received_at TEXT);
CREATE TABLE judgments (sha TEXT PRIMARY KEY, project_id TEXT, author_ids TEXT,
  unmatched_login TEXT, task_id TEXT, kind TEXT, completion_delta REAL, confidence REAL,
  model TEXT, reason TEXT, checkin_id TEXT, dispute TEXT);
CREATE TABLE checkins (id TEXT PRIMARY KEY, project_id TEXT, started_at TEXT, finished_at TEXT);
CREATE TABLE trace_steps (checkin_id TEXT, ord INTEGER, step TEXT, summary TEXT,
  details TEXT, at TEXT);
CREATE TABLE decisions (id TEXT PRIMARY KEY, checkin_id TEXT, member_id TEXT, task_id TEXT,
  action TEXT, reason TEXT, ignored_count INTEGER, message TEXT, sent_at TEXT);
CREATE TABLE llm_calls (id TEXT PRIMARY KEY, project_id TEXT, checkin_id TEXT, purpose TEXT,
  model TEXT, input_tokens INTEGER, output_tokens INTEGER, usd REAL, wh REAL, at TEXT);
```

Lists (`repos`, `paths`, `files`, `co_authors`, `github_aliases`, `author_ids`, `pending_tasks`) and `dispute` are stored as JSON strings. Agreements are cleared whenever the draft or pending change is edited.

---

## 10. Agent rules (`backend/src/agent/decide.ts`)

All thresholds live in `config.ts` so they're easy to tune:

```ts
BEHIND_CLOCK_THRESHOLD = 0.25   // progress more than 25 pts below time elapsed
QUIET_DAYS             = 5      // no substantial commit for 5 days
NUDGE_COOLDOWN_DAYS    = 2      // max one nudge per person per 2 days; "On it" lasts this long
IGNORED_DMS_BEFORE_GROUP = 2    // 2 ignored DMs → group post
CHECKIN_CRON           = "0 18 * * *"  // daily at 6 pm
LIGHT_CAP              = 0.10   // light changes count for at most 10% of their estimate
ESCALATE_BELOW         = 0.6    // re-judge with the big model below this confidence
```

For each member, every check-in, in this order:

1. **No unfinished tracked tasks** → `none`.
2. **Status `blocked`** and the blocker hasn't progressed on the blocking task → `wait` for this member, and `nudge_blocker` for the blocker (if the blocker isn't in cooldown). Status clears once the blocker makes progress.
3. **Status `need_help`** (pressed since the last check-in) → `group_post` asking for help on that task.
4. **Status `on_it`** and pressed within the last 2 days → `wait`.
5. **Not behind** (neither behind the clock nor quiet) → `none`.
6. **Nudged within the last 2 days** → `none` (cooldown).
7. **Behind:** pick the unfinished tracked task with the most points remaining.
   - `ignoredCount < 2` → `nudge` (tone: friendly at 0, firmer at 1)
   - `ignoredCount >= 2` → `group_post`, then reset the count

A DM counts as **ignored** when no button was pressed and the task gained no progress before the next nudge window. Decisions are plain code. The small model only writes the wording.

---

## 11. LLM prompts (all return strict JSON, validated with zod; retry once on bad JSON)

- **Task map (big model, once per project):** input = spec text + member list. Output = `{ tasks: [{ title, description, points (1,2,3,5,8,13), ownerName, paths[], tracked }] }`. Points reflect effort, not number of files. `tracked = false` for non-code tasks.
- **Judge (small model, batched up to 10 changes per call):** input = locked task map (id, title, paths) + for each change: authors, files, trimmed diff (max ~150 lines each). Output per change = `{ sha, taskId|null, kind: substantial|light, completionDelta, confidence, reason }`. Rules: formatting, renames, comments and config tweaks are `light`; new logic, endpoints, UI features and tests are `substantial`.
- **Escalate (big model):** same prompt, only for confidence < 0.6.
- **Dispute (big model, Should):** same prompt for one change, plus the member's note.
- **Nudge (small model):** input = kind (`dm` | `blocker_dm` | `group_post`), member name, the task, days to deadline, `ignoredCount`, and who is waiting (for `blocker_dm`). Output = `{ message }`, max 3 sentences, names one specific task. Group posts offer help and never mention percentages or blame.
- **Report (small model):** input = scores + evidence. Output = `{ markdown }`, neutral tone, one paragraph per member.

### Compute meter math (`llm/meter.ts`)
- `usd = input_tokens × in_price + output_tokens × out_price` (prices per model in `config.ts`)
- `wh = (input_tokens + output_tokens) × WH_PER_TOKEN[model]` (rough constants in config; labelled "estimate" in the UI)
- **Naive baseline:** every observed commit sent alone to the big model with its full diff (tokens estimated as `diff_chars / 4`).

---

## 12. Getting started

```bash
nvm use                       # Node 20
npm install                   # installs all workspaces
cp .env.example .env          # fill in the keys (shared privately on Discord, never committed)
npm run db:init               # creates SQLite file from schema.sql
npm run dev                   # runs backend (:3001) + frontend (:5173) together
npm run demo:seed             # seeds the demo project
```

### `.env.example`
```
PORT=3001
DATABASE_PATH=./data/enforcer.db
GITHUB_TOKEN=
GITHUB_WEBHOOK_SECRET=          # Should: only needed for push webhooks
ANTHROPIC_API_KEY=
SMALL_MODEL=claude-haiku-5-5
BIG_MODEL=claude-sonnet-5-5
DISCORD_BOT_TOKEN=
DISCORD_APP_ID=                 # for registering the /link command
DISCORD_GUILD_ID=               # the team's server
DISCORD_GROUP_CHANNEL_ID=
TZ=America/Toronto              # check-in cron runs in this timezone
FRONTEND_URL=http://localhost:5173
VITE_API_URL=http://localhost:3001/api
VITE_USE_MOCKS=true
```

### Root scripts (`package.json`)
`dev`, `dev:backend`, `dev:frontend`, `db:init`, `demo:seed`, `demo:repo`, `build`, `lint`.

---

## 13. How we work

- **Branches:** never push to `main`. One branch per feature: `a/judge`, `b/dashboard`, `c/discord-bot`.
- **Merge small and often:** a quick PR every 2–3 hours; any teammate can skim and merge.
- **Pull before you start** something new.
- **Contract first:** `shared/` is published in hour 1. Changing it = message the team.
- **Mocks first:** the frontend runs on `VITE_USE_MOCKS=true` until hour 14.
- **Secrets:** `.env` is git-ignored; keys go in a private Discord DM.
- **Check-in:** 5 minutes every ~4 hours on what's done, what's blocked.
- **Issues:** one GitHub Issue per feature, assigned to its owner.

---

## 14. Timeline (36 hours)

| Hours | Person A (agent + API) | Person B (frontend) | Person C (integrations + demo) |
|---|---|---|---|
| 0–2 | Monorepo, `shared/` types, DB schema | Vite + Tailwind, routing, mocks | Discord bot app + server, GitHub token, demo spec, fake repo script |
| 2–8 | LLM wrapper + meter, task-map prompt, projects + taskmap routes (incl. agree) | Setup + TaskMap pages (agree bar, tracked toggle) | GitHub client (+ co-authors), spec upload/extract, `/link` command |
| 8–14 | Filter, judge, escalate, scoring | Dashboard + Trace pages (on mocks) | DMs + group posts, nudge buttons + "blocked by" menu, scheduler, `replay.ts` |
| **14** | **Integration: frontend switches to the real API** | | |
| 14–20 | Decide rules + act, nudge prompts, report, trace/meter endpoints | Compute meter, evidence drawer, status badges, unmatched commits, Simulate button | Seed demo project, end-to-end demo run incl. the "Blocked" moment |
| **20** | **Checkpoint: full demo works end to end** | | |
| 20–26 | Sleep in shifts; bug fixes | Sleep in shifts; polish | Sleep in shifts; deploy |
| 26–30 | Should: disputes, pending map changes | Should: dispute UI, propose-change UI | Should: webhooks, email nudges |
| 30–34 | Cached LLM fallback | Loading/error states, final UI | Slides, backup recording |
| 34–36 | Rehearse pitch ×3 (all) | | |

---

## 15. Demo script (3 minutes)

1. **Hook:** "Raise your hand if you've had a teammate go quiet and nobody wanted to say anything."
2. **Problem:** by the time it comes up, it's too late, and peer evals run on memory and politics. Commit counts don't help: they're easy to game.
3. **Live:**
   - Paste the repo, upload `demo/spec.md` → the task map appears with points (slides marked *untracked*) → all four members click **I agree** → locked
   - Click **Simulate 1 week** → the **agent trace** plays step by step:
     *Pulled 14 commits → filtered 9 with no AI → small model judged 5 → 1 escalated → Sam is 30 pts behind on "Dashboard UI" → nudge sent*
   - The nudge pops up in Discord on screen. Sam taps **Blocked → Alex**
   - Click **Run check-in** → the trace shows: *Sam blocked by Alex → paused Sam's nudges → nudged Alex about "Payment history endpoint"*
   - Dashboard: **"Jordan: 22 commits but 8%"** vs **"Alex: 6 commits but 45%"**; open Jordan's evidence (mostly formatting)
   - Point at the **compute meter**: this run cost cents, the naive approach costs dollars
   - Click **Generate report**
4. **Close:** "An agent that spends compute only where it matters, shows every decision, and gets the team talking before it's too late."

### Demo data
- 4 members, all `/link`ed:
  - **Alex**: 6 big commits, finished the payment API but not the *Payment history endpoint*, ~45%
  - **Priya**: frontend, ~35%, also owns the untracked *Pitch slides* (never nudged)
  - **Jordan**: 22 small formatting commits, ~8%, some from an unmatched git identity
  - **Sam**: owns *Dashboard UI*, nothing committed, blocked on Alex's endpoint
- One of Priya's commits has a `Co-authored-by: Alex` line to show split credit.
- `demo/make-demo-repo.sh` uses `git commit --date` so the timeline looks like 3 real weeks.
- Keep a **cached fallback** of the task map, judgments, nudges and report in case the Wi-Fi or API fails, plus a **screen recording** of the full demo.

---

## 16. Notes for Claude Code

- Read this README first; `shared/src/types.ts` is the source of truth for data shapes.
- Work only inside the folders owned by the person you are helping (section 6) unless told otherwise.
- Every LLM call goes through `backend/src/llm/client.ts` so tokens and cost are always logged.
- LLM outputs must be validated with the zod schemas in `shared/src/schemas.ts`.
- Decide rules are plain code (section 10). Never ask a model *whether* to nudge, only *how to word* it.
- Prefer simple, readable code over clever abstractions: this is a 36-hour build.
