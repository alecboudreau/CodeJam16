import type { Member, TaskMap } from "@enforcer/shared";

interface AgreeBarProps {
  plan: TaskMap;
  members: Member[];
}

export default function AgreeBar({ plan, members }: AgreeBarProps) {
  const names = (ids: string[]) => ids.map((id) => members.find((m) => m.id === id)?.name ?? id).join(", ");
  const grace = plan.waitingOn.find((entry) => entry.item.kind === "grace");
  return (
    <section aria-label="Plan approvals" aria-live="polite" className={`rounded-xl border p-5 ${plan.active ? "border-green-200 bg-green-50" : "border-blue-200 bg-blue-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{plan.active ? "Active" : "Waiting for agreement"}</h2>
        <span className="text-sm text-gray-600">Plan version {plan.version}</span>
      </div>
      {plan.active ? <p className="mt-2 text-sm text-green-900">Everyone has approved their items and the shared plan is active.</p> : <>
        <p className="mt-2 text-sm text-gray-600">Owners approve their tasks and personal checkpoints. Everyone approves shared checkpoints and the grace period.</p>
        <ul className="mt-3 space-y-1 text-sm">
          {members.map((member) => {
            const waiting = plan.waitingOn.filter((entry) => entry.memberIds.includes(member.id));
            const tasks = waiting.filter((entry) => entry.item.kind === "task").length;
            const checkpoints = waiting.filter((entry) => entry.item.kind === "checkpoint").length;
            const items = [tasks ? `${tasks} task${tasks === 1 ? "" : "s"}` : "", checkpoints ? `${checkpoints} checkpoint${checkpoints === 1 ? "" : "s"}` : ""].filter(Boolean);
            return items.length ? <li key={member.id}><span className="font-medium">{member.name}:</span> {items.join(", ")}</li> : null;
          })}
          {grace && <li><span className="font-medium">Grace period:</span> {names(grace.memberIds)}</li>}
        </ul>
        {!plan.tasks.length && <p className="mt-2 text-sm text-gray-600">Generate a plan in Setup to start collecting approvals.</p>}
      </>}
    </section>
  );
}
