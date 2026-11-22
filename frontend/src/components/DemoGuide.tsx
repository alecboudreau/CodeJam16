// Presenter guide for /demo: walks the pitch one step at a time. Each step says what to say and has a
// "Do it" button that switches person and page and performs the action, so nobody has to remember
// the order on stage. The week is played one simulated day per step.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useProject } from "../App";
import Icon from "./Icon";

const STEP_KEY = "enforcer:demo-guide:step";
const DAYS_KEY = "enforcer:demo-guide:days"; // check-in id of each day already played (index 0 = Sunday)
const OPEN_KEY = "enforcer:demo-guide:open";

const read = (key: string): string => { try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; } };
const write = (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch { /* optional */ } };
const readDays = (): string[] => { try { const v = JSON.parse(read(DAYS_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Called when the demo is reset from the banner: no days played, back to the first step. */
export function resetDemoGuide(): void {
  write(DAYS_KEY, "[]");
  write(STEP_KEY, "0");
}

interface Ctx {
  projectId: string;
  member: (name: string) => string;
  go: (path: string, as?: string) => void;
  playDay: (index: number) => Promise<void>;
}

interface Step {
  title: string;
  /** What's going on, in plain words. Read it out loud. */
  story: string[];
  /** The button's label. */
  action?: string;
  /** What pressing the button does, in one plain line. */
  does?: string;
  run?: (ctx: Ctx) => Promise<void> | void;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_STORY: string[][] = [
  [
    "It's Sunday. Nobody pushed any code.",
    "Nothing is due soon, so the app doesn't even ask the AI. That costs nothing.",
  ],
  [
    "Monday. Alex built the payment charging. Priya laid out the checkout form.",
    "Jordan pushed 3 commits, but they only fix spacing and quotes.",
    "The app ignores Jordan's spacing fixes without using AI. A small AI reads the other 2 and marks Alex's and Priya's first goals as done.",
  ],
  [
    "Tuesday. Jordan's goal was due today: \"the settings page saves preferences\".",
    "Jordan pushed 4 more commits. All of them are formatting. The feature still isn't built.",
    "Meanwhile Alex added payment checks, and that already reaches his next goal.",
    "So the app sends Jordan a private message. The rest of the team hears nothing. Jordan has 48 hours to catch up.",
  ],
  [
    "Wednesday. Priya made the checkout form check and submit cards (Alex helped), so her next goal is done. Alex built refunds.",
    "Jordan pushed more formatting. Everyone else is on track, so the app stays quiet.",
  ],
  [
    "Thursday. Jordan's 48 hours are up and the settings page still doesn't save.",
    "Now the team gets one message. It only says which goal is late and asks if anyone can help. No numbers, no blame.",
  ],
  [
    "Friday. Alex added tests. Jordan did more formatting. Nothing new to report.",
  ],
  [
    "Saturday. Sam's goal was due: \"the dashboard shows the payment list\". Sam hasn't pushed anything.",
    "So Sam gets a private message. Again, the team isn't told yet.",
  ],
];

const STEPS: Step[] = [
  {
    title: "Get ready",
    story: [
      "Do this before you start talking.",
      "It puts the demo back to the start: Saturday Nov 7, before any work.",
    ],
    action: "Start over",
    does: "Resets the demo and reloads the page.",
    run: async () => {
      await api.resetDemo();
      // Reset recreates the members (new ids), so reload the page to load the fresh team.
      resetDemoGuide();
      write(STEP_KEY, "1");
      window.location.assign("/taskmap");
      await new Promise(() => {}); // the page is reloading; don't advance the step twice
    },
  },
  {
    title: "Meet the team",
    story: [
      "Four students: Alex, Priya, Jordan and Sam. They're building a payments app.",
      "At the start they all signed a contract: who builds what, and by when.",
      "Now the app watches their code and checks it against that contract.",
    ],
    action: "Show the contract",
    does: "Opens the team contract, seen as Alex.",
    run: (ctx) => ctx.go("/taskmap", "Alex"),
  },
  ...DAY_NAMES.map((day, index): Step => ({
    title: day,
    story: DAY_STORY[index],
    action: `Next day: ${day}`,
    does: `Plays ${day} and shows what the app did that day.`,
    run: async (ctx) => ctx.playDay(index),
  })),
  {
    title: "Sam's message",
    story: [
      "This is what Sam sees: a private reminder about the dashboard.",
      "Sam can answer with one tap: On it, Blocked, or Need help.",
    ],
    action: "Open Sam's messages",
    does: "Switches to Sam and opens Sam's Inbox.",
    run: (ctx) => ctx.go("/inbox", "Sam"),
  },
  {
    title: "Sam is stuck",
    story: [
      "Sam can't build the dashboard yet. Sam needs Alex's payment history first.",
      "So Sam presses Blocked and picks Alex.",
    ],
    action: "Sam presses Blocked",
    does: "Sam presses Blocked and picks Alex.",
    run: async (ctx) => {
      await api.setMemberStatus(ctx.projectId, { status: "blocked", blockedById: ctx.member("Alex") }, ctx.member("Sam"));
      ctx.go("/inbox", "Sam");
    },
  },
  {
    title: "The app adjusts",
    story: [
      "The next time the app checks in, it sees Sam is waiting on Alex.",
      "Sam's clock pauses, so Sam isn't blamed. Alex gets the reminder instead: \"Sam is waiting on you.\"",
    ],
    action: "Check again",
    does: "Runs one check-in now and shows what the app decided.",
    run: async (ctx) => {
      const { checkinId } = await api.runCheckin(ctx.projectId);
      ctx.go(`/trace?checkinId=${encodeURIComponent(checkinId)}`, "Alex");
    },
  },
  {
    title: "Jordan's page",
    story: [
      "This is Jordan's own page. Only Jordan can see which commits counted and why.",
      "The settings goal is marked late, and the team was told.",
      "Some of Jordan's commits came from an unknown account (his laptop), so they weren't linked to him.",
    ],
    action: "Open Jordan's page",
    does: "Switches to Jordan and opens his dashboard.",
    run: (ctx) => ctx.go("/dashboard", "Jordan"),
  },
  {
    title: "Jordan claims his laptop commits",
    story: [
      "Jordan says: those laptop commits are mine.",
      "Now more commits count for him, but the goal is still not done. They were all formatting.",
      "Lots of commits don't fool the app. Only real progress counts.",
    ],
    action: "Link the laptop commits",
    does: "Links the unknown laptop account to Jordan.",
    run: async (ctx) => {
      const jordan = ctx.member("Jordan");
      const dash = await api.getDashboard(ctx.projectId, jordan);
      const login = dash.unmatched[0]?.login;
      if (login) await api.addAlias(ctx.projectId, jordan, login);
      ctx.go("/dashboard", "Jordan");
    },
  },
  {
    title: "Jordan says it's done",
    story: [
      "Sunday morning, Jordan finally wrote the code that saves the settings.",
      "He doesn't want to wait for the next check-in, so he disputes: \"it's done, look in the settings folder.\"",
      "The bigger AI reads his actual code and agrees. The goal flips from late to done.",
    ],
    action: "Jordan disputes",
    does: "Sends Jordan's dispute. The AI rechecks his code (takes a few seconds).",
    run: async (ctx) => {
      const plan = await api.getTaskMap(ctx.projectId);
      const settings = plan.checkpoints.find((c) => /settings page saves/i.test(c.criteria));
      if (!settings) throw new Error("The settings goal isn't in this plan. Press Back until Get ready and start over.");
      await api.disputeCheckpoint(ctx.projectId, settings.id, { note: "The settings page saves preferences now; it's in frontend/settings/.", filePaths: ["frontend/settings/"] }, ctx.member("Jordan"));
      ctx.go("/trace", "Jordan");
    },
  },
  {
    title: "How much it cost",
    story: [
      "The whole week had 31 commits. 22 were thrown out by simple rules, with no AI at all.",
      "When nothing was due, the app didn't call the AI.",
      "Total: about 0.2 cents. Sending every commit to the big AI would cost about 7 cents.",
    ],
    action: "Show the cost",
    does: "Shows the cost box on the Agent trace page.",
    run: (ctx) => ctx.go("/trace"),
  },
  {
    title: "The summary",
    story: [
      "One button writes a short report for the team: which goals are done, waiting or late.",
      "It never ranks people or compares them.",
    ],
    action: "Open the report",
    does: "Opens the status report page. Click Generate there.",
    run: (ctx) => ctx.go("/report"),
  },
  {
    title: "Wrap up",
    story: [
      "The app uses AI only when it's needed, keeps your evidence private, and gets the team talking before it's too late.",
    ],
    action: "Finish",
    does: "Goes back to the team contract.",
    run: (ctx) => ctx.go("/taskmap", "Alex"),
  },
];

export default function DemoGuide() {
  const { project, setViewerId } = useProject();
  const navigate = useNavigate();
  const [step, setStep] = useState(() => Math.min(Math.max(Number(read(STEP_KEY)) || 0, 0), STEPS.length - 1));
  const [open, setOpen] = useState(() => read(OPEN_KEY) !== "closed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!project) return null;

  const current = STEPS[step];
  const goTo = (index: number) => {
    const next = Math.min(Math.max(index, 0), STEPS.length - 1);
    setStep(next);
    write(STEP_KEY, String(next));
    setError("");
  };
  const toggle = () => {
    setOpen((value) => { write(OPEN_KEY, value ? "closed" : "open"); return !value; });
  };

  const ctx: Ctx = {
    projectId: project.id,
    member: (name) => {
      const found = project.members.find((m) => m.name === name);
      if (!found) throw new Error(`${name} isn't in this project. Reset the demo first.`);
      return found.id;
    },
    go: (path, as) => {
      if (as) setViewerId(ctx.member(as));
      navigate(path, { state: { demoRefresh: Date.now() } });
    },
    // Plays days in order: a day already played just reopens its trace; skipped days are played first.
    playDay: async (index) => {
      const days = readDays();
      while (days.length <= index) {
        const { checkinId } = await api.simulate(project.id, 1);
        days.push(checkinId);
        write(DAYS_KEY, JSON.stringify(days));
      }
      ctx.go(`/trace?checkinId=${encodeURIComponent(days[index])}`, "Alex");
    },
  };

  async function doIt() {
    if (!current.run || busy) return;
    setBusy(true);
    setError("");
    try {
      await current.run(ctx);
      if (step < STEPS.length - 1) goTo(step + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "That step didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="demo-guide-pill" onClick={toggle} aria-expanded="false">
        Demo guide · step {step + 1} of {STEPS.length}
      </button>
    );
  }

  const played = readDays().length;
  return (
    <aside className="demo-guide" aria-label="Demo guide">
      <header>
        <p>Demo guide · step {step + 1} of {STEPS.length}{played > 0 && ` · ${played} of 7 days played`}</p>
        <button type="button" className="demo-guide-close" onClick={toggle} aria-label="Hide the demo guide">
          <Icon name="close" />
        </button>
      </header>
      <h2>{current.title}</h2>
      <div className="demo-guide-say">
        {current.story.map((line) => <p key={line}>{line}</p>)}
      </div>
      {error && <p role="alert" className="demo-guide-error">{error}</p>}
      <div className="demo-guide-actions">
        <button type="button" className="btn btn-secondary" disabled={step === 0 || busy} onClick={() => goTo(step - 1)} aria-label="Previous step">
          Back
        </button>
        {current.action && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={doIt}>
            {busy ? "Working…" : current.action}
          </button>
        )}
        <button type="button" className="btn btn-secondary" disabled={step === STEPS.length - 1 || busy} onClick={() => goTo(step + 1)} aria-label="Skip to next step">
          Skip
        </button>
      </div>
      {current.does && !busy && <p className="demo-guide-does">The button: {current.does}</p>}
      <p className="demo-guide-hint" role="status">
        {busy && DAY_NAMES.includes(current.title)
          ? "Playing the day: four scheduled check-ins with real AI calls. Takes 10 to 30 seconds, so keep talking."
          : busy
            ? "Working…"
            : "Back and Skip only move through the steps. They don't do anything."}
      </p>
    </aside>
  );
}
