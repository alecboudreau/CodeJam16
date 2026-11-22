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
// One or two short lines per day: the whole guide should take about 3 minutes.
const DAY_STORY: string[][] = [
  ["Sunday. No code, nothing due, so the app doesn't even call the AI. Free."],
  ["Monday. Alex and Priya each hit their first goal. Jordan only fixed spacing, and the app throws that out without any AI."],
  ["Tuesday. Jordan's goal is late. Jordan gets a private message. The team hears nothing: he has 48 hours to catch up."],
  ["Wednesday. Priya and Alex keep going. Quiet day."],
  ["Thursday. Jordan's 48 hours are up. The team gets one message: which goal is late, and can anyone help. No numbers, no blame."],
  ["Friday. Quiet."],
  ["Saturday. Sam's goal is late, so Sam gets a private message."],
];

const STEPS: Step[] = [
  {
    title: "Get ready",
    story: ["Do this before you start talking. It resets the demo to the start of the week."],
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
      "Four students are building a payments app. They signed a contract: who builds what, by when.",
      "The app checks their code against it. Let's play their week.",
    ],
    action: "Show the contract",
    does: "Opens the team contract.",
    run: (ctx) => ctx.go("/taskmap", "Alex"),
  },
  ...DAY_NAMES.map((day, index): Step => ({
    title: day,
    story: DAY_STORY[index],
    action: `Next day: ${day}`,
    does: `Plays ${day} (a few seconds) and shows what the app did.`,
    run: async (ctx) => ctx.playDay(index),
  })),
  {
    title: "Sam is stuck",
    story: [
      "Sam can't start: Sam is waiting on Alex's work. So Sam presses Blocked and picks Alex.",
      "Sam's clock pauses, and Alex gets the reminder instead.",
    ],
    action: "Sam presses Blocked",
    does: "Sam presses Blocked → Alex, then the app checks again.",
    run: async (ctx) => {
      await api.setMemberStatus(ctx.projectId, { status: "blocked", blockedById: ctx.member("Alex") }, ctx.member("Sam"));
      const { checkinId } = await api.runCheckin(ctx.projectId);
      ctx.go(`/trace?checkinId=${encodeURIComponent(checkinId)}`, "Alex");
    },
  },
  {
    title: "Jordan's page",
    story: [
      "Only Jordan sees this page. Jordan linked his laptop commits too: lots of commits, but all formatting.",
      "So the goal is still not done. Commit counts don't fool it.",
    ],
    action: "Show Jordan's page",
    does: "Switches to Jordan, links his laptop commits, opens his page.",
    run: async (ctx) => {
      const jordan = ctx.member("Jordan");
      const dash = await api.getDashboard(ctx.projectId, jordan);
      const login = dash.unmatched[0]?.login;
      if (login) await api.addAlias(ctx.projectId, jordan, login);
      ctx.go("/dashboard", "Jordan");
    },
  },
  {
    title: "Jordan disputes",
    story: [
      "Sunday morning Jordan wrote the real code. He disputes: \"it's done, check the settings folder.\"",
      "The bigger AI reads his code and agrees. Late becomes done.",
    ],
    action: "Jordan disputes",
    does: "Sends the dispute. The AI rechecks his code (a few seconds).",
    run: async (ctx) => {
      const plan = await api.getTaskMap(ctx.projectId);
      const settings = plan.checkpoints.find((c) => /settings page saves/i.test(c.criteria));
      if (!settings) throw new Error("The settings goal isn't in this plan. Go back to Get ready and start over.");
      await api.disputeCheckpoint(ctx.projectId, settings.id, { note: "The settings page saves preferences now; it's in frontend/settings/.", filePaths: ["frontend/settings/"] }, ctx.member("Jordan"));
      ctx.go("/trace", "Jordan");
    },
  },
  {
    title: "The cost",
    story: [
      "22 of 31 commits never touched an AI. The whole week, dispute included, cost less than a cent, versus about 7 cents sending everything to the big AI.",
    ],
    action: "Show the cost",
    does: "Shows the cost box on this page.",
    run: (ctx) => ctx.go("/trace"),
  },
  {
    title: "Wrap up",
    story: [
      "It uses AI only when needed, keeps your evidence private, and gets the team talking before it's too late. One click also writes a neutral status report for the team.",
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
          ? "Playing the day: four check-ins with real AI calls. A few seconds; keep talking."
          : busy
            ? "Working…"
            : "Back and Skip only move through the steps. They don't do anything."}
      </p>
    </aside>
  );
}
