import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Dashboard as DashboardData } from "@enforcer/shared";
import { api } from "../api/client";
import { useProject } from "../App";
import TaskProgress from "../components/TaskProgress";
import CheckpointList from "../components/CheckpointList";
import MemberStatus from "../components/MemberStatus";
import ActivityTimeline from "../components/ActivityTimeline";
import EvidenceDrawer, {
  type DisputeSubmitted,
} from "../components/EvidenceDrawer";
import { LoadingState } from "../components/PageFeedback";
import { EmptyState, EnforcerNote } from "../components/Enforcer";
import Icon from "../components/Icon";

const buttonClass = "btn btn-secondary";

export default function Dashboard() {
  const { project, viewerId, setViewerId } = useProject();
  if (!project)
    return (
      <div className="page-stack">
        <header className="page-heading">
          <h1>Dashboard</h1>
          <p>Good work starts with a clear agreement.</p>
        </header>
        <EmptyState
          title="Give the work a direction."
          action={{ to: "/groups", label: "Go to your groups" }}
        >
          <p>
            Add your team, requirements, and deadline. Then build a plan
            everyone can stand behind.
          </p>
        </EmptyState>
      </div>
    );
  if (!viewerId)
    return (
      <div className="page-stack">
        <header className="page-heading">
          <h1>Welcome to your workspace.</h1>
          <p>A shared plan. A clear next step. A little accountability.</p>
        </header>
        <EmptyState title="Let's put a name to the progress.">
          <p>
            Choose yourself to see your checkpoints and private evidence for{" "}
            {project.name}.
          </p>
          <label className="member-entry">
            Who are you?
            <select
              value=""
              onChange={(event) => setViewerId(event.target.value)}
            >
              <option value="">Choose a team member</option>
              {project.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
        </EmptyState>
      </div>
    );
  // A new viewer gets a fresh state immediately, including any in-flight responses.
  return (
    <ProjectDashboard
      key={`${project.id}:${viewerId}`}
      projectId={project.id}
      viewerId={viewerId}
    />
  );
}

function ProjectDashboard({
  projectId,
  viewerId,
}: {
  projectId: string;
  viewerId: string;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(() => new Map<string, string>());
  const [assigning, setAssigning] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [notice, setNotice] = useState("");
  const [taskFilter, setTaskFilter] = useState<"all" | "attention" | "mine">(
    "all",
  );
  const mounted = useRef(true);
  const mutation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .getDashboard(projectId, viewerId)
      .then((dashboard) => {
        if (!cancelled) setData(dashboard);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load the dashboard.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, viewerId, attempt]);

  const recordDispute: DisputeSubmitted = (dispute, dashboard) => {
    if (!mounted.current || dispute.memberId !== viewerId) return;
    setData((current) => {
      if (
        dashboard?.project.id === projectId &&
        dashboard.viewerId === viewerId
      )
        return dashboard;
      return current
        ? {
            ...current,
            myDisputes: [
              dispute,
              ...current.myDisputes.filter((d) => d.id !== dispute.id),
            ],
          }
        : current;
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
      setNotice(
        `Assigned @${login} to ${data.project.members.find((m) => m.id === memberId)?.name ?? "the selected member"}.`,
      );
    } catch (error: unknown) {
      if (mounted.current)
        setAssignmentError(
          assigned
            ? "The login was assigned, but the dashboard could not refresh. Refresh the dashboard to see the update."
            : error instanceof Error
              ? error.message
              : "Could not assign this login. Please try again.",
        );
    } finally {
      mutation.current = false;
      if (mounted.current) setAssigning(false);
    }
  }

  const attention =
    data?.tasks
      .flatMap(({ checkpoints }) => checkpoints)
      .filter((cp) => cp.status === "missed" || cp.status === "alerted") ?? [];
  const viewer = data?.project.members.find((member) => member.id === viewerId);
  const visibleTasks =
    data?.tasks.filter(({ task, checkpoints }) =>
      taskFilter === "mine"
        ? task.ownerId === viewerId
        : taskFilter === "attention"
          ? checkpoints.some(
              (cp) => cp.status === "missed" || cp.status === "alerted",
            )
          : true,
    ) ?? [];
  return (
    <div className="page-stack dashboard-page">
      <header className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>
            {viewer
              ? `${viewer.name}, here’s where the work stands.`
              : "A clear view of the work ahead."}
          </p>
        </div>
        <button
          type="button"
          className={buttonClass}
          disabled={loading || assigning}
          onClick={() => {
            setNotice("");
            setAssignmentError("");
            setAttempt((n) => n + 1);
          }}
        >
          <Icon name="refresh" />
          Refresh
        </button>
      </header>
      {loading ? (
        <LoadingState message="Loading project progress…" />
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
        >
          <p>{error}</p>
          <button
            type="button"
            className={`${buttonClass} mt-3`}
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry loading dashboard
          </button>
        </div>
      ) : (
        data && (
          <>
            {!data.project.planActive && (
              <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                The plan is awaiting agreement. Review and approve items in the{" "}
                <Link to="/taskmap" className="font-medium underline">
                  task map
                </Link>
                .
              </p>
            )}
            <EnforcerNote
              title={
                attention.length
                  ? "A little behind. Still in your hands."
                  : data.overallProgress >= 1
                    ? "Good. You kept your word."
                    : "Keep showing up. It adds up."
              }
              tone={attention.length ? "attention" : "success"}
              action={{
                to: "/inbox",
                label: attention.length
                  ? "Review your reminders"
                  : "Open your Inbox",
              }}
            >
              <p>
                {attention.length
                  ? `${attention.length} ${attention.length === 1 ? "checkpoint needs" : "checkpoints need"} attention across the project. Make the next move, or let the team know what’s in your way.`
                  : data.overallProgress >= 1
                    ? "All tracked work is complete. Take a moment to review the plan with your team."
                    : "Progress means meeting the plan you agreed on. Focus on the next checkpoint—we’ll keep the bigger picture in view."}
              </p>
            </EnforcerNote>
            <div className="dashboard-layout">
              <div className="dashboard-work">
                <section
                  aria-labelledby="tasks-heading"
                  className="task-collection"
                >
                  <div className="section-heading">
                    <h2 id="tasks-heading">Tasks & checkpoints</h2>
                    <span>{data.tasks.length} tasks</span>
                  </div>
                  <div
                    className="filter-row"
                    role="group"
                    aria-label="Filter tasks"
                  >
                    {(
                      [
                        ["all", "All tasks"],
                        ["attention", "Needs attention"],
                        ["mine", "Assigned to me"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={taskFilter === value}
                        className={`filter-button ${taskFilter === value ? "is-selected" : ""}`}
                        onClick={() => setTaskFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {!data.tasks.length && (
                    <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
                      No tasks yet. Generate a plan in{" "}
                      <Link to="/setup" className="text-blue-700 underline">
                        group setup
                      </Link>
                      .
                    </p>
                  )}
                  {!!data.tasks.length && !visibleTasks.length && (
                    <div className="filter-empty">
                      <Icon name="check" />
                      <p>
                        {taskFilter === "attention"
                          ? "No checkpoints need attention. Good. Keep going."
                          : "No tasks are assigned to you yet."}
                      </p>
                    </div>
                  )}
                  {visibleTasks.map(({ task, checkpoints }) => {
                    const owner = data.project.members.find(
                      (m) => m.id === task.ownerId,
                    );
                    return (
                      <article
                        key={task.id}
                        aria-labelledby={`dashboard-task-${task.id}`}
                        className="task-card"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3
                              id={`dashboard-task-${task.id}`}
                              className="text-lg font-semibold"
                            >
                              {task.title}
                            </h3>
                            <div className="task-owner">
                              <span
                                className="member-avatar member-avatar--small"
                                aria-hidden="true"
                              >
                                {owner?.name.slice(0, 1) ?? "?"}
                              </span>
                              <span>{owner?.name ?? "Unassigned"}</span>
                              {owner?.id === viewerId && (
                                <span className="you-label">You</span>
                              )}
                              {owner && (
                                <MemberStatus
                                  member={owner}
                                  members={data.project.members}
                                />
                              )}
                            </div>
                          </div>
                          <span className="text-xs text-gray-500">
                            {task.tracked
                              ? `${task.points} effort points`
                              : "Untracked"}
                          </span>
                        </div>
                        {task.description &&
                          task.description !== task.title && (
                            <p className="mt-3 text-sm leading-6 text-gray-600">
                              {task.description}
                            </p>
                          )}
                        {task.tracked ? (
                          <>
                            <div className="mt-4">
                              <TaskProgress
                                label="Completion"
                                ariaLabel={`${task.title} completion`}
                                completion={task.completion}
                              />
                            </div>
                            <div className="mt-4 border-t border-gray-100 pt-1">
                              <CheckpointList
                                checkpoints={checkpoints}
                                projectId={projectId}
                                viewerId={viewerId}
                                disputes={data.myDisputes}
                                onSubmitted={recordDispute}
                              />
                            </div>
                          </>
                        ) : (
                          <p className="mt-4 text-sm text-gray-500">
                            Outside code tracking. This task has no checkpoints
                            and does not trigger reminders.
                          </p>
                        )}
                        <EvidenceDrawer
                          projectId={projectId}
                          viewerId={viewerId}
                          task={task}
                          checkpoints={checkpoints}
                          evidence={data.myEvidence.find(
                            (entry) => entry.taskId === task.id,
                          )}
                          disputes={data.myDisputes}
                          onSubmitted={recordDispute}
                        />
                      </article>
                    );
                  })}
                </section>
                <section
                  aria-labelledby="unmatched-heading"
                  className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
                >
                  <h2 id="unmatched-heading" className="text-lg font-semibold">
                    Unmatched GitHub logins
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    Assign an unrecognized GitHub identity to the teammate who
                    uses it.
                  </p>
                  <p role="status" className="mt-3 text-sm text-green-800">
                    {assigning ? "Assigning login…" : notice}
                  </p>
                  {assignmentError && (
                    <p role="alert" className="mt-3 text-sm text-red-800">
                      {assignmentError}
                    </p>
                  )}
                  {!data.unmatched.length ? (
                    <p className="mt-3 text-sm text-gray-500">
                      No unmatched logins.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-gray-100">
                      {data.unmatched.map(({ login }) => (
                        <li key={login} className="py-3">
                          <form
                            onSubmit={(event) => assign(event, login)}
                            className="flex flex-wrap items-end gap-3"
                          >
                            <span className="mr-auto self-center text-sm font-medium">
                              @{login}
                            </span>
                            <label className="text-sm font-medium">
                              Assign @{login} to
                              <select
                                required
                                value={selected.get(login) ?? ""}
                                disabled={assigning}
                                onChange={(event) =>
                                  setSelected((choices) =>
                                    new Map(choices).set(
                                      login,
                                      event.target.value,
                                    ),
                                  )
                                }
                                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                              >
                                <option value="">Choose a member</option>
                                {data.project.members.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="submit"
                              className={buttonClass}
                              disabled={assigning || !selected.get(login)}
                              aria-label={`Assign @${login}`}
                            >
                              Assign to member
                            </button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
              <aside className="dashboard-aside">
                <section
                  aria-label="Overall progress"
                  className="panel project-progress"
                >
                  <h2>Project overview</h2>
                  <TaskProgress
                    label="Overall completion"
                    completion={data.overallProgress}
                  />
                  <p className="supporting-copy">
                    Weighted by tracked task effort. Every checkpoint moves the
                    plan forward.
                  </p>
                  <div className="project-deadline">
                    <Icon name="clock" />
                    <div>
                      <span>Project deadline</span>
                      <time dateTime={data.project.deadline}>
                        {new Date(data.project.deadline).toLocaleDateString(
                          undefined,
                          { month: "long", day: "numeric", year: "numeric" },
                        )}
                      </time>
                    </div>
                  </div>
                  <Link to="/taskmap" className="text-action">
                    Review the plan
                    <Icon name="arrow" />
                  </Link>
                </section>
                <section aria-labelledby="timeline-heading" className="panel">
                  <h2 id="timeline-heading">Steady progress</h2>
                  <ActivityTimeline timeline={data.timeline} />
                </section>
                <section
                  className="panel team-pulse"
                  aria-labelledby="team-pulse-heading"
                >
                  <h2 id="team-pulse-heading">Around the table</h2>
                  <ul>
                    {data.project.members.map((member) => (
                      <li key={member.id}>
                        <span className="member-avatar" aria-hidden="true">
                          {member.name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>
                            {member.name}
                            {member.id === viewerId ? " (you)" : ""}
                          </strong>
                          {member.status === "none" ? (
                            <span className="supporting-copy">
                              No status shared
                            </span>
                          ) : (
                            <MemberStatus
                              member={member}
                              members={data.project.members}
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="supporting-copy">
                    A shared view, not a leaderboard.
                  </p>
                </section>
                <div className="privacy-note">
                  <Icon name="shield" />
                  <p>
                    Commit evidence is visible only to the owner of the work.
                  </p>
                </div>
              </aside>
            </div>
          </>
        )
      )}
    </div>
  );
}
