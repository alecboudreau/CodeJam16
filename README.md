# Group Project Enforcer *(working name, final name TBD)*

> Keeps student group projects on track. The team agrees on a plan with small, realistic checkpoints. An AI agent checks the repo against them, privately nudges anyone who misses one, and only tells the team if it's still unmet after an agreed grace period.

Built for **McGill CodeJam 16** (36 hours, team of 3).

**Primary track:** Agent Solution (judged on efficient use of compute, financially and environmentally, and on a demo that shows *how* the solution works).
**Backup track:** People First.

---

## 1. The problem and the idea

Every group project has the same awkward moment: someone has gone quiet, the deadline is getting close, and nobody wants to be the person who says something. By the time it comes up, it's too late.

**Group Project Enforcer is a coordination tool the whole team opts into.** It does the awkward part for you:

- **Checkpoints, not activity.** The plan breaks every task into frequent, feasible checkpoints ("login form submits and validates, by Thursday"). Progress means *the requirement is met*, not how many commits someone made.
- **Private first.** A missed checkpoint gets a private, friendly DM. The team only hears about it if it's still unmet after the grace period everyone agreed on.
- **It listens before it judges.** Every DM has buttons: *On it*, *Blocked*, *Need help*. If Sam is blocked by Alex, Sam's grace clock pauses and Alex gets the nudge.
- **Anyone can dispute.** If the agent misjudged your work, point it at the files and it takes a second, closer look.

### Why trust it?

> It checks every commit against the same plan the whole team approved, shows you the evidence behind your own progress, and you can dispute anything it gets wrong.

It's consistent, transparent and open to challenge. It doesn't claim to be "objective", and it **never decides marks**.

### Principles

1. **Consent first.** Everyone links their own Discord account and approves their own tasks and checkpoints. Nobody gets tracked secretly.
2. **The plan is the referee.** Progress is measured against agreed checkpoints, never against teammates, and never on commit activity.
3. **Help, don't shame.** Team messages name the *checkpoint* and offer help. They never show evidence, percentages or commit counts.
4. **Your evidence is yours.** Commit evidence and judgment reasons are only shown to the owner of the work.
5. **No grading or contribution scoring.** The tool coordinates; it doesn't rank.
6. **No human gatekeeper.** The rules are agreed up front and the bot applies them automatically, so no single student holds power over the others.
7. **Spend compute only where it matters.** Plain code filters most commits, a small model judges the rest, the big model only sees the hard cases, and check-ins with nothing due skip the models entirely.

---

## 2. How it works

### 2.1 Setup (once per project)

1. One person creates the project: GitHub repo links, the project spec (PDF, Word or Markdown), the deadline, and each teammate's name, GitHub username and (optionally) how many hours a week they can put in.
2. Each teammate joins the team's Discord server and types **`/link <github-username>`**. This connects their Discord account and counts as their opt-in.
3. The big model reads the spec **once** and drafts the **plan**:
   - **tasks** with effort points, an owner, repo paths and dependencies. Tasks with no code (slides, written report) are marked **untracked**.
   - **checkpoints** for every tracked task: frequent, feasible targets sized by points, dependencies, time remaining and each owner's capacity.
   - a recommended **grace period** in hours.
4. The team edits the plan and approves it (next section).

### 2.2 Approving the plan

Approval is **per item**:

| Item | Who approves |
|---|---|
| A task, and its personal checkpoints | the owner only |
| A shared checkpoint (`ownerId = null`) | every member |
| The grace period | every member |

- The plan becomes **active** when every personal item is approved by its owner and every shared item by everyone.
- An edit clears approvals **only on the items it changed**. Everything else stays approved.
- The **AgreeBar** shows what's still waiting on whom ("Sam: 2 checkpoints, Grace period: Jordan, Priya").

**Changing an active plan** *(Should)*: anyone can propose an edit. It applies once the changed items are approved under the same rules. Progress already made is kept.

### 2.3 The check-in (core of the project)

A check-in runs observe → filter → judge → decide → act. Each step is written to a **trace** the team can watch live.

| Step | What happens | Compute |
|---|---|---|
| 1. Observe | Pull new commits since the last check-in from all repos | GitHub API |
| 2. Filter | Drop lock files, `dist/`, `build/`, `vendor/`, `node_modules/`, minified files, whitespace/formatting-only diffs, and already-judged SHAs | **No AI** |
| 3. Judge | Rate each remaining change `substantial` or `light`, match it to a task, estimate % of the task completed | **Small model**, batched |
| 3b. Escalate | Judgments with confidence < 0.6 are re-judged | **Big model**, only when unsure |
| 4. Decide | Update checkpoint statuses, then apply the rules in section 10 → an action and a one-line reason | **Plain code** |
| 5. Act | Write the message and send it on Discord, then log it | **Small model** for wording, discord.js |

**When check-ins run:**
- **Daily at 18:00.**
- **Every 6 hours in between** (00:00, 06:00, 12:00), but only if some checkpoint is due within the next **48 hours**. Otherwise the check-in is skipped without calling any model, and the trace gets one step: *"skipped: no checkpoint due soon"*.
- **On demand**: the "Run check-in" and "Simulate 1 week" buttons.

