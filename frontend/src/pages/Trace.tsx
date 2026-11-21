import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Project, TraceStep as Step } from "@enforcer/shared";
import { api, ApiError, useMocks } from "../api/client";
import { useProject } from "../App";
import TraceStep from "../components/TraceStep";
import ComputeMeter from "../components/ComputeMeter";
import SimulateButton from "../components/SimulateButton";

interface Checkin {
  id: string;
  projectId: string;
  kind: "daily" | "extra" | "manual" | "simulate" | "dispute";
  skipped: boolean;
  startedAt: string;
  finishedAt?: string;
}
const buttonClass = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const mockHistory = new Map<string, Checkin[]>();
const terminal = (steps: Step[]) => steps.some((s) => s.step === "act" || s.step === "skip" || /^failed:/i.test(s.summary));
const sortHistory = (rows: Checkin[]) => [...rows].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

// The backend's /checkins route is not in the B1 client or shared contract yet.
// Keep this reader in B5's file scope; the rest of the page uses the existing client.
async function getHistory(projectId: string): Promise<Checkin[]> {
  if (useMocks) {
    const latest = await api.getTrace(projectId);
    const rows = mockHistory.get(projectId) ?? [];
    if (latest.length) {
      const id = latest[0].checkinId;
      const previous = rows.find((row) => row.id === id);
      const row: Checkin = {
        id, projectId, kind: previous?.kind ?? "manual", startedAt: previous?.startedAt ?? latest[0].at,
        skipped: latest.some((s) => s.step === "skip"),
        ...(terminal(latest) ? { finishedAt: latest.at(-1)!.at } : {}),
      };
      const next = sortHistory([row, ...rows.filter((r) => r.id !== id)]);
      mockHistory.set(projectId, next);
      return next;
    }
    return sortHistory(rows);
  }
  const base = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/$/, "");
  const response = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/checkins`);
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ApiError(`Could not read check-in history (${response.status}).`, response.status); }
  if (!response.ok) {
    throw new ApiError(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Could not load check-in history.", response.status);
  }
  if (!Array.isArray(body) || !body.every((row) => row && typeof row.id === "string" && row.projectId === projectId && typeof row.kind === "string" && typeof row.skipped === "boolean" && typeof row.startedAt === "string" && Number.isFinite(Date.parse(row.startedAt)) && (row.finishedAt === undefined || typeof row.finishedAt === "string"))) {
    throw new ApiError("The server returned invalid check-in history.", response.status);
  }
  return sortHistory(body as Checkin[]);
}

export default function Trace() {
  const { project } = useProject();
  const [params, setParams] = useSearchParams();
  if (!project) return <div className="mx-auto max-w-5xl"><h1 className="text-3xl font-semibold">Agent trace</h1><p className="mt-4">Create a project in <Link to="/setup" className="text-blue-700 underline">Setup</Link> to view check-ins.</p></div>;
  return <ProjectTrace key={project.id} project={project} requestedCheckin={params.get("checkinId") ?? ""} onSelect={(id) => setParams({ checkinId: id })} />;
}

function ProjectTrace({ project, requestedCheckin, onSelect }: { project: Project; requestedCheckin: string; onSelect: (id: string) => void }) {
  const [history, setHistory] = useState<Checkin[]>([]);
  const [selected, setSelected] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [visible, setVisible] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const mounted = useRef(true);
  const startLock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHistoryError("");
    getHistory(project.id).then((rows) => {
      if (cancelled) return;
      setHistory(rows);
      setSelected((current) => requestedCheckin || (rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""));
    }).catch((error: unknown) => { if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Could not load check-ins."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, historyAttempt, requestedCheckin]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    setSteps([]);
    setVisible(0);
    setError("");
    setRunning(false);
    if (!selected) return;
    async function poll() {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const [trace, rows] = await Promise.all([api.getTrace(project.id, selected), getHistory(project.id)]);
        if (cancelled) return;
        const ordered = trace.filter((step) => step.checkinId === selected).sort((a, b) => a.order - b.order);
        setSteps(ordered);
        const updated = useMocks && terminal(ordered) ? rows.map((row) => row.id === selected ? {
          ...row, skipped: ordered.some((step) => step.step === "skip"), finishedAt: ordered.at(-1)!.at,
        } : row) : rows;
        if (useMocks) mockHistory.set(project.id, updated);
        setHistory(updated);
        const row = updated.find((row) => row.id === selected);
        const active = row ? !row.finishedAt : !terminal(ordered);
        setRunning(active);
        if (!active) clearInterval(interval);
      } catch (error: unknown) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Could not update the trace.");
          setRunning(false);
          clearInterval(interval);
        }
      } finally { inFlight = false; }
    }
    interval = setInterval(() => { void poll(); }, 500);
    void poll();
    return () => { cancelled = true; clearInterval(interval); };
  }, [project.id, selected, attempt]);

  useEffect(() => {
    if (visible >= steps.length) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setVisible(steps.length); return; }
    const timer = setTimeout(() => setVisible((count) => count + 1), 180);
    return () => clearTimeout(timer);
  }, [steps.length, visible]);

  async function run() {
    if (startLock.current || starting || running || simulating || !project.planActive) return;
    startLock.current = true;
    setStarting(true);
    setError("");
    try {
      const { checkinId } = await api.runCheckin(project.id);
      if (!mounted.current) return;
      selectNewCheckin(checkinId, "manual");
    } catch (error: unknown) { if (mounted.current) setError(error instanceof Error ? error.message : "Could not start the check-in."); }
    finally { startLock.current = false; if (mounted.current) setStarting(false); }
  }

  function selectNewCheckin(checkinId: string, kind: Checkin["kind"], updateUrl = true) {
    const row: Checkin = { id: checkinId, projectId: project.id, kind, skipped: false, startedAt: new Date().toISOString() };
    if (useMocks) mockHistory.set(project.id, [row, ...(mockHistory.get(project.id) ?? []).filter((r) => r.id !== checkinId)]);
    setHistory((rows) => [row, ...rows.filter((r) => r.id !== checkinId)]);
    setSelected(checkinId);
    setAttempt((n) => n + 1);
    if (updateUrl) onSelect(checkinId);
  }

  const current = history.find((row) => row.id === selected);
  const failed = steps.some((step) => /^failed:/i.test(step.summary));
  const checkinInProgress = running || history.some((row) => !row.finishedAt);
  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-blue-700">{project.name}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Agent trace</h1><p className="mt-2 text-sm text-gray-600">Follow observe → filter → judge → decide → act, one step at a time.</p></div>
      <div className="flex flex-wrap items-start gap-3"><button type="button" disabled={starting || simulating || checkinInProgress || loading || !project.planActive} onClick={run} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{starting ? "Starting check-in…" : "Run check-in"}</button>
        <SimulateButton projectId={project.id} planActive={project.planActive} disabled={starting || checkinInProgress || loading} onBusyChange={setSimulating} onStarted={(id) => selectNewCheckin(id, "simulate", false)} />
      </div>
    </header>
    {!project.planActive && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Approve the plan in the <Link to="/taskmap" className="underline">task map</Link> before running a check-in.</p>}
    <section aria-labelledby="history-heading" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="history-heading" className="text-lg font-semibold">Check-in history</h2><button type="button" disabled={loading || starting || running || simulating} onClick={() => setHistoryAttempt((n) => n + 1)} className={buttonClass}>Refresh history</button></div>
      {loading ? <p role="status" className="mt-3 text-sm">Loading check-ins…</p> : historyError ? <div role="alert" className="mt-3 text-sm text-red-800">{historyError}<button type="button" className={`${buttonClass} ml-3`} onClick={() => setHistoryAttempt((n) => n + 1)}>Retry history</button></div> : !history.length ? <p className="mt-3 text-sm text-gray-500">No check-ins yet. Run your first check-in to see the agent at work.</p> : <label className="mt-4 block text-sm font-medium">Select a check-in
        <select value={selected} disabled={starting || simulating} onChange={(event) => { setSelected(event.target.value); onSelect(event.target.value); }} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
          {history.map((row) => <option key={row.id} value={row.id}>{new Date(row.startedAt).toLocaleString()} · {row.kind} · {row.skipped ? "Skipped" : row.finishedAt ? "Finished" : "Running"} · {row.id}</option>)}
        </select>
      </label>}
    </section>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{selected && <button type="button" className={`${buttonClass} ml-3`} onClick={() => setAttempt((n) => n + 1)}>Retry trace</button>}</div>}
    {selected && <section aria-labelledby="trace-heading" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="trace-heading" className="text-lg font-semibold">Check-in steps</h2>
      <p role="status" className={`text-sm ${failed ? "text-red-800" : "text-gray-600"}`}>{error ? "Updates paused — retry to reconnect." : running ? "Live · checking for steps every 500 ms" : visible < steps.length ? "Replaying steps…" : failed ? "Check-in failed" : current?.skipped || steps.some((s) => s.step === "skip") ? "Skipped · no model calls" : steps.length || current?.finishedAt ? "Check-in finished" : "Waiting for the first step…"}</p>
    </div>
      <ol aria-label="Check-in trace steps" aria-live="polite" aria-relevant="additions" className="space-y-3">{steps.slice(0, visible).map((step) => <TraceStep key={`${step.checkinId}:${step.order}`} step={step} />)}</ol>
      {!steps.length && !error && <p className="text-sm text-gray-500">{current?.finishedAt ? "This check-in has no recorded steps." : "The agent has not recorded a step yet."}</p>}
    </section>}
    <ComputeMeter projectId={project.id} refreshKey={current?.finishedAt ? `${current.id}:${current.finishedAt}` : ""} />
  </div>;
}
