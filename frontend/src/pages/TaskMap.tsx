import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PutTaskMapBody, type Checkpoint, type PlanDraft, type PlanItemRef, type Project, type Task, type TaskMap as Plan } from "@enforcer/shared";
import { api } from "../api/client";
import { useProject } from "../App";
import AgreeBar from "../components/AgreeBar";

const inputClass = "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-600";
const buttonClass = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const editable = (plan: PlanDraft) => ({ tasks: plan.tasks, checkpoints: plan.checkpoints, gracePeriodHours: plan.gracePeriodHours });
const editingCopy = (plan: Plan) => structuredClone(plan.pending ? { ...plan, ...plan.pending, pending: null } : plan);
const localDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
};

function initialSuggestion(plan: Plan): number {
  const key = `enforcer:grace-suggestion:${plan.projectId}`;
  try {
    const saved = Number(localStorage.getItem(key));
    if (Number.isInteger(saved) && saved > 0) return saved;
    localStorage.setItem(key, String(plan.gracePeriodHours));
  } catch { /* The suggestion still lasts for the current page visit. */ }
  return plan.gracePeriodHours;
}

export default function TaskMap() {
  const { project, viewerId } = useProject();
  if (!project) return <div className="mx-auto max-w-4xl"><h1 className="text-3xl font-semibold">Task map</h1><p className="mt-4">Create a project in <Link to="/setup" className="text-blue-700 underline">Setup</Link> to review its plan.</p></div>;
  return <PlanEditor key={project.id} project={project} viewerId={viewerId} />;
}