Every LLM call logs tokens, cost and estimated energy. The **compute meter** compares the real run with a naive baseline that sends every commit to the big model, and also counts skipped check-ins and dispute re-judges.

### 2.4 Commits are evidence

- Each judged commit adds `completionDelta` to the task it matched. Light changes count for at most 10% of their estimate. A task's `completion` is capped at 1.
- A commit's authors are the GitHub author plus anyone in a `Co-authored-by:` line. Commits from an unknown GitHub account show as **unmatched**, and a teammate can assign that account to a member.
- Judgments are kept per commit as **evidence**, but progress is always presented as *"is the checkpoint met?"*, never as an activity count.

### 2.5 Progress, at two levels

- **Per checkpoint:** the task's completion vs the checkpoint's `targetCompletion`, plus its status: `pending`, `met`, `missed` or `alerted`.
- **Overall project:** points-weighted completion of all tracked tasks, `Σ(points × completion) ÷ Σ points`.

Everyone sees statuses and progress for every task. **Commit evidence and judgment reasons are only shown to the owner of the task.**

### 2.6 What "behind" means

A member is **behind** only when one of their checkpoints is past its `dueAt` and the task's completion is still below `targetCompletion`. That checkpoint becomes **missed**.

Nothing ever triggers on low commit activity. Untracked tasks have no checkpoints, so they never trigger anything.

For a shared checkpoint, reminders go to the owner of its task.

### 2.7 Missed checkpoints, buttons and the grace period

1. **Checkpoint missed** → a **private DM** to its owner naming the checkpoint, with three buttons:
   - **On it**: no more reminders for 2 days. It does **not** extend the grace period.
   - **Blocked** → pick who you're waiting on: the member's **grace clock pauses**, and the **blocker** gets a nudge ("Sam is waiting on *Payment history endpoint*"). The status clears once any of the blocker's tasks gains progress.
   - **Need help**: an immediate group post asking if anyone can pair on that checkpoint.
2. **Reminders** continue while it stays unmet, at most **one per person every 2 days**.
3. **Still unmet when the grace period ends** → **one team status alert** in the group channel, and the checkpoint becomes `alerted`.
   *"Checkpoint 'Dashboard shows payment list' wasn't met yet. Anything the team can do to help Sam?"*
4. A checkpoint that reaches its target at any point becomes `met`, even late.

The grace period (`Project.gracePeriodHours`) is approved by the whole team. Its default is the model's recommendation.

### 2.8 Disputes

If you think the agent got your work wrong, you can dispute either:
- a **judgment** ("this is the core chart logic, not a tweak"), or
- a **checkpoint status** ("the login form is done, it's in `src/auth/`").

You add a one-line note and, optionally, the file paths that prove it. The **big model re-judges** with your note plus the current contents of those files (fetched from GitHub and trimmed). Its answer is final, and the trace shows `disputed → re-judged → 20% → 45%`.

While a dispute is open, alerts and reminders pause **for that checkpoint only**. Everything else keeps running.

### 2.9 The status report

One click produces a **neutral status summary** for the team: for each task and its checkpoints, what's met, pending or missed. No evidence, no numbers per person, no comparison of members. One small-model call.

---

## 3. Scope

