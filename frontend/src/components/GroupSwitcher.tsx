import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type GroupSummary } from "../api/client";
import { useProject } from "../App";
import Icon from "./Icon";

export default function GroupSwitcher() {
  const { project, setProject, projectLoading } = useProject();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    async function refresh() {
      const current = ++request;
      try {
        const next = await api.listGroups();
        if (!cancelled && current === request) {
          setGroups(next);
          setError("");
        }
      } catch {
        if (!cancelled && current === request) setError("Couldn’t load your groups.");
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); };
  }, [project?.id, pathname, attempt]);

  async function switchGroup(id: string) {
    if (id === project?.id || switching) return;
    setSwitching(true);
    setError("");
    try {
      const next = await api.getProject(id);
      if (!mounted.current) return;
      setProject(next);
      // Start in the selected group's dashboard rather than leaving an old group's editor open.
      navigate("/dashboard");
    } catch {
      if (mounted.current) setError("Couldn’t switch groups. Try again.");
    } finally {
      if (mounted.current) setSwitching(false);
    }
  }

  return (
    <>
      <div className="rail-project" aria-busy={switching}>
        <span className="project-monogram" aria-hidden="true">
          {(project?.name ?? "Groups").slice(0, 1)}
        </span>
        <div className="rail-project-copy">
          <label className="sr-only" htmlFor="sidebar-group">Switch group</label>
          <div className="rail-project-select">
            <select
              id="sidebar-group"
              value={project?.id ?? ""}
              disabled={switching || projectLoading}
              onChange={(event) => { void switchGroup(event.target.value); }}
            >
              {!project && <option value="" disabled>Choose a group</option>}
              {project && !groups.some((group) => group.id === project.id) && (
                <option value={project.id}>{project.name}</option>
              )}
              {groups.map((group) => (
                <option key={group.id} value={group.id} disabled={group.contractJoinPending}>
                  {group.name}{group.contractJoinPending ? " · Join from Groups" : ""}
                </option>
              ))}
            </select>
            <Icon name="chevron" />
          </div>
          <span role="status">
            {switching ? "Switching group…" : project
              ? `${project.members.length} teammates · ${project.planActive ? "Active" : "In review"}`
              : "Choose your workspace"}
          </span>
        </div>
      </div>
      {error && (
        <p className="rail-switch-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Reload groups</button>
        </p>
      )}
    </>
  );
}
