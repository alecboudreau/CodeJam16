import type { Checkpoint } from "@enforcer/shared";

const statuses: Record<Checkpoint["status"], { label: string; style: string }> = {
  pending: { label: "Pending", style: "bg-gray-100 text-gray-700" },
  met: { label: "Met", style: "bg-green-50 text-green-800" },
  missed: { label: "Missed", style: "bg-amber-50 text-amber-900" },
  alerted: { label: "Alerted", style: "bg-red-50 text-red-800" },
};

export default function CheckpointList({ checkpoints }: { checkpoints: Checkpoint[] }) {
  if (!checkpoints.length) return <p className="text-sm text-gray-500">No checkpoints set for this task.</p>;
  return <ul className="divide-y divide-gray-100">
    {[...checkpoints].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)).map((checkpoint) => <li key={checkpoint.id} className="py-3">
      <div className="flex items-start justify-between gap-3"><span className="text-sm font-medium">{checkpoint.criteria}</span>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statuses[checkpoint.status].style}`}>{statuses[checkpoint.status].label}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-gray-500">Due <time dateTime={checkpoint.dueAt}>{new Date(checkpoint.dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
        {" · "}Target {Math.round(checkpoint.targetCompletion * 100)}%{checkpoint.ownerId === null ? " · Shared checkpoint" : ""}</p>
    </li>)}
  </ul>;
}
