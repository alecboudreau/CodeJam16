# Enforcer: presentation guide (5 minutes)

Everything you need to explain Enforcer and run the demo: the pitch, how a team actually uses it, how the agent works under the hood, a timed script, and answers to likely questions.

**Live app:** https://codejam16.vercel.app · **Demo (no sign-in):** https://codejam16.vercel.app/demo
**Track:** Agent Solution (efficient use of compute, and a demo that shows *how* it works) · Backup: People First

---

## 1. The pitch in one breath

> Every group project has that moment: someone's gone quiet, the deadline's close, and nobody wants to be the one who says something. Enforcer does the awkward part. The team signs a contract of small, dated checkpoints. An AI agent checks the code against them, privately nudges anyone who slips, and only tells the team if it's still not done after a grace period everyone agreed on.

Three ideas to land:

1. **Checkpoints, not activity.** Progress means "the requirement is met", never "how many commits you made". Commit counts are easy to game and turn teammates against each other.
2. **Private first.** A miss gets a private, friendly message. The team only hears about it after the agreed grace period, and the message never shows numbers or evidence.
3. **Cheap, visible AI.** Plain code throws out most commits, a small model judges the rest, the big model only sees the hard cases, and runs with nothing due cost nothing. You can watch every step live.

---

## 2. The customer flow (what a team actually does)

Meet a 4-person team building a payments app: Alex, Priya, Jordan and Sam.

### Step 1. Sign in and create a group
- Alex signs in with **Discord** or an **email link** and lands on **Groups**.
- **Create a group**: name, GitHub repo(s), deadline, each teammate's name and GitHub username (plus optional hours per week), and the project spec as a PDF, Word or Markdown file.
- The **"Building your plan"** screen shows what's happening: saving the group → reading the requirements → drafting the plan.

### Step 2. The AI drafts the plan (once)
The big model reads the spec **one time** and proposes:
- **Tasks**, each with an owner, effort points, the repo folders it lives in, and what it depends on. Non-code work (slides, report) is marked *not tracked*.
- **Checkpoints** every few days, sized to each person's hours, e.g. *"Signup form validates input and creates a user, by Wed Nov 25, about 50% of the task"*.
- A **grace period**, e.g. 48 hours.

