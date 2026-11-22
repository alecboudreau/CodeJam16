import { useEffect, useState, type FormEvent } from "react";
import type { Checkpoint, Task, TaskMap } from "@enforcer/shared";
import { api, type TaskEdit } from "../api/client";
import { useProject } from "../App";
import { EmptyState } from "../components/Enforcer";
import { ErrorState, LoadingState } from "../components/PageFeedback";

const points = [1, 2, 3, 5, 8, 13] as const;

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

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <h1>Project info</h1>
          <p>Edit {project.name}. Changes apply immediately.</p>
        </div>
      </header>
      {loading ? <LoadingState message="Loading project info…" /> : error && !plan ? <ErrorState title="Could not load project info" onRetry={() => setAttempt((n) => n + 1)}><p>{error}</p></ErrorState> : plan && <>
        {error && <p role="alert" className="supporting-copy">{error}</p>}
        {notice && <p role="status" className="supporting-copy">{notice}</p>}

        <form className="panel" onSubmit={saveDeadline}>
          <h2>Key date</h2>
          <label className="supporting-copy">Project deadline
            <input required type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" style={{ marginTop: 16 }}>Save deadline</button>
        </form>

        <section className="panel">
          <h2>Checkpoint dates</h2>
          {plan.checkpoints.length === 0 ? <p className="supporting-copy">This project has no checkpoints yet.</p> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 16 }}>
              {plan.checkpoints.map((checkpoint) => <CheckpointDate key={checkpoint.id} checkpoint={checkpoint} onSave={saveCheckpoint} />)}
            </ul>
          )}
        </section>

        <section className="page-stack" style={{ gap: 12 }}>
          <h2>Tasks</h2>
          {plan.tasks.map((task) => <TaskEditor key={`${task.id}:${task.title}:${task.ownerId}`} task={task} members={project.members} onSave={saveTask} />)}
          <form className="panel" onSubmit={addTask}>
            <h2>Add a task</h2>
            <TaskFields value={draft} members={project.members} onChange={setDraft} />
            <button type="submit" className="btn btn-primary" style={{ marginTop: 16 }}>Add task</button>
          </form>
        </section>

        <form className="panel" onSubmit={addMember}>
          <h2>Team</h2>
          <ul className="supporting-copy">
            {project.members.map((member) => <li key={member.id}>{member.name} (@{member.githubUsername})</li>)}
          </ul>
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            <label className="supporting-copy">Name<input required value={memberName} onChange={(event) => setMemberName(event.target.value)} /></label>
            <label className="supporting-copy">GitHub username<input required value={memberGithub} onChange={(event) => setMemberGithub(event.target.value)} placeholder="octocat" /></label>
            <label className="supporting-copy">Email (optional)<input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} /></label>
          </div>
          <button type="submit" className="btn btn-secondary" style={{ marginTop: 16 }}>Add teammate</button>
        </form>
      </>}
    </div>
  );
}

function CheckpointDate({ checkpoint, onSave }: { checkpoint: Checkpoint; onSave: (checkpoint: Checkpoint, dueAt: string) => Promise<void> }) {
  const [dueAt, setDueAt] = useState(toLocalInput(checkpoint.dueAt));
  return (
    <li>
      <form onSubmit={(event) => { event.preventDefault(); void onSave(checkpoint, dueAt); }} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
        <label className="supporting-copy" style={{ flex: "1 1 240px" }}>{checkpoint.criteria}
          <input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </label>
        <button type="submit" className="btn btn-secondary">Save date</button>
      </form>
    </li>
  );
}

function TaskEditor({ task, members, onSave }: { task: Task; members: { id: string; name: string }[]; onSave: (task: Task, input: TaskEdit) => Promise<void> }) {
  const [value, setValue] = useState<TaskEdit>(() => editFrom(task));
  return (
    <form className="panel" onSubmit={(event) => { event.preventDefault(); void onSave(task, value); }}>
      <TaskFields value={value} members={members} onChange={setValue} />
      <button type="submit" className="btn btn-secondary" style={{ marginTop: 16 }}>Save task</button>
    </form>
  );
}

function TaskFields({ value, members, onChange }: { value: TaskEdit; members: { id: string; name: string }[]; onChange: (value: TaskEdit) => void }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label className="supporting-copy">Title<input required value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} /></label>
      <label className="supporting-copy">Description<textarea rows={3} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
      <label className="supporting-copy">Assigned to
        <select required value={value.ownerId} onChange={(event) => onChange({ ...value, ownerId: event.target.value })}>
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </label>
      <label className="supporting-copy">Effort
        <select value={value.points} onChange={(event) => onChange({ ...value, points: Number(event.target.value) as TaskEdit["points"] })}>
          {points.map((point) => <option key={point} value={point}>{point}</option>)}
        </select>
      </label>
      <label className="supporting-copy">Repo paths, one per line
        <textarea rows={2} value={value.paths.join("\n")} onChange={(event) => onChange({ ...value, paths: event.target.value.split("\n").map((path) => path.trim()).filter(Boolean) })} />
      </label>
      <label className="supporting-copy"><input type="checkbox" checked={value.tracked} onChange={(event) => onChange({ ...value, tracked: event.target.checked })} /> Track this task against the repository</label>
    </div>
  );
}
