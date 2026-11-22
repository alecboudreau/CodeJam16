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
  say: string;
  action?: string;
  run?: (ctx: Ctx) => Promise<void> | void;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SAY = [
  "Sunday Nov 8. Nothing is due soon, so most check-ins skip without calling any AI. Zero cost when there's nothing to check.",
  "Monday. 5 commits come in. Plain code throws out 3 with no AI (formatting, lock files); the small model judges the other 2. Two checkpoints are met.",
  "Tuesday. Jordan misses 'Settings page saves preferences'. Jordan gets a private, friendly DM. The team hears nothing yet: there's a 48-hour grace period.",
  "Wednesday. Steady progress, nothing to send. Most days the agent stays quiet.",
  "Thursday. The grace period ran out and the settings page still isn't done, so the team gets one alert. It names the checkpoint and offers help. No numbers, no blame.",
  "Friday. Quiet again.",
  "Saturday. Sam misses 'Dashboard shows the payment list'. Sam gets a private DM.",
];

const STEPS: Step[] = [
  {
    title: "Get ready",
    say: "Before you start: this resets the demo to Saturday Nov 7 with the contract live. Have Discord open if you're using the presenter key.",
    action: "Reset the demo",
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
    title: "The team contract",
    say: "Raise your hand if a teammate has gone quiet and nobody wanted to say anything. This team signed a contract instead: what each person delivers, by when, and the rules. Everyone signed, so it's live.",
    action: "Show the contract as Alex",
    run: (ctx) => ctx.go("/taskmap", "Alex"),
  },
  ...DAY_NAMES.map((day, index): Step => ({
    title: `Play ${day}`,
    say: DAY_SAY[index],
    action: `Play ${day}`,
    run: async (ctx) => ctx.playDay(index),
  })),
  {
    title: "Sam's private reminder",
    say: "Here's what Sam sees: a private reminder with three answers: On it, Blocked, Need help. It listens before it judges.",
    action: "Open Sam's Inbox",
    run: (ctx) => ctx.go("/inbox", "Sam"),
  },
  {
    title: "Sam is blocked",
    say: "Sam is actually waiting on Alex's payment history endpoint, so Sam taps Blocked and picks Alex.",
    action: "Tap Blocked → Alex",
    run: async (ctx) => {
      await api.setMemberStatus(ctx.projectId, { status: "blocked", blockedById: ctx.member("Alex") }, ctx.member("Sam"));
      ctx.go("/inbox", "Sam");
    },
  },
  {
    title: "The agent reacts",
    say: "Next check-in: Sam's grace clock pauses, and Alex gets the nudge instead: 'Sam is waiting on you'.",
    action: "Run a check-in",
    run: async (ctx) => {
      const { checkinId } = await api.runCheckin(ctx.projectId);
      ctx.go(`/trace?checkinId=${encodeURIComponent(checkinId)}`, "Alex");
    },
  },
  {
    title: "Jordan's private evidence",
    say: "Evidence is private. Only Jordan sees this. The settings checkpoint is alerted, and some commits came from an unknown git identity on Jordan's laptop.",
    action: "Open Jordan's dashboard",
    run: (ctx) => ctx.go("/dashboard", "Jordan"),
  },
  {
    title: "Claim the unknown commits",
    say: "Jordan claims that identity. More commits now count, but the checkpoint is still not met: they're almost all formatting. Commit counts don't fool it.",
    action: "Assign it to Jordan",
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
    say: "Jordan actually pushed the real saving code Sunday morning, before the next check-in, and disputes, pointing at the settings folder. The big model reads the current code and takes a closer look.",
    action: "Dispute the settings checkpoint",
    run: async (ctx) => {
      const plan = await api.getTaskMap(ctx.projectId);
      const settings = plan.checkpoints.find((c) => /settings page saves/i.test(c.criteria));
      if (!settings) throw new Error("The settings checkpoint isn't in this plan. Reset the demo first.");
      await api.disputeCheckpoint(ctx.projectId, settings.id, { note: "The settings page saves preferences now; it's in frontend/settings/.", filePaths: ["frontend/settings/"] }, ctx.member("Jordan"));
      ctx.go("/trace", "Jordan");
    },
  },
  {
    title: "What it cost",
    say: "This is the agent track, so: 22 of 31 commits never touched an AI, check-ins with nothing due skipped entirely, and the week cost about a fifth of a cent instead of seven cents for sending everything to the big model.",
    action: "Show the compute meter",
    run: (ctx) => ctx.go("/trace"),
  },
  {
    title: "Status report",
    say: "One click gives the team a neutral summary: met, pending, missed per checkpoint. No rankings, no comparisons.",
    action: "Open the status report",
    run: (ctx) => ctx.go("/report"),
  },
  {
    title: "Close",
    say: "An agent that spends compute only where it matters, keeps your evidence private, and gets the team talking before it's too late.",
    action: "Back to the contract",
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
      <p className="demo-guide-say">“{current.say}”</p>
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
      <p className="demo-guide-hint" role="status">
        {busy && current.title.startsWith("Play ")
          ? "Playing the day: four scheduled check-ins with real AI calls. Takes 10 to 30 seconds, so keep talking."
          : busy
            ? "Working…"
            : "The main button does the step and moves on. Back and Skip only move the guide."}
      </p>
    </aside>
  );
}