| Priority | Feature |
|---|---|
| **Must** | Setup, spec upload, plan generation (tasks + checkpoints + grace period), per-item approval, daily + extra check-ins, filter / judge / escalate, checkpoint statuses, two-level progress, decide rules, Discord DMs with buttons, `/link`, team alerts and help posts, disputes (judgments + checkpoints), owner-only evidence, dashboard, live trace, compute meter, status report, "Simulate 1 week" demo |
| **Should** | Proposing changes to an active plan, GitHub push webhooks (check-ins pull commits anyway), email nudges, cached LLM fallback for the demo |
| **Stretch** | Free-text replies to the bot ("blocked, waiting on Alex") read by the small model |
| **Future ideas** | WhatsApp as a second reminder channel (#61), professor/TA view of status reports, Slack, Google Docs/Figma evidence |
| **Out of scope** | Grading, ranking or contribution scoring; screenshot evidence for disputes; private repos / GitHub OAuth; user accounts; mobile app |

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
| Scheduler | `node-cron` (daily at 18:00, plus the 6-hourly conditional check) |
| Validation | `zod` (shared schemas, LLM JSON output) |
| Deploy | Vercel (frontend), Render or Railway (backend + bot) |

**Sign-in (#62): Supabase Auth.** With `SUPABASE_URL` set, members sign in with **Discord** (the account they `/link`ed) or an **email link**. The backend verifies the Supabase token (ES256, via Supabase's public signing keys) and works out which member you are in each project: Discord account first, then email. It **overwrites** any `viewerId` / `memberId` the browser sends, and non-members get 403. So owner-only evidence is now enforced by the server. Creating a project requires adding yourself with the email you signed in with. **`AUTH_DISABLED=true`** brings back the "Who are you?" picker for local demos (all four demo members share the presenter's Discord account); never set it in production.

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
│       └── schemas.ts           # zod schemas for API bodies + LLM output
│
├── backend/src/
│   ├── index.ts                 # Express app, mounts routes             (A)
│   ├── config.ts                # env + tunable constants (section 10)   (A)
│   ├── db/
│   │   ├── schema.sql           # tables (see section 9)                 (A)
│   │   └── db.ts                # better-sqlite3 helpers                 (A)
│   ├── routes/
│   │   ├── projects.ts          # /api/projects, members, aliases        (A)
│   │   ├── taskmap.ts           # plan generate / get / edit / agree     (A)
│   │   ├── checkin.ts           # /checkin, /trace                       (A)
│   │   ├── dashboard.ts         # /dashboard?viewerId=, /meter           (A)
│   │   ├── report.ts            # /report (status summary)               (A)
│   │   ├── disputes.ts          # judgment + checkpoint disputes         (A)
│   │   ├── spec.ts              # /spec (upload)                         (C)
│   │   ├── simulate.ts          # /simulate                              (C)
│   │   └── webhook.ts           # /webhook/github (Should)               (C)
│   ├── agent/                   # OWNER: Person A
│   │   ├── loop.ts              # runCheckin(projectId, { now? }): orchestrates all steps
│   │   ├── observe.ts           # fetch new commits + diffs, parse Co-authored-by
│   │   ├── filter.ts            # plain-code filters + SHA cache
│   │   ├── judge.ts             # small-model batch judging + escalation + dispute re-judge
│   │   ├── progress.ts          # task completion, checkpoint statuses, overall progress
│   │   ├── decide.ts            # section 10 rules: grace clock, buttons, cooldown, alerts
│   │   ├── act.ts               # writes messages, hands them to discord/notify
│   │   └── trace.ts             # writes trace steps to DB
│   ├── llm/                     # OWNER: Person A
│   │   ├── client.ts            # callSmall(), callBig(); logs tokens/cost/energy
│   │   ├── meter.ts             # cost + energy estimates, naive baseline, skipped runs
│   │   └── prompts/
│   │       ├── taskmap.ts       # tasks + checkpoints + grace period
│   │       ├── judge.ts         # also used for escalation and disputes
│   │       ├── nudge.ts         # DM, blocker DM, help post, team alert wording
│   │       └── report.ts        # status summary
│   ├── github/                  # OWNER: Person C
│   │   ├── client.ts            # Octokit wrapper: listCommits, getCommitDiff, getFileContents
│   │   └── webhook.ts           # verify signature, store raw push events (Should)
│   ├── spec/                    # OWNER: Person C
│   │   └── extract.ts           # PDF/Word/MD → plain text
│   ├── discord/                 # OWNER: Person C
│   │   ├── bot.ts               # login, sendDM(), postToChannel()
│   │   ├── interactions.ts      # /link command, DM buttons, "blocked by" select menu
│   │   └── notify.ts            # notify(member, message) (Discord, later email)
│   ├── scheduler/               # OWNER: Person C
│   │   └── cron.ts              # daily 18:00 check-in + 6-hourly conditional check
│   └── demo/                    # OWNER: Person C
│       ├── seed.ts              # seeds the demo project, members and approved plan
│       └── replay.ts            # "Simulate 1 week": daily commits + check-ins on a demo clock
│
├── frontend/src/                # OWNER: Person B
│   ├── main.tsx
│   ├── App.tsx                  # routes + "Who are you?" member picker
│   ├── api/
│   │   ├── client.ts            # fetch wrapper
│   │   └── mock.ts              # mock data matching shared types (until hour 14)
│   ├── pages/
│   │   ├── Setup.tsx            # repos, spec upload, team + capacity, deadline, /link status
│   │   ├── TaskMap.tsx          # editable tasks + checkpoints + grace period, per-item "I agree"
│   │   ├── Dashboard.tsx        # overall progress, checkpoints, statuses, my evidence, unmatched
│   │   ├── Trace.tsx            # agent trace (main demo view)
│   │   └── Report.tsx           # status summary + copy/download
│   └── components/
│       ├── TaskProgress.tsx     # per-task completion bars + overall progress
│       ├── CheckpointList.tsx   # checkpoints with status, due date, Dispute (own only)
│       ├── ActivityTimeline.tsx # overall project progress over time
│       ├── EvidenceDrawer.tsx   # viewer's own commits + reasons, Dispute button
│       ├── MemberStatus.tsx     # "On it" / "Blocked by Alex" / "Needs help" badges
│       ├── AgreeBar.tsx         # what's still waiting on whom
│       ├── TraceStep.tsx
│       ├── ComputeMeter.tsx     # ours vs naive, skipped check-ins, dispute re-judges
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
- Prompts: plan (tasks + checkpoints + grace), judge, nudge (DM / blocker DM / help post / team alert), status report, all returning JSON validated with zod
- Agent loop: observe → filter → judge → escalate → decide → act, with trace logging and the "skipped" path
- Progress: task completion, checkpoint statuses, overall progress
- Decide rules (section 10): grace clock, buttons, cooldown, team alerts
- Disputes: judgment and checkpoint re-judges with the big model
- Routes: projects, members/aliases, taskmap (generate / get / edit / agree), checkin, trace, dashboard (viewer-filtered), meter, report, disputes

### Person B: Frontend
- Vite + React + Tailwind setup, routing, member picker
- `api/mock.ts` built from `shared/types.ts` so every page works before the backend does
- Pages: Setup (capacity field, per-member `/link` status), TaskMap (tasks + checkpoints + grace period, per-item "I agree"), Dashboard, Trace, Report
- Components: overall + per-task progress, checkpoint list, AgreeBar, member status badges, unmatched-commit assignment, progress timeline, evidence drawer (own work only) with Dispute, animated trace steps, compute meter, Simulate button
- Switch the mocks to real API calls at the hour-14 integration point
- Final UI polish and loading/error states

### Person C: Integrations + demo + pitch
- GitHub client (commits, diffs, file contents for disputes)
- Spec upload + text extraction (PDF, Word, Markdown)
- Discord bot: DMs, group posts, `/link` command, DM buttons + "blocked by" select menu, all feeding member statuses back to the backend
- Scheduler (`node-cron`): daily 18:00 plus the 6-hourly conditional check
- Demo: `demo/spec.md`, the fake repo script, `commits-week2.json`, `seed.ts`, `replay.ts`
- Deploy (Vercel + Render/Railway)
- Pitch slides, rehearsal
- *Should:* GitHub push webhook with signature check, email nudges

### Who calls whom
- C's `github/client.ts` is called by A's `agent/observe.ts` and by A's dispute re-judge (`getFileContents`)
- C's `spec/extract.ts` output is passed to A's plan prompt
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
| GET | `/projects/:id/taskmap` | – | `TaskMap` | A |
| PUT | `/projects/:id/taskmap` | `{ tasks: Task[], checkpoints: Checkpoint[], gracePeriodHours }` | `TaskMap` | A |
| POST | `/projects/:id/taskmap/agree` | `{ memberId, items?: PlanItemRef[] }` | `TaskMap` | A |
| POST | `/projects/:id/checkin` | – | `{ checkinId }` | A |
| GET | `/projects/:id/trace?checkinId=` | – | `TraceStep[]` | A |
| GET | `/projects/:id/dashboard?viewerId=` | – | `Dashboard` | A |
| GET | `/projects/:id/meter` | – | `ComputeMeter` | A |
| GET | `/projects/:id/report` | – | `Report` | A |
| POST | `/projects/:id/judgments/:sha/dispute` | `{ memberId, note, filePaths?: string[] }` | `Dispute` | A |
| POST | `/projects/:id/checkpoints/:checkpointId/dispute` | `{ memberId, note, filePaths?: string[] }` | `Dispute` | A |
| POST | `/projects/:id/simulate` | `{ days: 7 }` | `{ checkinId }` | C |
| POST | `/webhook/github` | GitHub push payload | `204` | C *(Should)* |

**Editing and approving the plan:**
- `PUT /taskmap` compares the new plan with the stored one and clears `approvedBy` **only on items that changed** (a task, a checkpoint, or the grace period). Before the plan is active it edits the plan directly. After that it creates a **pending change** *(Should)*.
- `POST /taskmap/agree` records approvals for `items`, or, if `items` is omitted, for everything currently waiting on `memberId`. A member can only approve their own tasks and checkpoints, plus shared items. The response's `waitingOn` drives the AgreeBar.
- The plan becomes active (or the pending change is applied) once `waitingOn` is empty, and `version` goes up by one.

**Dashboard privacy:** `GET /dashboard?viewerId=` returns `myEvidence` only for tasks the viewer owns. For everyone else's tasks it returns status and progress only.

**Disputes:** only the owner of the task (or any member, for a shared checkpoint) can dispute. The re-judge runs right away. The dispute stays `open` until it finishes or if it fails.

**Simulate:** runs one check-in per simulated day on a demo clock and returns the last `checkinId`.

The trace endpoint is polled every 500 ms by the Trace page while a check-in runs (simple and reliable for the demo).

---

## 8. Shared types (`shared/src/types.ts`)

```ts
export interface MemberInput {
  name: string;
  githubUsername: string;
  email?: string;
  capacityHoursPerWeek?: number;
}

export type MemberStatus = "none" | "on_it" | "blocked" | "need_help";

export interface Member {
  id: string;
  name: string;
  githubUsername: string;
  githubAliases: string[];      // extra logins assigned from "unmatched"
  discordId?: string;           // set by /link; undefined = not opted in yet
  email?: string;
  capacityHoursPerWeek?: number;
  status: MemberStatus;         // latest button press
  blockedById?: string;         // Member.id, when status = "blocked"
  statusAt?: string;            // ISO; "on_it" expires after NUDGE_COOLDOWN_DAYS
}

export interface Project {
  id: string;
  name: string;
  repos: string[];              // "owner/repo"
  members: Member[];
  deadline: string;             // ISO date
  createdAt: string;
  planActive: boolean;
  gracePeriodHours: number;     // team-approved; default = model's recommendation
}

export interface Task {
  id: string;
  title: string;
  description: string;
  points: number;               // effort weight: 1, 2, 3, 5, 8, 13 (sizes tasks + checkpoints)
  ownerId: string;              // Member.id
  paths: string[];              // e.g. ["backend/payments/**"]; empty when untracked
  tracked: boolean;             // false = non-code task, no checkpoints, never nudged
  dependsOn: string[];          // Task.ids
  completion: number;           // 0–1
  approvedBy: string[];         // [ownerId] once the owner approves
}

export type CheckpointStatus = "pending" | "met" | "missed" | "alerted";

export interface Checkpoint {
  id: string;
  taskId: string;
  ownerId: string | null;       // null = shared (approved by everyone)
  dueAt: string;                // ISO
  targetCompletion: number;     // 0–1 of the task
  criteria: string;             // one line, e.g. "Login form submits and validates"
  status: CheckpointStatus;
  approvedBy: string[];
  missedAt?: string;            // when the check-in found it missed
  graceEndsAt?: string;         // missedAt + grace, pushed back while the owner is blocked
}

export type PlanItemRef =
  | { kind: "task"; id: string }
  | { kind: "checkpoint"; id: string }
  | { kind: "grace" };

export interface PlanDraft {
  tasks: Task[];
  checkpoints: Checkpoint[];
  gracePeriodHours: number;
  graceApprovedBy: string[];
}

export interface TaskMap extends PlanDraft {
  projectId: string;
  version: number;              // bumps every time the plan becomes active / a change applies
  active: boolean;
  pending: PlanDraft | null;    // proposed change to an active plan (Should)
  waitingOn: { item: PlanItemRef; memberIds: string[] }[]; // drives the AgreeBar
}

export interface Judgment {
  sha: string;
  repo: string;
  authorIds: string[];          // author + Co-authored-by
  unmatchedLogin?: string;      // set when the author matches no member
  taskId: string | null;
  kind: "substantial" | "light" | "filtered";
  completionDelta: number;      // 0–1 of the task
  confidence: number;           // 0–1
  model: "none" | "small" | "big";
  reason: string;               // one line, shown as evidence (owner only)
}

export type DisputeTarget =
  | { kind: "judgment"; sha: string }
  | { kind: "checkpoint"; checkpointId: string };

export interface Dispute {
  id: string;
  target: DisputeTarget;
  memberId: string;
  note: string;
  filePaths: string[];
  status: "open" | "resolved";
  before?: string;              // e.g. "light, 2%" / "missed, 20%"
  after?: string;               // e.g. "substantial, 12%" / "met, 45%"
  reason?: string;              // big model's one-line answer
  createdAt: string;
  resolvedAt?: string;
}

export type Action =
  | "none"                      // on track, or in cooldown
  | "wait"                      // "On it", blocked, or dispute open
  | "nudge"                     // private DM to the checkpoint's owner
  | "nudge_blocker"             // private DM to whoever is blocking a teammate
  | "help_post"                 // group post after "Need help"
  | "team_alert";               // group post: still unmet after the grace period

export interface Decision {
  memberId: string | null;      // null for team alerts
  checkpointId: string | null;
  action: Action;
  reason: string;               // one line, e.g. "'Payment list' missed, 30h of grace left"
  message?: string;
  sentAt?: string;
}

export interface TraceStep {
  checkinId: string;
  order: number;
  step: "observe" | "filter" | "judge" | "escalate" | "decide" | "act" | "skip";
  summary: string;              // e.g. "Filtered 9 of 14 commits (no AI)"
  details?: unknown;
  at: string;
}

export interface TaskProgress {
  task: Task;
  checkpoints: Checkpoint[];
}

export interface Dashboard {
  project: Project;
  viewerId: string;
  overallProgress: number;      // Σ(points × completion) ÷ Σ points, tracked tasks only
  tasks: TaskProgress[];        // everyone's status + progress, no evidence
  myEvidence: { taskId: string; commits: number; judgments: Judgment[] }[]; // viewer's tasks only
  myDisputes: Dispute[];
  timeline: { date: string; overallProgress: number }[];
  unmatched: { login: string; commits: number }[];
}

export interface ComputeMeter {
  ours:  { tokens: number; usd: number; wh: number; aiCalls: number };
  naive: { tokens: number; usd: number; wh: number; aiCalls: number };
  filteredWithoutAi: number;
  skippedCheckins: number;      // zero-cost runs avoided
  disputeRejudges: number;      // included in `ours`
}

export interface Report { markdown: string; generatedAt: string; }
```

---

## 9. Database (`backend/src/db/schema.sql`)

```sql
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, repos TEXT, deadline TEXT,
  spec_text TEXT, created_at TEXT, plan_active INTEGER DEFAULT 0,
  plan_version INTEGER DEFAULT 0, grace_period_hours INTEGER,
  grace_approved_by TEXT DEFAULT '[]', pending_plan TEXT, demo_now TEXT);
CREATE TABLE members (id TEXT PRIMARY KEY, project_id TEXT, name TEXT,
  github_username TEXT, github_aliases TEXT DEFAULT '[]', discord_id TEXT, email TEXT,
  capacity_hours_per_week INTEGER, status TEXT DEFAULT 'none', blocked_by_id TEXT,
  status_at TEXT);
CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, description TEXT,
  points INTEGER, owner_id TEXT, paths TEXT, tracked INTEGER DEFAULT 1,
  depends_on TEXT DEFAULT '[]', completion REAL DEFAULT 0, approved_by TEXT DEFAULT '[]');
CREATE TABLE checkpoints (id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, owner_id TEXT,
  due_at TEXT, target_completion REAL, criteria TEXT, status TEXT DEFAULT 'pending',
  approved_by TEXT DEFAULT '[]', missed_at TEXT, grace_ends_at TEXT);
CREATE TABLE raw_commits (sha TEXT PRIMARY KEY, project_id TEXT, repo TEXT,
  author_login TEXT, co_authors TEXT, message TEXT, committed_at TEXT, files TEXT,
  diff TEXT, received_at TEXT);
CREATE TABLE judgments (sha TEXT PRIMARY KEY, project_id TEXT, author_ids TEXT,
  unmatched_login TEXT, task_id TEXT, kind TEXT, completion_delta REAL, confidence REAL,
  model TEXT, reason TEXT, checkin_id TEXT);
CREATE TABLE disputes (id TEXT PRIMARY KEY, project_id TEXT, target_kind TEXT,
  target_id TEXT, checkpoint_id TEXT, member_id TEXT, note TEXT, file_paths TEXT,
  status TEXT DEFAULT 'open', before TEXT, after TEXT, reason TEXT, created_at TEXT,
  resolved_at TEXT);
CREATE TABLE checkins (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, skipped INTEGER DEFAULT 0,
  started_at TEXT, finished_at TEXT);
CREATE TABLE trace_steps (checkin_id TEXT, ord INTEGER, step TEXT, summary TEXT,
  details TEXT, at TEXT);
CREATE TABLE decisions (id TEXT PRIMARY KEY, checkin_id TEXT, member_id TEXT, checkpoint_id TEXT,
  action TEXT, reason TEXT, message TEXT, sent_at TEXT);
CREATE TABLE llm_calls (id TEXT PRIMARY KEY, project_id TEXT, checkin_id TEXT, purpose TEXT,
  model TEXT, input_tokens INTEGER, output_tokens INTEGER, usd REAL, wh REAL, at TEXT);
```

- Lists (`repos`, `paths`, `files`, `co_authors`, `github_aliases`, `author_ids`, `depends_on`, `approved_by`, `grace_approved_by`, `file_paths`) and `pending_plan` are stored as JSON strings.
- `checkins.kind` is `daily`, `extra`, `manual`, `simulate` or `dispute` (a dispute re-judge's trace; never used as "the last check-in"). `llm_calls.purpose` is `taskmap`, `judge`, `escalate`, `dispute`, `nudge` or `report`.
- `disputes.checkpoint_id` is the checkpoint whose alerts pause while the dispute is open. For a judgment dispute, it's the nearest unmet checkpoint of the judged task.
- `projects.demo_now` is only set by "Simulate 1 week". When it's set, check-ins for that project use it as "now".

---

## 10. Agent rules (`backend/src/agent/decide.ts`)

All thresholds live in `config.ts` so they're easy to tune:

```ts
NUDGE_COOLDOWN_DAYS       = 2      // max one reminder per person per 2 days; "On it" lasts this long
CHECKIN_CRON              = "0 18 * * *"         // daily at 6 pm
EXTRA_CHECK_CRON          = "0 0,6,12 * * *"     // every 6 hours, skipping the 18:00 daily slot
EXTRA_CHECK_EVERY_HOURS   = 6
CHECKPOINT_WINDOW_HOURS   = 48     // extra check-ins only run if a checkpoint is due this soon
DEFAULT_GRACE_PERIOD_HOURS = 48    // only used if the plan prompt didn't propose one
LIGHT_CAP                 = 0.10   // light changes count for at most 10% of their estimate
ESCALATE_BELOW            = 0.6    // re-judge with the big model below this confidence
DISPUTE_MAX_FILES         = 5      // files fetched for a dispute
DISPUTE_FILE_MAX_LINES    = 200    // each file trimmed to this many lines
```

Decisions are **plain code**. The small model only writes the wording.

**Before anything else (extra check-ins only):** if no `pending` checkpoint is due within `CHECKPOINT_WINDOW_HOURS`, write a `skip` trace step ("skipped: no checkpoint due soon") and stop. No commits pulled, no model called.

**Step A, update statuses** (after observe → filter → judge → escalate):
1. Recompute each task's completion from its judgments.
2. Any checkpoint whose task reached `targetCompletion` → `met`.
3. Any `pending` checkpoint past `dueAt` → `missed`, with `missedAt = now` and `graceEndsAt = now + gracePeriodHours`.
4. A `blocked` status clears if any of the blocker's tasks gained progress this check-in.

**Step B, for each `missed` or `alerted` checkpoint** (the responsible member is `ownerId`, or the task's owner if the checkpoint is shared):
1. **Open dispute on it** → `wait`. Nothing is sent for this checkpoint.
2. **Responsible member is `blocked`** → `wait`, push `graceEndsAt` back by the time since the last check-in (the grace clock pauses), and `nudge_blocker` for the blocker unless they're in cooldown.
3. **Responsible member pressed `need_help`** since the last check-in → `help_post`, then reset their status.
4. **`missed` and `now >= graceEndsAt`** → `team_alert`, and the checkpoint becomes `alerted`. This is sent once, and "On it" does not delay it.

**Step C, for each member with at least one `missed` or `alerted` checkpoint not handled in step B (dispute or blocked):**
1. **Status `on_it`** pressed within `NUDGE_COOLDOWN_DAYS` → `wait`.
2. **Reminded within `NUDGE_COOLDOWN_DAYS`** → `none` (cooldown).
3. Otherwise → `nudge`: one private DM, with buttons, about the checkpoint whose grace runs out first.

Nothing in these rules looks at commit counts or activity.

---

## 11. LLM prompts (all return strict JSON, validated with zod; retry once on bad JSON)

- **Plan (big model, once per project):** input = spec text, members (name, capacity), today's date, deadline. Output = `{ tasks: [{ key, title, description, points (1,2,3,5,8,13), ownerName, paths[], tracked, dependsOn: key[] }], checkpoints: [{ taskKey, shared, dueAt, targetCompletion, criteria }], gracePeriodHours, graceReason }`. Points reflect effort, not number of files. `tracked = false` for non-code tasks, and only tracked tasks get checkpoints. Checkpoints are frequent (a few days apart), feasible for the owner's capacity, come after the tasks they depend on, and finish by the deadline.
- **Judge (small model, batched up to 10 changes per call):** input = active task map (id, title, paths) + for each change: authors, files, trimmed diff (max ~150 lines each). Output per change = `{ sha, taskId|null, kind: substantial|light, completionDelta, confidence, reason }`. Rules: formatting, renames, comments and config tweaks are `light`; new logic, endpoints, UI features and tests are `substantial`.
- **Escalate (big model):** same prompt, only for confidence < 0.6.
- **Dispute (big model):** input = the member's note, the current contents of `filePaths` (max 5 files, 200 lines each), and either the original change (judgment dispute) or the checkpoint's criteria, target and the task's judgments (checkpoint dispute). Output = `{ completionDelta, kind }` for a judgment, or `{ completion, met, reason }` for a checkpoint.
- **Nudge (small model):** input = kind (`dm` | `blocker_dm` | `help_post` | `team_alert`), member name, task title, checkpoint criteria, hours of grace left, and who is waiting (for `blocker_dm`). Output = `{ message }`, max 3 sentences, names one specific checkpoint. **`help_post` and `team_alert` inputs contain no evidence, percentages or commit counts**, so the output can't leak them.
- **Status report (small model):** input = tasks and checkpoints with criteria, due date and status only. Output = `{ markdown }`: a neutral summary per task and checkpoint of what's met, pending or missed, with no per-member numbers and no comparisons.

### Compute meter math (`llm/meter.ts`)
- `usd = input_tokens × in_price + output_tokens × out_price` (prices per model in `config.ts`)
- `wh = (input_tokens + output_tokens) × WH_PER_TOKEN[model]` (rough constants in config; labelled "estimate" in the UI)
- **Naive baseline:** every observed commit sent alone to the big model with its full diff (tokens estimated as `diff_chars / 4`).
- **Skipped check-ins** are counted as zero-cost runs avoided. **Dispute re-judges** are big-model calls and count in `ours`.

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

After a schema change, delete `data/enforcer.db` and run `npm run db:init` again (tables are not migrated).

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
TZ=America/Toronto              # check-in crons run in this timezone
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
- **Issues:** one GitHub Issue per feature (`[A1]`…`[C12]`), labelled `person-a` / `person-b` / `person-c` with a milestone (`Hour 8`, `Hour 14`, `Hour 20`, `Should`, `Final`). Each lists the files it may touch and a "Done when" checklist.
- **Working with Claude Code:** say "do #12". It reads the issue, works only on it, and opens a PR with `Closes #12` (rules in `CLAUDE.md`).

---

## 14. Timeline (36 hours)

| Hours | Person A (agent + API) | Person B (frontend) | Person C (integrations + demo) |
|---|---|---|---|
| 0–2 | Monorepo, `shared/` types + schemas, DB schema | Vite + Tailwind, routing, mocks | Discord bot app + server, GitHub token, demo spec, fake repo script |
| 2–8 | LLM wrapper + meter, plan prompt (tasks + checkpoints + grace), projects + taskmap routes (per-item agree) | Setup + TaskMap pages (checkpoints, grace period, AgreeBar) | GitHub client (+ co-authors, file contents), spec upload/extract, `/link` command |
| 8–14 | Filter, judge, escalate, progress + checkpoint statuses | Dashboard (overall + checkpoints, own evidence) + Trace pages (on mocks) | DMs + group posts, DM buttons + "blocked by" menu, scheduler (daily + extra), `replay.ts` on a demo clock |
| **14** | **Integration: frontend switches to the real API** | | |
| 14–20 | Decide rules + act, nudge prompts, disputes, status report, trace/meter endpoints | Compute meter, evidence drawer + Dispute, status badges, unmatched commits, Simulate button | Seed demo project + approved plan, end-to-end demo run incl. the "Blocked" moment |
| **20** | **Checkpoint: full demo works end to end** | | |
| 20–26 | Sleep in shifts; bug fixes | Sleep in shifts; polish | Sleep in shifts; deploy |
| 26–30 | Should: pending plan changes | Should: propose-change UI | Should: webhooks, email nudges |
| 30–34 | Cached LLM fallback | Loading/error states, final UI | Slides |
| 34–36 | Rehearse pitch ×3 (all) | | |

---

## 15. Demo script (3 minutes)

1. **Hook:** "Raise your hand if you've had a teammate go quiet and nobody wanted to say anything."
2. **Problem:** by the time it comes up, it's too late. Commit counts don't help: they're easy to game and they turn teammates against each other.
3. **Live** (prepared with `npm run demo:seed`, so the plan is already approved and the demo clock sits at Sat Nov 7):
   - *Optional opener:* show Setup + Task map. Upload `demo/spec.md` → the plan appears with points, checkpoints every few days, slides marked *untracked*, a 48-hour grace period, and per-item "I agree"
   - Click **Simulate 1 week** (Sun Nov 8 → Sat Nov 14). The Trace page opens on Saturday's check-in:
     *Pulled 4 commits → filtered 3 with no AI → small model judged 1 → "Dashboard shows the payment list" (Sam) missed → private DM sent*
   - Use the history picker to show Tuesday (*filtered 5 of 6 with no AI → Jordan's "Settings page saves preferences" missed → DM*) and Thursday (*one team alert after the 48-hour grace*). Point at the skipped runs: *"skipped: no checkpoint due soon"*, zero model calls
   - The DM pops up in Discord on screen. Sam taps **Blocked → Alex**
   - Click **Run check-in** → *Sam blocked by Alex → grace clock paused → Alex nudged ("Sam is waiting on you")*
   - Switch the member picker to **Jordan** → Jordan's private view shows **15 commits** and the checkpoint *alerted*. Assign the unknown `jordan@laptop.local` identity to Jordan → **22 commits, checkpoint not met**, and the evidence drawer shows it's almost all formatting. The team alert in Discord named the checkpoint, with no numbers
   - Jordan disputes the checkpoint, pointing at `frontend/settings/` → the big model re-judges with the current files → `alerted → met` in the trace
   - Point at the **compute meter**: 22 of 31 commits filtered with no AI, skipped runs, cents vs the naive approach
   - Click **Status report** → met / pending / missed per checkpoint, no rankings
4. **Close:** "An agent that spends compute only where it matters, keeps your evidence private, and gets the team talking before it's too late."

### Demo data
- 4 members, all `/link`ed, plan approved by `seed.ts`:
  - **Alex**: 6 big commits, finished the payment API, but *Payment history endpoint* is still open. Checkpoints met.
  - **Priya**: frontend, checkpoints met. Also owns the untracked *Pitch slides* (no checkpoints, never nudged). One of her commits has a `Co-authored-by: Alex` line.
  - **Jordan**: 22 small formatting commits, some from an unmatched git identity. The *Settings page* checkpoint is due early in the week, gets missed, and gets a team alert once the grace period runs out.
  - **Sam**: owns *Dashboard UI*, which depends on Alex's *Payment history endpoint*. Nothing committed. The checkpoint is due at the end of the simulated week.
- `demo/make-demo-repo.sh` uses `git commit --date` so the timeline looks like 3 real weeks.
- `npm run demo:seed` creates project `demo-paylite` with all four members linked to the presenter's Discord account (`-- --discord <user-id>`, or whoever last ran `/link`), so every demo DM lands on one screen. Re-running it resets the demo.
- "Simulate 1 week" runs the real schedule on `demo_now` (extra check-ins at 00:00, 06:00, 12:00 that skip when nothing is due, and the daily one at 18:00). Each day's commits arrive at its 18:00 check-in.
- **Cached fallback:** set `LLM_CACHE=fallback` in `.env` for rehearsals and the demo. Every successful Claude answer is saved to `demo/llm-cache.json`; if a call fails on stage (no Wi-Fi, API down), the saved answer for the same prompt is used and the compute meter shows the same numbers. Do one full rehearsal (seed → Simulate → Blocked → Run check-in → alias → dispute → report) with the API up to record everything, then commit `demo/llm-cache.json`. `LLM_CACHE=replay` runs from saved answers only (no network, no cost). Discord still needs internet: without it, DMs show as "not sent" in the trace.

---

## 16. Notes for Claude Code

- Read this README first; `shared/src/types.ts` is the source of truth for data shapes.
- Work one GitHub issue at a time and only inside the files it lists (see `CLAUDE.md`).
- Every LLM call goes through `backend/src/llm/client.ts` so tokens and cost are always logged.
- LLM outputs must be validated with the zod schemas in `shared/src/schemas.ts`.
- Decide rules are plain code (section 10). Never ask a model *whether* to nudge, only *how to word* it.
- Never trigger anything on commit activity, never compare members, and never put evidence, percentages or commit counts in a team message.
- Prefer simple, readable code over clever abstractions: this is a 36-hour build.