function PlanEditor({ project, viewerId }: { project: Project; viewerId: string }) {
  const { setProject } = useProject();
  const [saved, setSaved] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Plan | null>(null);
  const [proposing, setProposing] = useState(false);
  const [suggestion, setSuggestion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mutating = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.getTaskMap(project.id).then((plan) => {
      if (cancelled) return;
      setSaved(plan);
      setDraft(editingCopy(plan));
      setProposing(!!plan.pending);
      setSuggestion(plan.tasks.length ? initialSuggestion(plan) : null);
    }).catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load the plan."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, attempt]);

  const baseline = saved?.active && !proposing ? saved : saved?.pending ?? saved;
  const dirty = !!baseline && !!draft && JSON.stringify(editable(baseline)) !== JSON.stringify(editable(draft));
  const locked = busy || (!!saved?.active && !proposing);
  const canApprove = !!saved && (!saved.active || (proposing && !!saved.pending));
  const nameOf = (id: string) => project.members.find((m) => m.id === id)?.name ?? id;

  function edit(change: (plan: Plan) => Plan) {
    setDraft((plan) => plan ? change(plan) : plan);
    setNotice("");
    setError("");
  }
  function editTask(id: string, changes: Partial<Task>) {
    edit((plan) => ({
      ...plan, tasks: plan.tasks.map((t) => t.id === id ? { ...t, ...changes } : t),
      checkpoints: plan.checkpoints.filter((c) => !(c.taskId === id && changes.tracked === false)).map((c) =>
        c.taskId === id && changes.ownerId && c.ownerId !== null ? { ...c, ownerId: changes.ownerId } : c),
    }));
  }
  function editCheckpoint(id: string, changes: Partial<Checkpoint>) {
    edit((plan) => ({ ...plan, checkpoints: plan.checkpoints.map((c) => c.id === id ? { ...c, ...changes } : c) }));
  }
  function accept(plan: Plan, message: string) {
    if (!mounted.current) return;
    setSaved(plan);
    setDraft(editingCopy(plan));
    setProposing(!!plan.pending);
    setNotice(plan.pending ? `${message} The current plan remains active while approvals are collected.`
      : plan.active && saved?.pending && plan.version > saved.version ? `The approved change is now active as plan version ${plan.version}.`
      : plan.active && saved?.pending ? "The server returned no pending change. The current plan remains active."
      : plan.active && !saved?.active ? "All approvals received. Your plan is active." : message);
    setProject({ ...project, planActive: plan.active, gracePeriodHours: plan.gracePeriodHours });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || locked || !dirty || mutating.current || (saved?.active && !viewerId)) return;
    setError("");
    const input = {
      ...editable(draft),
      tasks: draft.tasks.map((t) => ({ ...t, title: t.title.trim(), paths: t.tracked ? t.paths.map((p) => p.trim()).filter(Boolean) : [] })),
      checkpoints: draft.checkpoints.map((c) => ({ ...c, criteria: c.criteria.trim() })),
    };
    const result = PutTaskMapBody.safeParse(input);
    if (!result.success) {
      setError("Check task titles, effort points, checkpoint criteria, dates, targets (0–100%), and the grace period (whole hours greater than zero).");
      return;
    }
    // Dependency edits must still describe a possible ordering of work.
    const visiting = new Set<string>(), visited = new Set<string>();
    const byId = new Map(result.data.tasks.map((t) => [t.id, t]));
    function hasCycle(id: string): boolean {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      if (byId.get(id)?.dependsOn.some((dependency) => !byId.has(dependency) || hasCycle(dependency))) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    }
    if (result.data.tasks.some((t) => hasCycle(t.id))) {
      setError("Dependencies must refer to other tasks and cannot form a loop.");
      return;
    }
    mutating.current = true;
    setBusy(true);
    try {
      const plan = await api.updateTaskMap(project.id, input);
      if (saved?.active && !plan.pending && plan.version <= saved.version) throw new Error("The API did not confirm a pending change or a new plan version. Your proposal is still unsaved here.");
      accept(plan, saved?.active ? "Proposed change saved. Only changed items need new approvals." : "Changes saved. Only changed items need new approvals.");
    }
    catch (error: unknown) {
      if (mounted.current) {
        const message = error instanceof Error ? error.message : "Could not save the plan.";
        const unsupported = saved?.active && error && typeof error === "object" && "status" in error && error.status === 409;
        setError(unsupported ? `This API currently rejects changes to active plans. Your proposal has not been saved. ${message}` : message);
      }
    }
    finally { mutating.current = false; if (mounted.current) setBusy(false); }
  }

  async function agree(item: PlanItemRef) {
    if (!viewerId || !canApprove || dirty || busy || mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try { accept(await api.agree(project.id, [item], viewerId), "Your agreement was recorded."); }
    catch (error: unknown) { if (mounted.current) setError(error instanceof Error ? error.message : "Could not record your agreement."); }
    finally { mutating.current = false; if (mounted.current) setBusy(false); }
  }

  function approval(item: PlanItemRef, ownerId: string | null, approvedBy: string[]) {
    const eligible = !!viewerId && (ownerId === null || ownerId === viewerId);
    return <div className="flex flex-wrap items-center gap-3 text-sm">
      {approvedBy.length > 0 && <span className="text-gray-600">Approved by {approvedBy.map(nameOf).join(", ")}</span>}
      {eligible && !approvedBy.includes(viewerId) && canApprove && <button type="button" disabled={busy || dirty} onClick={() => agree(item)} className={buttonClass}
        aria-label={`I agree: ${item.kind === "grace" ? "grace period" : item.kind === "task" ? draft?.tasks.find((t) => t.id === item.id)?.title : draft?.checkpoints.find((c) => c.id === item.id)?.criteria}`}>I agree</button>}
      {eligible && approvedBy.includes(viewerId) && <span className="font-medium text-green-800">You agreed</span>}
      {!eligible && ownerId && canApprove && <span className="text-gray-500">{nameOf(ownerId)} approves this item.</span>}
    </div>;
  }

  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-medium text-blue-700">{project.name}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Task map</h1>
        <p className="mt-2 text-sm text-gray-600">Review the work, checkpoints, and grace period together before agreeing.</p></div>
      <button type="button" className={buttonClass} disabled={loading || busy || dirty} onClick={() => { setNotice(""); setAttempt((n) => n + 1); }}>Refresh plan</button>
    </header>
    {loading ? <p role="status">Loading your plan…</p> : <>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {!saved || !draft ? <button type="button" className={buttonClass} onClick={() => setAttempt((n) => n + 1)}>Retry loading plan</button> : <>
        <AgreeBar plan={saved} members={project.members} />
        {saved.pending && <AgreeBar plan={saved.pending} members={project.members} pending version={saved.version} />}
        {saved.active && !proposing && <button type="button" disabled={busy || !viewerId} className={buttonClass} onClick={() => {
          setDraft(editingCopy(saved)); setProposing(true); setError(""); setNotice("");
        }}>{saved.pending ? "Review pending change" : "Propose a change"}</button>}
        {saved.active && proposing && <section aria-label="Current active plan" className="rounded-xl border border-green-200 bg-white p-5">
          <h2 className="font-semibold">Current active plan · version {saved.version}</h2>
          <p className="mt-2 text-sm text-gray-600">This plan stays in effect while the proposed changes below are reviewed. Current progress is retained.</p>
          <p className="mt-2 text-sm">Grace period: {saved.gracePeriodHours} hours</p>
          <ul className="mt-3 space-y-2 text-sm">{saved.tasks.map((task) => <li key={task.id}><span className="font-medium">{task.title}</span> · {nameOf(task.ownerId)} · {task.tracked ? `${Math.round(task.completion * 100)}% complete` : "Untracked"}</li>)}</ul>
        </section>}
        {!draft.tasks.length ? <p className="rounded-xl border bg-white p-6">There is no draft yet. Upload your specification and generate a plan in <Link to="/setup" className="text-blue-700 underline">Setup</Link>.</p> : <>
          {saved.active && <p className="text-sm font-medium text-gray-600">{proposing ? saved.pending ? "Review or edit the pending change below." : "New proposal · not submitted yet" : "This approved plan is read-only."}</p>}
          {!viewerId && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Choose yourself in “Who are you?” to propose changes or approve your items.</p>}
          <p role="status" className="text-sm text-gray-600">{busy ? "Updating the plan…" : dirty ? "Unsaved changes. Save before agreeing; approvals below refer to the saved plan." : notice}</p>
          <form onSubmit={save} className="space-y-6" aria-busy={busy}>
            <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="grace-heading">
              <h2 id="grace-heading" className="text-lg font-semibold">Grace period</h2>
              <p className="mt-2 text-sm text-gray-600">Time to resolve a missed checkpoint before a team alert. Everyone approves this setting.</p>
              <p className="mt-2 text-sm text-blue-800">Suggested grace period: {suggestion} hours <span className="text-gray-500">(first loaded in this browser)</span></p>
              <label className="my-4 block max-w-xs text-sm font-medium">Grace period in hours
                <input type="number" min="1" step="1" required disabled={locked} className={inputClass} value={Number.isNaN(draft.gracePeriodHours) ? "" : draft.gracePeriodHours}
                  onChange={(e) => edit((plan) => ({ ...plan, gracePeriodHours: e.target.valueAsNumber }))} />
              </label>
              {approval({ kind: "grace" }, null, baseline!.graceApprovedBy)}
            </section>
            {draft.tasks.map((task, index) => <section key={task.id} aria-labelledby={`task-${task.id}`} className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id={`task-${task.id}`} className="text-lg font-semibold">{index + 1}. {task.title || "Untitled task"}</h2>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${task.tracked ? "bg-blue-50 text-blue-800" : "bg-gray-100 text-gray-600"}`}>{task.tracked ? "Tracked" : "Untracked"}</span></div>
              <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Edit {task.title}</legend>
                <label className="text-sm font-medium sm:col-span-2">Task title<input required className={inputClass} value={task.title} onChange={(e) => editTask(task.id, { title: e.target.value })} /></label>
                <label className="text-sm font-medium sm:col-span-2">Description<textarea className={inputClass} rows={2} value={task.description} onChange={(e) => editTask(task.id, { description: e.target.value })} /></label>
                <label className="text-sm font-medium">Effort points<select className={inputClass} value={task.points} onChange={(e) => editTask(task.id, { points: Number(e.target.value) })}>{[1, 2, 3, 5, 8, 13].map((points) => <option key={points} value={points}>{points}</option>)}</select></label>
                <label className="text-sm font-medium">Owner<select className={inputClass} value={task.ownerId} onChange={(e) => editTask(task.id, { ownerId: e.target.value })}>{project.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                <label className="text-sm font-medium">Repository paths<textarea disabled={!task.tracked} className={inputClass} rows={3} placeholder="frontend/payments/**" value={task.paths.join("\n")} onChange={(e) => editTask(task.id, { paths: e.target.value.split("\n") })} /><span className="text-xs font-normal text-gray-500">One path or glob per line.</span></label>
                <label className="text-sm font-medium">Dependencies<select multiple className={inputClass} value={task.dependsOn} onChange={(e) => editTask(task.id, { dependsOn: Array.from(e.target.selectedOptions, (o) => o.value) })}>{draft.tasks.filter((t) => t.id !== task.id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select><span className="text-xs font-normal text-gray-500">Use ⌘/Ctrl to select or clear multiple tasks.</span></label>
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={task.tracked} onChange={(e) => editTask(task.id, { tracked: e.target.checked, ...(!e.target.checked ? { paths: [] } : {}) })} />Track code checkpoints for this task</label>
              </fieldset>
              <div className="mt-4">{baseline!.tasks.some((t) => t.id === task.id) ? approval({ kind: "task", id: task.id }, baseline!.tasks.find((t) => t.id === task.id)!.ownerId, baseline!.tasks.find((t) => t.id === task.id)!.approvedBy) : <p className="text-sm text-gray-500">Save this task before approving it.</p>}</div>
              {!task.tracked ? <p className="mt-4 text-sm text-gray-500">Untracked tasks have no checkpoints and never trigger reminders.</p> : <div className="mt-6 space-y-4 border-t border-gray-100 pt-4">
                <h3 className="font-semibold">Checkpoints</h3>
                {draft.checkpoints.filter((c) => c.taskId === task.id).map((cp) => <div key={cp.id} className="rounded-lg border border-gray-200 p-4">
                  <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Edit checkpoint {cp.criteria}</legend>
                    <label className="text-sm font-medium sm:col-span-2">Checkpoint criteria<input required className={inputClass} value={cp.criteria} onChange={(e) => editCheckpoint(cp.id, { criteria: e.target.value })} /></label>
                    <label className="text-sm font-medium">Due date (local time)<input required type="datetime-local" className={inputClass} value={localDate(cp.dueAt)} onChange={(e) => editCheckpoint(cp.id, { dueAt: e.target.value ? new Date(e.target.value).toISOString() : "" })} /></label>
                    <label className="text-sm font-medium">Target completion (%)<input required type="number" min="0" max="100" step="any" className={inputClass} value={Number.isNaN(cp.targetCompletion) ? "" : Math.round(cp.targetCompletion * 10000) / 100} onChange={(e) => editCheckpoint(cp.id, { targetCompletion: e.target.valueAsNumber / 100 })} /></label>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={cp.ownerId === null} onChange={(e) => editCheckpoint(cp.id, { ownerId: e.target.checked ? null : task.ownerId })} />Shared checkpoint — everyone approves</label>
                  </fieldset>
                  <div className="mt-3">{baseline!.checkpoints.some((c) => c.id === cp.id) ? approval({ kind: "checkpoint", id: cp.id }, baseline!.checkpoints.find((c) => c.id === cp.id)!.ownerId, baseline!.checkpoints.find((c) => c.id === cp.id)!.approvedBy) : <p className="text-sm text-gray-500">Save this checkpoint before approving it.</p>}</div>
                  {(!saved.active || proposing) && <button type="button" disabled={busy} className="mt-3 text-sm text-red-700 hover:underline" aria-label={`Remove checkpoint: ${cp.criteria}`} onClick={() => edit((plan) => ({ ...plan, checkpoints: plan.checkpoints.filter((c) => c.id !== cp.id) }))}>Remove checkpoint</button>}
                </div>)}
                {(!saved.active || proposing) && <button type="button" disabled={busy} className={buttonClass} onClick={() => edit((plan) => ({ ...plan, checkpoints: [...plan.checkpoints, { id: crypto.randomUUID(), taskId: task.id, ownerId: task.ownerId, criteria: "", dueAt: project.deadline, targetCompletion: 1, status: "pending", approvedBy: [] }] }))}>Add checkpoint to {task.title}</button>}
              </div>}
            </section>)}
            {(!saved.active || proposing) && <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <button type="submit" disabled={busy || !dirty || (saved.active && !viewerId)} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{busy ? "Saving…" : saved.active ? saved.pending ? "Update proposed change" : "Submit proposed change" : "Save changes"}</button>
              <button type="button" disabled={busy || !dirty} className={buttonClass} onClick={() => { setDraft(editingCopy(saved)); setError(""); setNotice("Changes discarded."); }}>Discard changes</button>
              {saved.active && <button type="button" disabled={busy || dirty} className={buttonClass} onClick={() => { setDraft(structuredClone(saved)); setProposing(false); setError(""); setNotice(""); }}>View current plan</button>}
              <span className="text-sm text-gray-500">{dirty ? "Save changes before agreeing." : "All changes saved."}</span>
            </div>}
          </form>
        </>}
      </>}
    </>}
  </div>;
}
