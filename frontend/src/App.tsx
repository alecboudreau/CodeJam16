import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { Project } from "@enforcer/shared";
import {
  api,
  getViewerId,
  setViewerId as saveViewerId,
  useMocks,
} from "./api/client";
import { demoProjectId } from "./api/mock";
import Setup from "./pages/Setup";
import TaskMap from "./pages/TaskMap";
import Dashboard from "./pages/Dashboard";
import Trace from "./pages/Trace";
import Report from "./pages/Report";
import { ErrorState, LoadingState } from "./components/PageFeedback";
import SignIn from "./pages/SignIn";
import { signOut, supabase } from "./auth/supabase";
import {
  DEMO_PROJECT_ID,
  enterDemo,
  exitDemo,
  forgetPresenterKey,
  isDemoMode,
} from "./demo";
import PageErrorBoundary from "./components/PageErrorBoundary";
import Inbox, { useInbox } from "./pages/Inbox";
import Groups from "./pages/Groups";
import GroupSwitcher from "./components/GroupSwitcher";
import MyWork from "./pages/MyWork";
import ProjectInfo from "./pages/ProjectInfo";
import Icon, { type IconName } from "./components/Icon";
import { EmptyState, Enforcer } from "./components/Enforcer";

const links = [
  ["/work", "My work", "work"],
  ["/groups", "Groups", "shield"],
  ["/project", "Project info", "info"],
  ["/dashboard", "Dashboard", "dashboard"],
  ["/taskmap", "Team contract", "plan"],
  ["/inbox", "Inbox", "inbox"],
  ["/trace", "Agent trace", "trace"],
  ["/report", "Status report", "report"],
] as const;

interface ProjectContextValue {
  project: Project | null;
  setProject: (project: Project | null) => void;
  viewerId: string;
  viewerLoading: boolean;
  setViewerId: (memberId: string) => void;
  projectLoading: boolean;
  projectError: string;
  retryProject: () => void;
  openDemo: () => void;
}
const ProjectContext = createContext<ProjectContextValue | null>(null);

// ---------- sign-in (#62) ----------
// The backend says whether sign-in is on (GET /auth/config), so the web app never needs its own setting.
interface AuthValue {
  on: boolean;
  email: string;
  userId: string;
}
const AuthContext = createContext<AuthValue>({
  on: false,
  email: "",
  userId: "",
});
const useAuth = () => useContext(AuthContext);

function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    "checking" | "off" | "signed-out" | "signed-in" | "error"
  >(useMocks || isDemoMode() ? "off" : "checking");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (useMocks || isDemoMode()) return; // the public demo needs no sign-in (#76)
    let cancelled = false;
    let unsubscribe = () => {};
    setState("checking");
    api
      .getAuthConfig()
      .then(async ({ enabled }) => {
        if (cancelled) return;
        if (!enabled) {
          setState("off");
          return;
        }
        if (!supabase) {
          setError(
            "Sign-in is on, but VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY aren't set for the web app.",
          );
          setState("error");
          return;
        }
        const apply = (
          session: { user: { id: string; email?: string } } | null,
        ) => {
          if (cancelled) return;
          setEmail(session?.user.email ?? "");
          setUserId(session?.user.id ?? "");
          setState(session ? "signed-in" : "signed-out");
        };
        apply((await supabase.auth.getSession()).data.session);
        unsubscribe = supabase.auth.onAuthStateChange((_event, session) =>
          apply(session),
        ).data.subscription.unsubscribe;
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Couldn't reach the backend.",
          );
          setState("error");
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [attempt]);

  if (state === "checking")
    return (
      <div className="p-8">
        <LoadingState message="Checking sign-in…" />
      </div>
    );
  if (state === "error")
    return (
      <div className="p-8">
        <ErrorState
          title="Could not start the app"
          onRetry={() => setAttempt((n) => n + 1)}
          retryLabel="Retry"
        >
          <p>{error}</p>
        </ErrorState>
      </div>
    );
  if (state === "signed-out") return <SignIn />;
  return (
    <AuthContext.Provider value={{ on: state === "signed-in", email, userId }}>
      {children}
    </AuthContext.Provider>
  );
}

