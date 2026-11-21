import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import type { Project } from "@enforcer/shared";
import { api, getViewerId, setViewerId as saveViewerId, useMocks } from "./api/client";
import { demoProjectId } from "./api/mock";
import Setup from "./pages/Setup";
import TaskMap from "./pages/TaskMap";
import Dashboard from "./pages/Dashboard";
import Trace from "./pages/Trace";
import Report from "./pages/Report";

const links = [
  ["/setup", "Setup"],
  ["/taskmap", "Task map"],
  ["/dashboard", "Dashboard"],
  ["/trace", "Trace"],
  ["/report", "Report"],
] as const;

interface ProjectContextValue {
  project: Project | null;
  setProject: (project: Project | null) => void;
  viewerId: string;
  setViewerId: (memberId: string) => void;
}
const ProjectContext = createContext<ProjectContextValue | null>(null);

// Later pages can adopt a created project and react to member changes.
export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) throw new Error("useProject must be used inside App");
  return context;
}
const projectStorageKey = `enforcer:project:${useMocks ? "mock" : "live"}`;
function savedProjectId(): string {
  try { return localStorage.getItem(projectStorageKey) || (useMocks ? demoProjectId : ""); }
  catch { return useMocks ? demoProjectId : ""; }
}

function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, updateProject] = useState<Project | null>(null);
  const [viewerId, updateViewerId] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const setProject = (value: Project | null) => {
    setError("");
    updateProject(value);
    const saved = value ? getViewerId(value.id) : "";
    const selected = value?.members.some((m) => m.id === saved) ? saved : "";
    if (value) saveViewerId(value.id, selected);
    updateViewerId(selected);
    try {
      if (value) localStorage.setItem(projectStorageKey, value.id);
      else localStorage.removeItem(projectStorageKey);
    } catch { /* Storage is optional for the current session. */ }
  };
  useEffect(() => {
    let cancelled = false;
    const id = savedProjectId();
    if (id) {
      setError("");
      api.getProject(id).then((value) => { if (!cancelled) setProject(value); })
        .catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load the project."); });
    }
    return () => { cancelled = true; };
  }, [attempt]);
  const setViewerId = (id: string) => {
    if (!project || (id && !project.members.some((m) => m.id === id))) return;
    saveViewerId(project.id, id);
    updateViewerId(id);
  };
  return (
    <ProjectContext.Provider value={{ project, setProject, viewerId, setViewerId }}>
      {error && <div role="alert" className="flex items-center gap-3 bg-red-50 px-6 py-3 text-red-800">
        {error}<button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
      </div>}
      {children}
    </ProjectContext.Provider>
  );
}

function AppShell() {
  const { project, viewerId, setViewerId } = useProject();
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-4 border-b bg-white px-6 py-3">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "font-semibold" : "text-gray-500")}>
            {label}
          </NavLink>
        ))}
        <label className="flex items-center gap-2 sm:ml-auto">
          <span className="text-sm font-medium">Who are you?</span>
          <select aria-label="Who are you?" className="rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            value={viewerId} disabled={!project?.members.length} onChange={(event) => setViewerId(event.target.value)}>
            <option value="">{project ? "Choose a member" : "Set up a project first"}</option>
            {project?.members.map((member) => <option key={member.id} value={member.id}>{member.name} (@{member.githubUsername})</option>)}
          </select>
        </label>
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/taskmap" element={<TaskMap />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/report" element={<Report />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return <ProjectProvider><AppShell /></ProjectProvider>;
}
