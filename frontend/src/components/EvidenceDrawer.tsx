import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { DisputeBody, type Checkpoint, type Dashboard, type Dispute, type DisputeTarget, type Task } from "@enforcer/shared";
import { api, ApiError } from "../api/client";

const buttonClass = "btn btn-secondary";
export type DisputeSubmitted = (dispute: Dispute, dashboard?: Dashboard) => void;
const sameTarget = (a: DisputeTarget, b: DisputeTarget) => a.kind === b.kind && (a.kind === "judgment" && b.kind === "judgment" ? a.sha === b.sha : a.kind === "checkpoint" && b.kind === "checkpoint" && a.checkpointId === b.checkpointId);

function savedDispute(value: unknown, memberId: string, target: DisputeTarget): value is Dispute {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Dispute>;
  return typeof row.id === "string" && row.memberId === memberId && (row.status === "open" || row.status === "resolved") && typeof row.note === "string" && typeof row.createdAt === "string" && Array.isArray(row.filePaths) && !!row.target && sameTarget(row.target, target);
}

export function DisputeList({ disputes }: { disputes: Dispute[] }) {
  if (!disputes.length) return null;
  return <ul aria-label="Your disputes" className="mt-3 space-y-3">{[...disputes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((dispute) => <li key={dispute.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{dispute.target.kind === "judgment" ? `Judgment ${dispute.target.sha.slice(0, 12)}` : "Checkpoint dispute"}</span><span className={`rounded-full px-2 py-1 text-xs font-medium ${dispute.status === "open" ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"}`}>{dispute.status === "open" ? "Open" : "Resolved"}</span></div>
    <p className="mt-2 whitespace-pre-wrap">{dispute.note}</p>
    <p className="mt-2 font-medium">{dispute.before ?? "Before not yet recorded"} → {dispute.after ?? "Awaiting re-judgment"}</p>
    {dispute.reason && <p className="mt-2 text-gray-600">{dispute.reason}</p>}
    {dispute.filePaths.length > 0 && <p className="mt-2 break-words text-xs text-gray-500">Files: {dispute.filePaths.join(", ")}</p>}
    <time dateTime={dispute.createdAt} className="mt-2 block text-xs text-gray-500">{new Date(dispute.createdAt).toLocaleString()}</time>
  </li>)}</ul>;
}

export function DisputeForm({ projectId, viewerId, target, title, onSubmitted, onCancel }: {
  projectId: string; viewerId: string; target: DisputeTarget; title: string;
  onSubmitted?: DisputeSubmitted; onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<Dispute | null>(null);
  const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function publish(dispute: Dispute) {
    if (!mounted.current) return;
    setSubmitted(dispute);
    try {
      const dashboard = await api.getDashboard(projectId, viewerId);
      if (mounted.current) onSubmitted?.(dispute, dashboard);
    } catch {
      if (mounted.current) {
        onSubmitted?.(dispute);
        setError("Your dispute was recorded. Refresh the dashboard to see the latest progress.");
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!viewerId || lock.current || submitted) return;
    setError("");
    const result = DisputeBody.safeParse({ memberId: viewerId, note: note.trim(), filePaths: [...new Set(paths.split("\n").map((path) => path.trim()).filter(Boolean))] });
    if (!result.success) { setError("Add a note of 1–500 characters and at most 5 file paths, one per line."); return; }
    lock.current = true;
    setBusy(true);
    const startedAt = Date.now();
    try {
      const dispute = target.kind === "judgment"
        ? await api.disputeJudgment(projectId, target.sha, result.data, viewerId)
        : await api.disputeCheckpoint(projectId, target.checkpointId, result.data, viewerId);
      await publish(dispute);
    } catch (error: unknown) {
      if (!mounted.current) return;
      let persisted: Dispute | undefined;
      if (error instanceof ApiError && savedDispute(error.details, viewerId, target)) persisted = error.details;
      // The server can save a dispute before file fetching or re-judging fails.
      // Reconcile an uncertain response before offering another submission.
      if (!persisted && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.status === 409)) {
        try {
          const dashboard = await api.getDashboard(projectId, viewerId);
          persisted = dashboard.myDisputes.find((d) => d.memberId === viewerId && sameTarget(d.target, target) && (d.status === "open" || Date.parse(d.createdAt) >= startedAt - 1000));
        } catch { /* Keep the original error when reconciliation is unavailable. */ }
      }
      if (!mounted.current) return;
      if (persisted) {
        await publish(persisted);
        if (mounted.current) setError(persisted.status === "open" ? "Your dispute is saved and remains open. Re-judging has not finished; do not submit it again." : "Your dispute was recorded and resolved.");
      } else setError(error instanceof Error ? error.message : "Could not submit the dispute. Please try again.");
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  return <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
    <h4 className="text-sm font-semibold">Dispute: {title}</h4>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {submitted ? <><p role="status" className="mt-3 text-sm font-medium">Dispute recorded.</p><DisputeList disputes={[submitted]} /><button type="button" className={`${buttonClass} mt-3`} onClick={onCancel}>Done</button></> : <form onSubmit={submit} aria-busy={busy} className="mt-3 space-y-3">
      <label className="block text-sm font-medium">Why should this be reviewed?
        <textarea required maxLength={500} rows={3} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
      </label>
      <label className="block text-sm font-medium">File paths (optional)
        <textarea rows={2} value={paths} disabled={busy} onChange={(event) => setPaths(event.target.value)} placeholder={"src/settings/save.ts\nsrc/settings/form.tsx"} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
      </label>
      <p className="text-xs text-gray-600">Up to 5 repository paths, one per line. The agent reads those files and reviews your note.</p>
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className="btn btn-primary">{busy ? "Submitting for review…" : "Submit dispute"}</button><button type="button" disabled={busy} className={buttonClass} onClick={onCancel}>Cancel</button></div>
    </form>}
  </div>;
}

interface EvidenceDrawerProps {
  projectId: string; viewerId: string; task: Task;
  evidence?: Dashboard["myEvidence"][number]; checkpoints: Checkpoint[]; disputes: Dispute[];
  onSubmitted?: DisputeSubmitted;
}

export default function EvidenceDrawer(props: EvidenceDrawerProps) {
  if (!props.viewerId || props.task.ownerId !== props.viewerId) return null;
  return <OwnEvidence key={`${props.projectId}:${props.viewerId}:${props.task.id}`} {...props} />;
}

function OwnEvidence({ projectId, viewerId, task, evidence, checkpoints, disputes, onSubmitted }: EvidenceDrawerProps) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const judgments = evidence?.taskId === task.id ? evidence.judgments.filter((j) => j.taskId === task.id || (j.kind === "filtered" && j.authorIds.includes(viewerId))) : [];
  const shas = new Set(judgments.map((j) => j.sha));
  const checkpointIds = new Set(checkpoints.filter((c) => c.taskId === task.id).map((c) => c.id));
  const ownDisputes = disputes.filter((d) => d.memberId === viewerId && (d.target.kind === "judgment" ? shas.has(d.target.sha) : checkpointIds.has(d.target.checkpointId)));
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); trigger.current?.focus(); };
  }, [open]);

  return <div className="mt-4">
    <button ref={trigger} type="button" className={buttonClass} onClick={() => setOpen(true)} aria-label={`View my evidence: ${task.title}`}>View my evidence</button>
    {open && <dialog ref={dialog} aria-labelledby={titleId} onCancel={() => { setOpen(false); setTarget(null); }} className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-xl overflow-y-auto border-l border-gray-200 bg-white p-6 shadow-xl backdrop:bg-black/30">
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-blue-700">Your evidence</p><h2 id={titleId} className="mt-2 text-xl font-semibold">{task.title}</h2></div><button type="button" autoFocus aria-label="Close evidence drawer" className={buttonClass} onClick={() => { setOpen(false); setTarget(null); }}>Close</button></div>
      <p className="mt-3 text-sm text-gray-600">Commit evidence and judgment reasons for your task. These details are shown only in your view.</p>
      <p className="mt-4 text-sm font-medium">{evidence?.taskId === task.id ? evidence.commits : 0} commits recorded</p>
      {!judgments.length ? <p className="mt-4 text-sm text-gray-500">No commit evidence for this task yet.</p> : <ul aria-label="Your commit evidence" className="mt-4 space-y-4">{judgments.map((judgment) => {
        const pending = ownDisputes.some((d) => d.status === "open" && d.target.kind === "judgment" && d.target.sha === judgment.sha);
        const commitUrl = /^[\w.-]+\/[\w.-]+$/.test(judgment.repo) && /^[a-f\d]{7,40}$/i.test(judgment.sha) ? `https://github.com/${judgment.repo}/commit/${judgment.sha}` : null;
        return <li key={judgment.sha} className="rounded-lg border border-gray-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2">
          {commitUrl ? <a href={commitUrl} target="_blank" rel="noreferrer" className="font-mono text-sm text-blue-700 underline">{judgment.sha.slice(0, 12)}</a> : <code className="text-sm">{judgment.sha.startsWith("dispute:") ? "Dispute adjustment" : judgment.sha.slice(0, 12)}</code>}
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium">{judgment.kind}</span></div>
          <p className="mt-3 text-sm leading-6">{judgment.reason}</p>
          <p className="mt-2 text-xs text-gray-500">Judgment completion estimate: {Math.round(judgment.completionDelta * 100)}%</p>
          {!judgment.sha.startsWith("dispute:") && <button type="button" disabled={pending} className={`${buttonClass} mt-3`} aria-label={`Dispute judgment: ${judgment.sha}`} onClick={() => setTarget(judgment.sha)}>{pending ? "Dispute open" : "Dispute judgment"}</button>}
          {target === judgment.sha && <DisputeForm key={judgment.sha} projectId={projectId} viewerId={viewerId} target={{ kind: "judgment", sha: judgment.sha }} title={`judgment ${judgment.sha.slice(0, 12)}`} onSubmitted={onSubmitted} onCancel={() => setTarget(null)} />}
        </li>;
      })}</ul>}
      <section className="mt-6 border-t border-gray-200 pt-4"><h3 className="font-semibold">Your dispute history</h3>{ownDisputes.length ? <DisputeList disputes={ownDisputes} /> : <p className="mt-3 text-sm text-gray-500">No disputes for this task.</p>}</section>
    </dialog>}
  </div>;
}
