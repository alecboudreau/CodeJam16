import { useEffect, useState } from "react";
import type { Checkpoint, Task } from "@enforcer/shared";
import { api } from "../api/client";
import { useProject } from "../App";
import { EmptyState } from "../components/Enforcer";
import { ErrorState, LoadingState } from "../components/PageFeedback";

interface WorkItem {
  id: string;
  projectName: string;
  task: Task;
  checkpoints: Checkpoint[];
  dependencyTitles: string[];
}

const orderKey = (login: string) => `enforcer:work-order:${login.toLowerCase()}`;

function readOrder(login: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(orderKey(login)) || "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function applyOrder(items: WorkItem[], login: string): WorkItem[] {
  const rank = new Map(readOrder(login).map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? 10_000) - (rank.get(b.id) ?? 10_000) || a.task.title.localeCompare(b.task.title));
}

function formatWhen(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function MyWork() {
  const { project, viewerId } = useProject();
  const viewer = project?.members.find((member) => member.id === viewerId);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState("");
  const [reordering, setReordering] = useState(false);
  const [draggingId, setDraggingId] = useState("");

  useEffect(() => {
    if (!viewer) {
      setLoading(false);
      setItems([]);
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
        const lists = await Promise.all(groupsToRead.filter((group) => group.id).map(async (group) => {
          const [full, plan] = await Promise.all([api.getProject(group.id), api.getTaskMap(group.id)]);
          const mine = full.members.find((member) => member.githubUsername.toLowerCase() === login)
            ?? (email ? full.members.find((member) => member.email?.toLowerCase() === email) : undefined);
          if (!mine) return [];
          const titles = new Map(plan.tasks.map((task) => [task.id, task.title]));
          return plan.tasks
            .filter((task) => task.ownerId === mine.id && task.completion < 1)
            .map((task) => ({
              id: `${full.id}:${task.id}`,
              projectName: full.name,
              task,
              checkpoints: plan.checkpoints.filter((checkpoint) => checkpoint.taskId === task.id),
              dependencyTitles: task.dependsOn.map((id) => titles.get(id) ?? id),
            }));
        }));
        if (!cancelled) setItems(applyOrder(lists.flat(), viewer.githubUsername));
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your work."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [viewer, project, attempt]);

  function move(targetId: string) {
    if (!viewer || !draggingId || draggingId === targetId) return;
    setItems((current) => {
      const next = [...current];
      const from = next.findIndex((item) => item.id === draggingId);
      const to = next.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      try { localStorage.setItem(orderKey(viewer.githubUsername), JSON.stringify(next.map((item) => item.id))); } catch { /* Order still applies for this visit. */ }
      return next;
    });
  }

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
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <h1>My work</h1>
          <p>Unfinished tasks assigned to {viewer.name}, across every group.</p>
        </div>
        <button type="button" className={reordering ? "btn btn-primary" : "btn btn-secondary"} onClick={() => { setReordering((on) => !on); setDraggingId(""); }}>
          {reordering ? "Done reordering" : "Reorder tasks"}
        </button>
      </header>
      {loading ? <LoadingState message="Loading your tasks…" /> : error ? <ErrorState title="Could not load your work" onRetry={() => setAttempt((n) => n + 1)}><p>{error}</p></ErrorState> : items.length === 0 ? (
        <EmptyState title="Nothing unfinished is assigned to you."><p>Completed tasks stay on each group's plan and do not appear here.</p></EmptyState>
      ) : (
        <ul className="page-stack" style={{ gap: 12, listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item) => {
            const open = openId === item.id;
            return (
              <li
                key={item.id}
                className="panel"
                draggable={reordering}
                onDragStart={() => setDraggingId(item.id)}
                onDragOver={(event) => { if (reordering) event.preventDefault(); }}
                onDrop={() => move(item.id)}
                style={reordering ? { cursor: "grab" } : undefined}
              >
                <button type="button" onClick={() => { if (!reordering) setOpenId(open ? "" : item.id); }} aria-expanded={open} style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 16, background: "none", border: 0, padding: 0, textAlign: "left", color: "inherit", cursor: reordering ? "grab" : "pointer" }}>
                  <span>
                    <strong>{item.task.title}</strong>
                    <span className="supporting-copy" style={{ display: "block" }}>{item.projectName} · {Math.round(item.task.completion * 100)}% complete</span>
                  </span>
                  <span className="supporting-copy">{reordering ? "Drag" : open ? "Hide" : "Details"}</span>
                </button>
                {open && !reordering && (
                  <div className="supporting-copy" style={{ marginTop: 16 }}>
                    <p>{item.task.description || "No description yet."}</p>
                    <p>Effort {item.task.points} · {item.task.tracked ? "Tracked in the repo" : "Not tracked in the repo"}</p>
                    {item.task.paths.length > 0 && <p>Paths: {item.task.paths.join(", ")}</p>}
                    {item.dependencyTitles.length > 0 && <p>Depends on: {item.dependencyTitles.join(", ")}</p>}
                    {item.checkpoints.length > 0 && (
                      <ul>
                        {item.checkpoints.map((checkpoint) => (
                          <li key={checkpoint.id}>{checkpoint.criteria} · {checkpoint.status} · due {formatWhen(checkpoint.dueAt)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