### Step 3. Everyone signs the Team contract
- The **Team contract** reads like an agreement: *"Alex promises to deliver…"* with dated checkpoints in plain language, plus the **team rules** (grace period, private nudges, what's not tracked).
- Each person reads their part and clicks **Sign my part**. Signatures show as *"3 of 4 signed"*.
- When everyone has signed, the contract goes **live**. Anyone can **Suggest a change**; only the people affected sign again, and progress is kept.

### Step 4. Teammates join
- Each group has an **invite code**. A teammate signs in, enters the code plus their GitHub username on **Groups**, and they're in.
- Missed someone at setup? Any member can **Add teammate** later.
- In Discord, each person types **`/link <github-username>`** to opt in to reminders.

### Step 5. Work happens; the agent checks in
- Check-ins run **daily at 6 pm**, plus every 6 hours **only if a checkpoint is due within 48 hours**.
- Each person sees **My work** (their open tasks across every group), the **Dashboard** (overall and per-checkpoint progress), and their own **evidence** (which commits counted and why). Only the owner sees their own evidence.

### Step 6. Someone misses a checkpoint
1. **Private DM** to the owner (also mirrored in the app's **Inbox**) with three buttons:
   - **On it**: no more reminders for 2 days.
   - **Blocked → pick who**: your grace clock **pauses**, and the person you're waiting on gets the nudge instead.
   - **Need help**: posts a request for help to the team.
2. Reminders at most **once per person every 2 days**.
3. Still not met when the grace period ends → **one team message** naming the *checkpoint* and offering help. No percentages, no commit counts, no comparisons.

### Step 7. Disagree? Dispute it
If the agent got your work wrong, add a one-line note and point at the files. The **big model re-judges** with the current file contents, and the trace shows the change (e.g. *alerted → met*).

### Step 8. Share where things stand
**Status report**: one click, a neutral summary of met / pending / missed per checkpoint. No rankings.

---

## 3. How the agent works (the part judges care about)

Every check-in runs five steps, and each one is written to the **Agent trace** live:

| Step | What happens | Who does it | Cost |
|---|---|---|---|
| 1. Observe | Pull new commits from the repos | GitHub API | free |
| 2. Filter | Drop lock files, build output, `node_modules`, minified files, formatting-only diffs, already-judged commits | **Plain code** | free |
| 3. Judge | Rate each remaining change (*substantial* / *light*), match it to a task, estimate % of the task done | **Small model** (Haiku), batched | cents |
| 3b. Escalate | Only judgments with confidence under 0.6 | **Big model** (Sonnet) | rare |
| 4. Decide | Update checkpoint statuses, apply the rules (nudge, wait, alert) | **Plain code** | free |
| 5. Act | Word the message, send it on Discord / Inbox | Small model + Discord | cents |

Key design choices:
- **The AI never decides *whether* to nudge**, only *how to word it*. The rules are plain code everyone can read.
- **Skipped runs cost zero.** If no checkpoint is due soon, the check-in stops at step 1: *"skipped: no checkpoint due soon"*.
- **Compute meter.** Every AI call logs tokens, dollars and estimated energy, compared against a naive approach that sends every commit to the big model.

**The number to say out loud:** in the demo week, **22 of 31 commits are filtered with no AI at all**, and the whole week costs cents compared with the naive baseline.

---

## 4. Principles (why a team would trust it)

1. **Consent first.** Everyone links their own Discord and signs their own part. Nobody is tracked secretly.
2. **The plan is the referee.** Progress is measured against agreed checkpoints, never against teammates or commit activity.
3. **Help, don't shame.** Team messages name the checkpoint and offer help, never evidence or numbers.
4. **Your evidence is yours.** Only you see which of your commits counted, and why.
5. **No grading, no ranking.** It coordinates; it never decides marks.
6. **No human gatekeeper.** Rules are agreed up front and applied automatically.

---

## 5. The 5-minute script

**Before you start:** open https://codejam16.vercel.app/demo (presenter: `/demo?key=…` so Discord messages really send), click **Reset demo**, pick **Alex** in *Who are you?*, and have Discord visible.

| Time | Say | Show |
|---|---|---|
| **0:00–0:30** Hook | "Raise your hand if you've had a teammate go quiet and nobody wanted to say anything. By the time it comes up, it's too late. And commit counts don't help: they're easy to game and they turn teammates against each other." | Title / sign-in page with the minotaur |
| **0:30–1:15** The contract | "A team creates a group, uploads their assignment, and the AI drafts a plan once. Then everyone signs a contract: what each person promises, by when, and the team rules." | **Team contract**: *"Everyone has signed. The contract is live"*, 4 of 4 signatures, Alex's checkpoints in plain dates, the 48-hour grace rule. Optionally **My work** for Alex. |
| **1:15–2:15** The agent | "Now let's fast-forward a week." | Click **Simulate 1 week** on **Agent trace**. Walk Saturday's check-in: *pulled 4 commits → filtered 3 with no AI → small model judged 1 → Sam's "Dashboard shows the payment list" missed → private DM*. Use the history picker: a **skipped** run (zero AI calls), Tuesday (*filtered 5 of 6 with no AI*), Thursday (*one team alert after the 48-hour grace*). |
| **2:15–3:00** Private first | "Sam gets a private message, not a public callout. And it listens: Sam's actually blocked." | Discord DM (or **Inbox**). Sam taps **Blocked → Alex**. Click **Run check-in**: *Sam blocked by Alex → grace clock paused → Alex nudged*. |
| **3:00–3:45** Evidence & disputes | "Your evidence is private. Here's Jordan's view." | Switch to **Jordan** on the **Dashboard**: 15 commits, checkpoint *alerted*. Assign the unknown `jordan@laptop.local` identity → 22 commits, still not met; the evidence shows it's mostly formatting. Jordan **disputes** pointing at `frontend/settings/` → big model re-judges → *alerted → met* in the trace. |
| **3:45–4:30** Compute | "This is the agent track, so here's what it cost." | **Compute meter**: 22 of 31 commits filtered with no AI, skipped runs, cents vs the naive baseline. Then **Status report**: met / pending / missed, no rankings. |
| **4:30–5:00** Close | "An agent that spends compute only where it matters, keeps your evidence private, and gets the team talking before it's too late." | Back to the **Team contract** or the minotaur. |

**If the Wi-Fi dies:** set `LLM_CACHE=replay` so check-ins use saved AI answers (no network, same numbers). Discord still needs internet; DMs show as *not sent* in the trace, and the **Inbox** still shows them.

---

## 6. Demo data (so you know the story)

- **Alex:** big commits, finished the payment API, but *Payment history endpoint* is still open.
- **Priya:** frontend, all checkpoints met. Owns the untracked *Pitch slides* (never nudged). One commit is co-authored with Alex.
- **Jordan:** 22 small formatting commits, some from an unknown git identity. Misses *Settings page saves preferences* early in the week, and the team is alerted after the grace period.
- **Sam:** owns *Dashboard UI*, which depends on Alex's endpoint. Nothing committed; due at the end of the simulated week.
- **Reset demo** puts everything back: plan live, clock at Sat Nov 7.

---

## 7. Likely questions

**"Isn't this just surveillance?"**
Everyone opts in by linking their own Discord and signing their own part. Nobody else sees your evidence, the team never sees numbers, and it never grades anyone.

**"Can't people game it with lots of tiny commits?"**
That's exactly what commit counts reward, and it's why we don't use them. Formatting-only changes are filtered out, and light changes count for at most 10% of their estimate. Jordan's 22 formatting commits still don't meet the checkpoint.

**"What if the AI is wrong?"**
Anyone can dispute a judgment or a checkpoint, point at the files, and the big model takes a closer look with the current code. Its answer is final and visible in the trace.

**"Why not just use GPT on every commit?"**
That's the naive baseline on the compute meter. Plain code filters most commits for free, the small model handles the rest in batches, the big model only sees uncertain cases, and runs with nothing due skip the models entirely.

**"Who decides when to message someone, the AI?"**
No. Plain code decides *whether* to act, using rules the team agreed to. The model only writes the wording.

**"What about work that isn't code?"**
Slides and reports are in the contract but marked *not tracked*: no checkpoints, never nudged.

**"What if someone's blocked by a teammate?"**
They tap **Blocked** and pick who. Their grace clock pauses and the other person gets the nudge.

---

## 8. Tech in one line each

- **Frontend:** React + Vite + Tailwind, deployed on Vercel.
- **Backend:** Node + Express as one Vercel function; Supabase Postgres; sign-in with Supabase Auth (Discord or email link).
- **AI:** Claude Haiku (small model) for judging and wording; Claude Sonnet (big model) for the plan, uncertain judgments and disputes. Every call logs tokens, cost and energy.
- **Integrations:** GitHub API for commits; Discord for DMs, buttons and `/link`; Supabase `pg_cron` runs the scheduled check-ins.
