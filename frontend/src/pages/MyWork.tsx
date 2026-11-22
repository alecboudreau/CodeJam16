import { useEffect, useState } from "react";
import type { Checkpoint, Task } from "@enforcer/shared";
import { api } from "../api/client";
import { useProject } from "../App";
import { EmptyState } from "../components/Enforcer";
import Icon from "../components/Icon";
import { ErrorState, LoadingState } from "../components/PageFeedback";

interface WorkItem {
  id: string;
  task: Task;
  checkpoints: Checkpoint[];
  dependencyTitles: string[];
  /** The next checkpoint that isn't met yet, if any. */
  next?: Checkpoint;
  /** When this task is next due: its next open checkpoint, or the project deadline. */
  dueAt: string;
}

interface ProjectWork {
  id: string;
  name: string;
  deadline: string;
  items: WorkItem[];
}

const time = (iso: string) => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};
const shortDate = (iso: string) =>
  Number.isFinite(Date.parse(iso))
    ? new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : iso;
const longDate = (iso: string) =>
  Number.isFinite(Date.parse(iso))
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : iso;
const statusText: Record<Checkpoint["status"], string> = { pending: "Pending", met: "Met", missed: "Missed", alerted: "Missed · team told" };

export default function MyWork() {
  const { project, viewerId } = useProject();
  const viewer = project?.members.find((member) => member.id === viewerId);
  const [projects, setProjects] = useState<ProjectWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!viewer) {
      setLoading(false);
      setProjects([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api.listGroups()
      .then(async (groups) => {
        const login = viewer.githubUsername.toLowerCase();
        const email = viewer.email?.toLowerCase();
        const groupsToRead = project && groups.some((group) => group.id === project.id) ? groups : [...groups, { id: project?.id ?? "", name: project?.name ?? "" }];
        const lists = await Promise.all(groupsToRead.filter((group) => group.id).map(async (group): Promise<ProjectWork | null> => {
          const [full, plan] = await Promise.all([api.getProject(group.id), api.getTaskMap(group.id)]);
          const mine = full.members.find((member) => member.githubUsername.toLowerCase() === login)
            ?? (email ? full.members.find((member) => member.email?.toLowerCase() === email) : undefined);
          if (!mine) return null;
          const titles = new Map(plan.tasks.map((task) => [task.id, task.title]));
          const items = plan.tasks
            .filter((task) => task.ownerId === mine.id && task.completion < 1)
            .map((task) => {
              const checkpoints = plan.checkpoints
                .filter((checkpoint) => checkpoint.taskId === task.id)
                .sort((a, b) => time(a.dueAt) - time(b.dueAt));
              const next = checkpoints.find((checkpoint) => checkpoint.status !== "met");
              return {
                id: `${full.id}:${task.id}`,
                task,
                checkpoints,
                dependencyTitles: task.dependsOn.map((id) => titles.get(id) ?? id),
                next,
                dueAt: next?.dueAt ?? full.deadline,
              };
            })
            .sort((a, b) => time(a.dueAt) - time(b.dueAt) || a.task.title.localeCompare(b.task.title));
          return items.length ? { id: full.id, name: full.name, deadline: full.deadline, items } : null;
        }));
        // Projects whose next task is due soonest come first.
        const sorted = lists
          .filter((value): value is ProjectWork => value !== null)
          .sort((a, b) => time(a.items[0].dueAt) - time(b.items[0].dueAt));
        if (!cancelled) setProjects(sorted);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your work."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [viewer, project, attempt]);

  if (!project) {
    return (
      <div className="page-stack">
        <header className="page-heading"><h1>My work</h1><p>Unfinished tasks assigned to you, from every group.</p></header>
        <EmptyState title="Open a group first." action={{ to: "/groups", label: "Go to Groups" }}><p>Choose who you are in a group to gather the tasks assigned to you.</p></EmptyState>
      </div>
    );
  }
  if (!viewer) {
    return (
      <div className="page-stack">
        <header className="page-heading"><h1>My work</h1><p>Unfinished tasks assigned to you, from every group.</p></header>
        <EmptyState title="Choose who you are."><p>Pick yourself in the header so this page can find your tasks.</p></EmptyState>
      </div>
    );
  }

  return (
    <div className="page-stack max-w-4xl">
      <header className="page-heading">
        <div>
          <h1>My work</h1>
          <p>Unfinished tasks assigned to {viewer.name}, grouped by project and sorted by what&apos;s due first.</p>
        </div>
      </header>
      {loading ? <LoadingState message="Loading your tasks…" /> : error ? <ErrorState title="Could not load your work" onRetry={() => setAttempt((n) => n + 1)}><p>{error}</p></ErrorState> : projects.length === 0 ? (
        <EmptyState title="Nothing unfinished is assigned to you."><p>Completed tasks stay on each group&apos;s plan and do not appear here.</p></EmptyState>
      ) : (
        <div className="work-projects">
          {projects.map((group) => (
            <section key={group.id} className="work-project" aria-labelledby={`work-${group.id}`}>
              <header className="work-project-head">
                <h2 id={`work-${group.id}`}>
                  <span className="work-project-mark" aria-hidden="true">{group.name.trim().charAt(0).toUpperCase() || "P"}</span>
                  {group.name}
                </h2>
                <p className="work-project-meta">
                  Deadline {shortDate(group.deadline)} · {group.items.length} {group.items.length === 1 ? "task" : "tasks"}
                </p>
              </header>
              <div>
                {group.items.map((item) => {
                  const overdue = item.next ? item.next.status !== "pending" : false;
                  return (
                    <details key={item.id} className="plan-task">
                      <summary>
                        <span className={`work-due ${overdue ? "is-overdue" : ""}`}>
                          <time dateTime={item.dueAt}>{shortDate(item.dueAt)}</time>
                          {overdue && <span>Missed</span>}
                        </span>
                        <span className="plan-task-title">
                          <h3>{item.task.title}</h3>
                          <span className="plan-task-meta">
                            {item.next ? `Next: ${item.next.criteria}` : item.task.tracked ? "Due by the project deadline" : "Not tracked · due by the project deadline"}
                            {item.task.tracked && ` · ${Math.round(item.task.completion * 100)}% done`}
                          </span>
                        </span>
                        <Icon name="chevron" className="plan-task-chevron" />
                      </summary>
                      <div className="plan-task-body work-detail">
                        <p>{item.task.description || "No description yet."}</p>
                        <p className="work-facts">
                          {item.task.points} {item.task.points === 1 ? "point" : "points"} of effort · {item.task.tracked ? "Tracked in the repo" : "Not tracked in the repo"}
                          {item.task.paths.length > 0 && <> · <code>{item.task.paths.join(", ")}</code></>}
                        </p>
                        {item.dependencyTitles.length > 0 && <p className="work-facts">Starts after: {item.dependencyTitles.join(", ")}</p>}
                        {item.checkpoints.length > 0 && (
                          <ul className="contract-checkpoints" aria-label={`Checkpoints for ${item.task.title}`}>
                            {item.checkpoints.map((checkpoint) => (
                              <li key={checkpoint.id}>
                                <time dateTime={checkpoint.dueAt} title={longDate(checkpoint.dueAt)}>{shortDate(checkpoint.dueAt)}</time>
                                <span>{checkpoint.criteria}</span>
                                <b className={`contract-cp-status is-${checkpoint.status}`}>{statusText[checkpoint.status]}</b>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
