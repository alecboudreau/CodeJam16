import { useEffect, useState, type FormEvent } from "react";
import type { Checkpoint, Task, TaskMap } from "@enforcer/shared";
import { api, type TaskEdit } from "../api/client";
import { useProject } from "../App";
import { EmptyState } from "../components/Enforcer";
import { ErrorState, LoadingState } from "../components/PageFeedback";
import { isDemoMode } from "../demo";

const points = [1, 2, 3, 5, 8, 13] as const;
// Same field styles as Setup, Groups and the team contract editor.
const inputClass =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const labelClass = "block text-sm font-medium";

function toLocalInput(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function editFrom(task: Task): TaskEdit {
  return { title: task.title, description: task.description, points: points.includes(task.points as TaskEdit["points"]) ? task.points as TaskEdit["points"] : 1, ownerId: task.ownerId, paths: task.paths, tracked: task.tracked };
}

export default function ProjectInfo() {
  const { project, setProject } = useProject();
  const [plan, setPlan] = useState<TaskMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [deadline, setDeadline] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberGithub, setMemberGithub] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [draft, setDraft] = useState<TaskEdit>({ title: "", description: "", points: 1, ownerId: "", paths: [], tracked: true });

  useEffect(() => {
    if (!project) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    api.getTaskMap(project.id)
      .then((value) => { if (!cancelled) { setPlan(value); setDeadline(toLocalInput(project.deadline)); setDraft((current) => ({ ...current, ownerId: current.ownerId || project.members[0]?.id || "" })); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load this project."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project, attempt]);

  if (!project) {
    return (
      <div className="page-stack">
        <header className="page-heading"><h1>Project info</h1><p>Tasks, dates, and teammates for the open group.</p></header>
        <EmptyState title="Open a group first." action={{ to: "/groups", label: "Go to Groups" }}><p>Project info edits the group selected in the side menu.</p></EmptyState>
      </div>
    );
  }

  async function saveDeadline(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      const next = await api.setDeadline(project!.id, new Date(deadline).toISOString());
      setProject(next);
      setNotice("Deadline updated.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not update the deadline.");
    }
  }

  async function saveTask(task: Task, input: TaskEdit) {
    setNotice("");
    setError("");
    try {
      setPlan(await api.updateTask(project!.id, task.id, input));
      setNotice(`Saved ${input.title}.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not save that task.");
    }
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      setPlan(await api.addTask(project!.id, draft));
      setDraft({ title: "", description: "", points: 1, ownerId: project!.members[0]?.id ?? "", paths: [], tracked: true });
      setNotice("Task added.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not add that task.");
    }
  }

  async function saveCheckpoint(checkpoint: Checkpoint, dueAt: string) {
    setNotice("");
    setError("");
    try {
      setPlan(await api.setCheckpointDue(project!.id, checkpoint.id, new Date(dueAt).toISOString()));
      setNotice("Checkpoint date updated.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not update that date.");
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      await api.addMember(project!.id, { name: memberName.trim(), githubUsername: memberGithub.trim(), ...(memberEmail.trim() ? { email: memberEmail.trim() } : {}) });
      setProject(await api.getProject(project!.id));
      setMemberName("");
      setMemberGithub("");
      setMemberEmail("");
      setNotice("Teammate added. They can join with this group's invite code and that GitHub username.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not add that teammate.");
    }
  }

  const taskTitle = (id: string) => plan?.tasks.find((task) => task.id === id)?.title ?? "";

  return (
    <div className="page-stack max-w-4xl">
      <header className="page-heading">
        <div>
          <h1>Project info</h1>
          <p>Edit {project.name}. Changes apply immediately.</p>
        </div>
      </header>
      {loading ? <LoadingState message="Loading project info…" /> : error && !plan ? <ErrorState title="Could not load project info" onRetry={() => setAttempt((n) => n + 1)}><p>{error}</p></ErrorState> : plan && <>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="contract-notice">{notice}</p>}

        <form className="panel" onSubmit={addMember}>
          <h2>Team</h2>
          <ul className="divide-y divide-gray-200 border-y border-gray-200">
            {project.members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                <span className="font-medium">{member.name}</span>
                <span className="text-gray-600">@{member.githubUsername}</span>
              </li>
            ))}
          </ul>
          {isDemoMode() ? (
            <p className="mt-4 text-sm text-gray-600">The demo team is fixed. Sign in with your own account to add teammates to a group.</p>
          ) : (<>
          <h3 className="mt-6 text-sm font-semibold">Add a teammate</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <label className={labelClass}>Name<input required className={inputClass} value={memberName} onChange={(event) => setMemberName(event.target.value)} /></label>
            <label className={labelClass}>GitHub username<input required className={inputClass} value={memberGithub} onChange={(event) => setMemberGithub(event.target.value)} placeholder="octocat" spellCheck={false} /></label>
            <label className={labelClass}>Email <span className="font-normal text-gray-500">(optional)</span><input type="email" className={inputClass} value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} /></label>
          </div>
          <button type="submit" className="btn btn-secondary mt-4">Add teammate</button>
          </>)}
        </form>

        <form className="panel" onSubmit={saveDeadline}>
          <h2>Deadline</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className={`${labelClass} w-full max-w-xs`}>Project deadline
              <input required type="datetime-local" className={inputClass} value={deadline} onChange={(event) => setDeadline(event.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary">Save deadline</button>
          </div>
        </form>

        <section className="panel">
          <h2>Checkpoint dates</h2>
          {plan.checkpoints.length === 0 ? <p className="text-sm text-gray-600">This project has no checkpoints yet.</p> : (
            <ul className="divide-y divide-gray-200">
              {plan.checkpoints.map((checkpoint) => <CheckpointDate key={checkpoint.id} checkpoint={checkpoint} taskTitle={taskTitle(checkpoint.taskId)} onSave={saveCheckpoint} />)}
            </ul>
          )}
        </section>

        <section className="space-y-4" aria-labelledby="tasks-heading">
          <h2 id="tasks-heading" className="text-lg font-semibold">Tasks</h2>
          {plan.tasks.map((task) => <TaskEditor key={`${task.id}:${task.title}:${task.ownerId}`} task={task} members={project.members} onSave={saveTask} />)}
          <form className="panel" onSubmit={addTask}>
            <h2>Add a task</h2>
            <TaskFields value={draft} members={project.members} onChange={setDraft} />
            <button type="submit" className="btn btn-primary mt-5">Add task</button>
          </form>
        </section>
      </>}
    </div>
  );
}

function CheckpointDate({ checkpoint, taskTitle, onSave }: { checkpoint: Checkpoint; taskTitle: string; onSave: (checkpoint: Checkpoint, dueAt: string) => Promise<void> }) {
  const [dueAt, setDueAt] = useState(toLocalInput(checkpoint.dueAt));
  const id = `due-${checkpoint.id}`;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <form onSubmit={(event) => { event.preventDefault(); void onSave(checkpoint, dueAt); }} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <label htmlFor={id} className="text-sm">
          <span className="block font-medium">{checkpoint.criteria}</span>
          {taskTitle && <span className="block text-xs text-gray-600">{taskTitle}</span>}
        </label>
        <input id={id} required type="datetime-local" className={`${inputClass} sm:mt-0 sm:w-56`} value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        <button type="submit" className="btn btn-secondary">Save date</button>
      </form>
    </li>
  );
}

function TaskEditor({ task, members, onSave }: { task: Task; members: { id: string; name: string }[]; onSave: (task: Task, input: TaskEdit) => Promise<void> }) {
  const [value, setValue] = useState<TaskEdit>(() => editFrom(task));
  return (
    <form className="panel" onSubmit={(event) => { event.preventDefault(); void onSave(task, value); }} aria-label={`Edit ${task.title}`}>
      <h3 className="mb-4 text-base font-semibold">{task.title}</h3>
      <TaskFields value={value} members={members} onChange={setValue} />
      <button type="submit" className="btn btn-secondary mt-5">Save task</button>
    </form>
  );
}

function TaskFields({ value, members, onChange }: { value: TaskEdit; members: { id: string; name: string }[]; onChange: (value: TaskEdit) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={`${labelClass} sm:col-span-2`}>Title<input required className={inputClass} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} /></label>
      <label className={`${labelClass} sm:col-span-2`}>Description<textarea rows={3} className={inputClass} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
      <label className={labelClass}>Assigned to
        <select required className={inputClass} value={value.ownerId} onChange={(event) => onChange({ ...value, ownerId: event.target.value })}>
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>Effort points
        <select className={inputClass} value={value.points} onChange={(event) => onChange({ ...value, points: Number(event.target.value) as TaskEdit["points"] })}>
          {points.map((point) => <option key={point} value={point}>{point}</option>)}
        </select>
      </label>
      <label className={`${labelClass} sm:col-span-2`}>Repository paths
        <textarea rows={2} className={`${inputClass} font-mono`} placeholder="frontend/payments/**" value={value.paths.join("\n")} onChange={(event) => onChange({ ...value, paths: event.target.value.split("\n").map((path) => path.trim()).filter(Boolean) })} />
        <span className="mt-1 block text-xs font-normal text-gray-500">One path or folder pattern per line.</span>
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={value.tracked} onChange={(event) => onChange({ ...value, tracked: event.target.checked })} /> Track this task against the repository</label>
    </div>
  );
}
