import { useState } from "react";
import type { Checkpoint, Dispute } from "@enforcer/shared";
import { DisputeForm, DisputeList, type DisputeSubmitted } from "./EvidenceDrawer";

const statuses: Record<Checkpoint["status"], { label: string; style: string }> = {
  pending: { label: "Pending", style: "bg-gray-100 text-gray-700" },
  met: { label: "Met", style: "bg-green-50 text-green-800" },
  missed: { label: "Missed", style: "bg-amber-50 text-amber-900" },
  alerted: { label: "Alerted", style: "bg-red-50 text-red-800" },
};

interface CheckpointListProps {
  checkpoints: Checkpoint[];
  projectId?: string;
  viewerId?: string;
  disputes?: Dispute[];
  onSubmitted?: DisputeSubmitted;
}

export default function CheckpointList({ checkpoints, projectId, viewerId, disputes = [], onSubmitted }: CheckpointListProps) {
  const [target, setTarget] = useState<string | null>(null);
  if (!checkpoints.length) return <p className="text-sm text-gray-500">No checkpoints set for this task.</p>;
  return <ul className="divide-y divide-gray-100">
    {[...checkpoints].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)).map((checkpoint) => {
      const mine = disputes.filter((d) => d.memberId === viewerId && d.target.kind === "checkpoint" && d.target.checkpointId === checkpoint.id);
      const pending = mine.some((d) => d.status === "open");
      const eligible = !!projectId && !!viewerId && (checkpoint.ownerId === null || checkpoint.ownerId === viewerId) && checkpoint.status !== "met";
      return <li key={checkpoint.id} className="py-3">
      <div className="flex items-start justify-between gap-3"><span className="text-sm font-medium">{checkpoint.criteria}</span>
        <span className={`shrink-0 status-label ${statuses[checkpoint.status].style}`}>{statuses[checkpoint.status].label}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-gray-500">Due <time dateTime={checkpoint.dueAt}>{new Date(checkpoint.dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
        {" · "}Target {Math.round(checkpoint.targetCompletion * 100)}%{checkpoint.ownerId === null ? " · Shared checkpoint" : ""}</p>
      {eligible && <button type="button" disabled={pending} aria-label={`Dispute checkpoint: ${checkpoint.criteria}`} onClick={() => setTarget(checkpoint.id)} className="mt-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">{pending ? "Dispute open" : "Dispute checkpoint"}</button>}
      {eligible && target === checkpoint.id && <DisputeForm key={`${viewerId}:${checkpoint.id}`} projectId={projectId!} viewerId={viewerId!} target={{ kind: "checkpoint", checkpointId: checkpoint.id }} title={checkpoint.criteria} onSubmitted={onSubmitted} onCancel={() => setTarget(null)} />}
      <DisputeList disputes={mine} />
    </li>})}
  </ul>;
}
