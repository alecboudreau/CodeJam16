import type { Member, PlanDraft, TaskMap } from "@enforcer/shared";

interface AgreeBarProps {
  plan: TaskMap | PlanDraft;
  members: Member[];
  pending?: boolean;
  version?: number;
}

export default function AgreeBar({ plan, members, pending = false, version }: AgreeBarProps) {
  const active = !pending && "active" in plan && plan.active;
  const planVersion = "version" in plan ? plan.version : version;
  // A pending PlanDraft has no waitingOn field, so derive its own approval list
  // from the approvals returned by the server, separately from the active plan.
  const waiting: TaskMap["waitingOn"] = [];
  const add = (item: TaskMap["waitingOn"][number]["item"], required: string[], approved: string[]) => {
    const memberIds = required.filter((id) => !approved.includes(id));
    if (memberIds.length) waiting.push({ item, memberIds });
  };
  if (pending || !("waitingOn" in plan)) {
    for (const task of plan.tasks) add({ kind: "task", id: task.id }, [task.ownerId], task.approvedBy);
    for (const cp of plan.checkpoints) add({ kind: "checkpoint", id: cp.id }, cp.ownerId ? [cp.ownerId] : members.map((m) => m.id), cp.approvedBy);
    add({ kind: "grace" }, members.map((m) => m.id), plan.graceApprovedBy);
  } else waiting.push(...plan.waitingOn);
  const names = (ids: string[]) => ids.map((id) => members.find((m) => m.id === id)?.name ?? id).join(", ");
  const grace = waiting.find((entry) => entry.item.kind === "grace");
  return (
    <section aria-label={pending ? "Pending change approvals" : "Plan approvals"} aria-live="polite" className={`rounded-xl border p-5 ${active ? "border-green-200 bg-green-50" : pending ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{active ? "Active" : pending ? "Pending change" : "Waiting for agreement"}</h2>
        {planVersion !== undefined && <span className="text-sm text-gray-600">{pending ? "Based on version" : "Plan version"} {planVersion}</span>}
      </div>
      {active ? <p className="mt-2 text-sm text-green-900">Everyone has approved their items and the shared plan is active.</p> : <>
        <p className="mt-2 text-sm text-gray-600">{pending ? "The current plan stays active until the proposed change is approved. " : ""}Owners approve their tasks and personal checkpoints. Everyone approves shared checkpoints and the grace period.</p>
        <ul className="mt-3 space-y-1 text-sm">
          {members.map((member) => {
            const personal = waiting.filter((entry) => entry.memberIds.includes(member.id));
            const tasks = personal.filter((entry) => entry.item.kind === "task").length;
            const checkpoints = personal.filter((entry) => entry.item.kind === "checkpoint").length;
            const items = [tasks ? `${tasks} task${tasks === 1 ? "" : "s"}` : "", checkpoints ? `${checkpoints} checkpoint${checkpoints === 1 ? "" : "s"}` : ""].filter(Boolean);
            return items.length ? <li key={member.id}><span className="font-medium">{member.name}:</span> {items.join(", ")}</li> : null;
          })}
          {grace && <li><span className="font-medium">Grace period:</span> {names(grace.memberIds)}</li>}
        </ul>
        {pending && !waiting.length && <p className="mt-2 text-sm text-gray-600">All proposed items are approved. Waiting for the server to apply this change.</p>}
        {!plan.tasks.length && <p className="mt-2 text-sm text-gray-600">Generate a plan in Setup to start collecting approvals.</p>}
      </>}
    </section>
  );
}
