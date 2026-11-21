import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Project } from "@enforcer/shared";
import { api, getViewerId, setViewerId as saveViewerId, useMocks } from "./api/client";
import { demoProjectId } from "./api/mock";
import Setup from "./pages/Setup";
import TaskMap from "./pages/TaskMap";
import Dashboard from "./pages/Dashboard";
import Trace from "./pages/Trace";
import Report from "./pages/Report";
import { ErrorState, LoadingState } from "./components/PageFeedback";
import PageErrorBoundary from "./components/PageErrorBoundary";

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
  projectLoading: boolean;
  projectError: string;
  retryProject: () => void;
  openDemo: () => void;
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
  const [projectLoading, setProjectLoading] = useState(() => !!savedProjectId());
  const [attempt, setAttempt] = useState(0);
  const nextProjectId = useRef<string | null>(null);
  const setProject = (value: Project | null) => {
    nextProjectId.current = value?.id ?? null;
    setError("");
    setProjectLoading(false);
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
    const id = nextProjectId.current ?? savedProjectId();
    if (id) {
      setError("");
      setProjectLoading(true);
      api.getProject(id).then((value) => { if (!cancelled) setProject(value); })
        .catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load the project."); })
        .finally(() => { if (!cancelled) setProjectLoading(false); });
    } else setProjectLoading(false);
    return () => { cancelled = true; };
  }, [attempt]);
  const setViewerId = (id: string) => {
    if (!project || (id && !project.members.some((m) => m.id === id))) return;
    saveViewerId(project.id, id);
    updateViewerId(id);
  };
  const openDemo = () => {
    nextProjectId.current = demoProjectId;
    try { localStorage.setItem(projectStorageKey, demoProjectId); } catch { /* Mock mode defaults to this project without storage. */ }
    updateProject(null);
    updateViewerId("");
    setError("");
    setProjectLoading(true);
    setAttempt((n) => n + 1);
  };
  return (
    <ProjectContext.Provider value={{ project, setProject, viewerId, setViewerId, projectLoading, projectError: error, retryProject: () => setAttempt((n) => n + 1), openDemo }}>
      {children}
    </ProjectContext.Provider>
  );
}

function AppShell() {
  const { project, setProject, viewerId, setViewerId, projectLoading, projectError, retryProject, openDemo } = useProject();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:px-8">
          <Link to="/dashboard" className="font-semibold tracking-tight">Group Project Enforcer</Link>
          <div className="flex min-w-0 items-center gap-3 text-sm">{project && <span className="max-w-xs truncate text-gray-600" title={project.name}>Project: {project.name}</span>}{useMocks && <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Demo data</span>}</div>
        </div>
      <nav aria-label="Main navigation" className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-8">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-blue-50 text-blue-800" : "text-gray-600 hover:bg-gray-50"}`}>
            {label}
          </NavLink>
        ))}
        <label className="mt-1 flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:mt-0 sm:w-auto">
          <span className="shrink-0 text-sm font-medium">Who are you?</span>
          <select aria-label="Who are you?" className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm sm:max-w-64"
            value={viewerId} disabled={projectLoading || !project?.members.length} onChange={(event) => setViewerId(event.target.value)}>
            <option value="">{projectLoading ? "Loading team…" : project ? "Choose a member" : "Set up a project first"}</option>
            {project?.members.map((member) => <option key={member.id} value={member.id}>{member.name} (@{member.githubUsername})</option>)}
          </select>
        </label>
      </nav>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageErrorBoundary resetKey={`${location.pathname}:${project?.id ?? ""}:${viewerId}`}>
        {projectLoading ? <LoadingState message="Loading your project…" /> : projectError ? <ErrorState title="Could not load your project" onRetry={retryProject} retryLabel="Retry project">
          <p>{projectError}</p><p>Your saved project could not be opened. Retry, or choose another starting point.</p>
          <div className="flex flex-wrap gap-3">{useMocks && <button type="button" className="rounded-lg border border-gray-300 bg-white px-3 py-2 font-medium" onClick={openDemo}>Open demo project</button>}
            <button type="button" className="rounded-lg border border-gray-300 bg-white px-3 py-2 font-medium" onClick={() => { setProject(null); navigate("/setup"); }}>Start a new project</button></div>
        </ErrorState> : <Routes>
          <Route path="/" element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/taskmap" element={<TaskMap />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/report" element={<Report />} />
          <Route path="*" element={<ErrorState title="Page not found"><Link to="/dashboard" className="font-medium underline">Open Dashboard</Link></ErrorState>} />
        </Routes>}
        </PageErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return <ProjectProvider><AppShell /></ProjectProvider>;
}