// Later pages can adopt a created project and react to member changes.
export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (!context) throw new Error("useProject must be used inside App");
  return context;
}
const projectStorageKey = `enforcer:project:${useMocks ? "mock" : "live"}`;
function savedProjectId(): string {
  if (isDemoMode()) return DEMO_PROJECT_ID;
  try {
    return (
      localStorage.getItem(projectStorageKey) || (useMocks ? demoProjectId : "")
    );
  } catch {
    return useMocks ? demoProjectId : "";
  }
}

function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, updateProject] = useState<Project | null>(null);
  const [pickedViewerId, updateViewerId] = useState("");
  const [verifiedViewer, setVerifiedViewer] = useState<{
    identity: string;
    id: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [projectLoading, setProjectLoading] = useState(
    () => !!savedProjectId(),
  );
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
    if (!isDemoMode()) {
      try {
        if (value) localStorage.setItem(projectStorageKey, value.id);
        else localStorage.removeItem(projectStorageKey);
      } catch {
        /* Storage is optional for the current session. */
      }
    }
  };
  useEffect(() => {
    let cancelled = false;
    const id = nextProjectId.current ?? savedProjectId();
    if (id) {
      setError("");
      setProjectLoading(true);
      api
        .getProject(id)
        .then((value) => {
          if (!cancelled) setProject(value);
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setError(
              error instanceof Error
                ? error.message
                : "Could not load the project.",
            );
        })
        .finally(() => {
          if (!cancelled) setProjectLoading(false);
        });
    } else setProjectLoading(false);
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const auth = useAuth();
  const memberIdentity =
    auth.on && project
      ? JSON.stringify([auth.userId, project.id, attempt])
      : "";
  const viewerLoading =
    !!memberIdentity && verifiedViewer?.identity !== memberIdentity && !error;
  const viewerId = auth.on
    ? verifiedViewer?.identity === memberIdentity
      ? verifiedViewer.id
      : ""
    : pickedViewerId;
  useEffect(() => {
    if (!auth.on || !project || projectLoading) return;
    let cancelled = false;
    setError("");
    api
      .getMe(project.id)
      .then((me) => {
        if (cancelled) return;
        if (!project.members.some((member) => member.id === me.id))
          throw new Error(
            "Your project membership changed. Retry to reload the team.",
          );
        saveViewerId(project.id, me.id);
        setVerifiedViewer({ identity: memberIdentity, id: me.id });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Could not work out who you are in this project.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [auth.on, auth.userId, project, projectLoading, attempt, memberIdentity]);
  const setViewerId = (id: string) => {
    if (!project || (id && !project.members.some((m) => m.id === id))) return;
    saveViewerId(project.id, id);
    updateViewerId(id);
  };
  const openDemo = () => {
    nextProjectId.current = demoProjectId;
    try {
      localStorage.setItem(projectStorageKey, demoProjectId);
    } catch {
      /* Mock mode defaults to this project without storage. */
    }
    updateProject(null);
    updateViewerId("");
    setError("");
    setProjectLoading(true);
    setAttempt((n) => n + 1);
  };
  return (
    <ProjectContext.Provider
      value={{
        project,
        setProject,
        viewerId,
        viewerLoading,
        setViewerId,
        projectLoading,
        projectError: error,
        retryProject: () => {
          setProjectLoading(true);
          setAttempt((n) => n + 1);
        },
        openDemo,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

function AppShell() {
  const {
    project,
    setProject,
    viewerId,
    setViewerId,
    projectLoading,
    projectError,
    retryProject,
    openDemo,
  } = useProject();
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const inbox = useInbox(
    !projectLoading && !projectError ? (project?.id ?? "") : "",
    viewerId,
  );
  // The groups page (and "/", which redirects to it) works without a loaded project.
  const onGroups = location.pathname === "/groups" || location.pathname === "/";
  const [navOpen, setNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      setNavOpen(false);
      mainRef.current?.focus();
      previousPath.current = location.pathname;
    }
  }, [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    navRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
        navButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [navOpen]);
  const viewer = project?.members.find((m) => m.id === viewerId);
  return (
    <div className="workspace">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className={`workspace-rail ${navOpen ? "is-open" : ""}`}>
        <Link
          to="/groups"
          className="brand-lockup"
          aria-label="Enforcer groups"
        >
          <span className="brand-symbol">
            <img src="/brand/mark.svg?v=4" width="40" height="40" alt="" />
          </span>
          <span>
            Enforcer
          </span>
        </Link>
        <GroupSwitcher />
        <nav
          ref={navRef}
          id="workspace-navigation"
          aria-label="Main navigation"
          className="workspace-nav"
        >
          {links.map(([to, label, icon]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-item ${isActive ? "is-active" : ""}`
              }
            >
              <Icon name={icon as IconName} />
              <span>{label}</span>
              {to === "/inbox" && project && viewerId && inbox.data?.unreadCount !== 0 && (
                <span
                  className="nav-count"
                  aria-live="polite"
                  aria-atomic="true"
                  aria-label={
                    inbox.data
                      ? `${inbox.data.unreadCount} unread reminders`
                      : inbox.error
                        ? "Inbox unavailable"
                        : "Loading Inbox"
                  }
                >
                  {inbox.data?.unreadCount ?? (inbox.error ? "?" : "…")}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="rail-steward">
          <p>
            Make the plan.
            <br />
            <strong>Keep the promise.</strong>
          </p>
        </div>
        <div className="rail-footer">
          <Icon name="shield" />
          <span>Your evidence stays yours.</span>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div className="topbar-location">
            <button
              ref={navButtonRef}
              type="button"
              className="btn btn-icon mobile-nav-toggle"
              aria-label={navOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={navOpen}
              aria-controls="workspace-navigation"
              onClick={() => setNavOpen((open) => !open)}
            >
              <Icon name={navOpen ? "close" : "menu"} />
            </button>
            <span className="topbar-workspace">Workspace</span>
            <span className="topbar-slash" aria-hidden="true">
              /
            </span>
            <span className="mobile-brand">Enforcer</span>
            <span className="topbar-route">
              {location.pathname === "/setup"
                ? "Create a group"
                : (links.find(([to]) => to === location.pathname)?.[1] ??
                  "Page not found")}
            </span>
            {useMocks && <span className="demo-data-label">Sample data</span>}
          </div>
          {auth.on ? (
            <div className="identity-control">
              <span className="member-avatar">
                {(viewer?.name ?? auth.email).slice(0, 1)}
              </span>
              <span>{viewer?.name ?? auth.email}</span>
              <button
                type="button"
                onClick={() => {
                  void signOut();
                }}
                className="btn btn-quiet"
              >
                Sign out
              </button>
            </div>
          ) : (
            <label className="identity-control">
              <span className="member-avatar" aria-hidden="true">
                {viewer?.name.slice(0, 1) ?? "?"}
              </span>
              <span className="identity-label">Who are you?</span>
              <select
                aria-label="Who are you?"
                value={viewerId}
                disabled={projectLoading || !project?.members.length}
                onChange={(event) => setViewerId(event.target.value)}
              >
                <option value="">
                  {projectLoading
                    ? "Loading team…"
                    : project
                      ? "Choose member"
                      : "Set up a project first"}
                </option>
                {project?.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} (@{member.githubUsername})
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        {isDemoMode() && <DemoBanner />}
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="workspace-main"
        >
          <PageErrorBoundary
            resetKey={`${location.pathname}:${project?.id ?? ""}:${viewerId}`}
          >
            {!onGroups && projectLoading ? (
              <LoadingState message="Loading your project…" />
            ) : !onGroups && projectError ? (
              <section className="empty-state">
                <Enforcer size="large" />
                <div>
                  <h2>No project found</h2>
                  <div className="empty-state-detail">
                    <p>
                      This project may have been deleted, or you&apos;re not on
                      its team anymore. Make a new one, or open one of your
                      groups.
                    </p>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setProject(null);
                        navigate("/setup");
                      }}
                    >
                      Make a project
                      <Icon name="arrow" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setProject(null);
                        navigate("/groups");
                      }}
                    >
                      Go to your groups
                    </button>
                    {useMocks && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={openDemo}
                      >
                        Open demo project
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={retryProject}
                    >
                      <Icon name="refresh" />
                      Try again
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <Routes>
                <Route path="/" element={<Navigate to="/groups" replace />} />
                <Route path="/work" element={<MyWork />} />
                <Route path="/project" element={<ProjectInfo />} />
                <Route path="/groups" element={<Groups />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="/taskmap" element={<TaskMap />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route
                  path="/inbox"
                  element={
                    <Inbox
                      key={`${project?.id ?? ""}:${viewerId}`}
                      inbox={inbox}
                    />
                  }
                />
                <Route path="/trace" element={<Trace />} />
                <Route path="/report" element={<Report />} />
                <Route
                  path="*"
                  element={
                    <EmptyState
                      title="Nothing on the plan lives here."
                      action={{ to: "/dashboard", label: "Back to Dashboard" }}
                    >
                      <p>
                        This page doesn’t exist. It may have moved, or the link
                        has a typo. Use the navigation to find your way back.
                      </p>
                    </EmptyState>
                  }
                />
              </Routes>
            )}
          </PageErrorBoundary>
        </main>
      </div>
    </div>
  );
}

// /demo (optionally /demo?key=<presenter key>) switches this tab into demo mode, then opens the trace.
function DemoEntry() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  enterDemo(params.get("key"));
  return <Navigate to="/trace" replace />;
}

function DemoBanner() {
  const [presenter, setPresenter] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api
      .getPresenterStatus()
      .then((s) => {
        if (!cancelled) setPresenter(s.presenter);
      })
      .catch(() => {
        if (!cancelled) setPresenter(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function reset() {
    setBusy(true);
    setError("");
    try {
      await api.resetDemo();
      window.location.assign("/trace");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the demo.");
      setBusy(false);
    }
  }
  function exit() {
    exitDemo();
    window.location.assign("/");
  }
  return (
    <div
      role="region"
      aria-label="Demo mode"
      className="border-b border-amber-200 bg-amber-50"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm text-amber-950 sm:px-6 lg:px-8">
        <span className="font-semibold">Demo mode</span>
        <span>PayLite sample data, no sign-in.</span>
        <span>
          {presenter === null
            ? ""
            : presenter
              ? "Presenter: Discord messages on."
              : "Discord messages off (Inbox and trace only)."}
        </span>
        {presenter && (
          <button
            type="button"
            className="underline"
            onClick={() => {
              forgetPresenterKey();
              setPresenter(false);
            }}
          >
            Forget presenter key
          </button>
        )}
        <span className="flex flex-wrap gap-2 sm:ml-auto">
          <button
            type="button"
            disabled={busy}
            onClick={reset}
            className="btn btn-secondary"
          >
            {busy ? "Resetting…" : "Reset demo"}
          </button>
          <button
            type="button"
            onClick={exit}
            className="btn btn-secondary"
          >
            Exit demo
          </button>
        </span>
        {error && (
          <span role="alert" className="w-full text-red-800">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  if (location.pathname === "/demo" || location.pathname.startsWith("/demo/"))
    return <DemoEntry />;
  return (
    <AuthGate>
      <ProjectProvider>
        <AppShell />
      </ProjectProvider>
    </AuthGate>
  );
}
