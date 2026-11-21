import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Dashboard as DashboardData } from "@enforcer/shared";
import { api } from "../api/client";
import { useProject } from "../App";
import TaskProgress from "../components/TaskProgress";
import CheckpointList from "../components/CheckpointList";
import MemberStatus from "../components/MemberStatus";
import ActivityTimeline from "../components/ActivityTimeline";
import EvidenceDrawer, { type DisputeSubmitted } from "../components/EvidenceDrawer";
import { LoadingState } from "../components/PageFeedback";

const buttonClass = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function Dashboard() {
  const { project, viewerId } = useProject();
  if (!project) return <div className="mx-auto max-w-5xl"><h1 className="text-3xl font-semibold">Dashboard</h1><p className="mt-4">Create a project in <Link to="/setup" className="text-blue-700 underline">Setup</Link> to view its progress.</p></div>;
  if (!viewerId) return <div className="mx-auto max-w-5xl"><h1 className="text-3xl font-semibold">Dashboard</h1><p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Choose yourself in “Who are you?” to open your project dashboard.</p></div>;
  // A new viewer gets a fresh state immediately, including any in-flight responses.
  return <ProjectDashboard key={`${project.id}:${viewerId}`} projectId={project.id} viewerId={viewerId} />;
}

function ProjectDashboard({ projectId, viewerId }: { projectId: string; viewerId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(() => new Map<string, string>());
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const mutation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.getDashboard(projectId, viewerId).then((dashboard) => { if (!cancelled) setData(dashboard); })
      .catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load the dashboard."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, viewerId, attempt]);

  const recordDispute: DisputeSubmitted = (dispute, dashboard) => {
    if (!mounted.current || dispute.memberId !== viewerId) return;
    setData((current) => {
      if (dashboard?.project.id === projectId && dashboard.viewerId === viewerId) return dashboard;
      return current ? { ...current, myDisputes: [dispute, ...current.myDisputes.filter((d) => d.id !== dispute.id)] } : current;
    });
  };

  async function assign(event: FormEvent<HTMLFormElement>, login: string) {
    event.preventDefault();
    const memberId = selected.get(login);
    if (!data || !memberId || mutation.current) return;
    mutation.current = true;
    setAssigning(true);
    setAssignmentError("");
    setNotice("");
    let assigned = false;
    try {
      await api.addAlias(projectId, memberId, login);
      assigned = true;
      const dashboard = await api.getDashboard(projectId, viewerId);
      if (!mounted.current) return;
      setData(dashboard);
      setNotice(`Assigned @${login} to ${data.project.members.find((m) => m.id === memberId)?.name ?? "the selected member"}.`);
    } catch (error: unknown) {
      if (mounted.current) setAssignmentError(assigned ? "The login was assigned, but the dashboard could not refresh. Refresh the dashboard to see the update." : error instanceof Error ? error.message : "Could not assign this login. Please try again.");
    } finally {
      mutation.current = false;
      if (mounted.current) setAssigning(false);
    }
  }

  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div>
      {data && <p className="text-sm font-medium text-blue-700">{data.project.name}</p>}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-gray-600">A shared view of the plan, progress, and checkpoints.</p>
    </div><button type="button" className={buttonClass} disabled={loading || assigning} onClick={() => { setNotice(""); setAssignmentError(""); setAttempt((n) => n + 1); }}>Refresh dashboard</button></header>
    {loading ? <LoadingState message="Loading project progress…" /> : error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><p>{error}</p><button type="button" className={`${buttonClass} mt-3`} onClick={() => setAttempt((n) => n + 1)}>Retry loading dashboard</button></div> : data && <>
      {!data.project.planActive && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">The plan is awaiting agreement. Review and approve items in the <Link to="/taskmap" className="font-medium underline">task map</Link>.</p>}
      <section aria-label="Overall progress" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <TaskProgress label="Overall project progress" completion={data.overallProgress} />
        <p className="mt-3 text-xs leading-5 text-gray-500">Completion is weighted by each tracked task’s effort points. Untracked tasks are excluded.</p>
        <p className="mt-2 text-sm text-gray-600">Deadline: <time dateTime={data.project.deadline}>{new Date(data.project.deadline).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></p>
      </section>
      <section aria-labelledby="timeline-heading" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"><h2 id="timeline-heading" className="mb-4 text-lg font-semibold">Project progress over time</h2><ActivityTimeline timeline={data.timeline} /></section>
      <section aria-labelledby="tasks-heading" className="space-y-4"><h2 id="tasks-heading" className="text-xl font-semibold">Tasks and checkpoints</h2>
        {!data.tasks.length && <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">No tasks yet. Generate a plan in <Link to="/setup" className="text-blue-700 underline">Setup</Link>.</p>}
        {data.tasks.map(({ task, checkpoints }) => {
          const owner = data.project.members.find((m) => m.id === task.ownerId);
          return <article key={task.id} aria-labelledby={`dashboard-task-${task.id}`} className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id={`dashboard-task-${task.id}`} className="text-lg font-semibold">{task.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-sm text-gray-600">Owner: {owner?.name ?? "Unassigned"}</span>{owner && <MemberStatus member={owner} members={data.project.members} />}</div>
            </div><span className="text-xs text-gray-500">{task.tracked ? `${task.points} effort points` : "Untracked"}</span></div>
            {task.description && <p className="mt-3 text-sm leading-6 text-gray-600">{task.description}</p>}
            {task.tracked ? <><div className="mt-4"><TaskProgress label={`${task.title} completion`} completion={task.completion} /></div><div className="mt-4 border-t border-gray-100 pt-1"><CheckpointList checkpoints={checkpoints} projectId={projectId} viewerId={viewerId} disputes={data.myDisputes} onSubmitted={recordDispute} /></div></> : <p className="mt-4 text-sm text-gray-500">Outside code tracking. This task has no checkpoints and does not trigger reminders.</p>}
            <EvidenceDrawer projectId={projectId} viewerId={viewerId} task={task} checkpoints={checkpoints} evidence={data.myEvidence.find((entry) => entry.taskId === task.id)} disputes={data.myDisputes} onSubmitted={recordDispute} />
          </article>;
        })}
      </section>
      <section aria-labelledby="unmatched-heading" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 id="unmatched-heading" className="text-lg font-semibold">Unmatched GitHub logins</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">Assign an unrecognized GitHub identity to the teammate who uses it.</p>
        <p role="status" className="mt-3 text-sm text-green-800">{assigning ? "Assigning login…" : notice}</p>
        {assignmentError && <p role="alert" className="mt-3 text-sm text-red-800">{assignmentError}</p>}
        {!data.unmatched.length ? <p className="mt-3 text-sm text-gray-500">No unmatched logins.</p> : <ul className="mt-3 divide-y divide-gray-100">{data.unmatched.map(({ login }) => <li key={login} className="py-3">
          <form onSubmit={(event) => assign(event, login)} className="flex flex-wrap items-end gap-3"><span className="mr-auto self-center text-sm font-medium">@{login}</span>
            <label className="text-sm font-medium">Assign @{login} to
              <select required value={selected.get(login) ?? ""} disabled={assigning} onChange={(event) => setSelected((choices) => new Map(choices).set(login, event.target.value))} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
                <option value="">Choose a member</option>{data.project.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label><button type="submit" className={buttonClass} disabled={assigning || !selected.get(login)} aria-label={`Assign @${login}`}>Assign to member</button>
          </form>
        </li>)}</ul>}
      </section>
    </>}
  </div>;
}
