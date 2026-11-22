import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CreateProjectBody, type Project } from "@enforcer/shared";
import { api } from "../api/client";
import { useProject } from "../App";
import { Enforcer } from "../components/Enforcer";
import Icon from "../components/Icon";

interface MemberDraft {
  key: string;
  name: string;
  githubUsername: string;
  email: string;
  capacity: string;
}
const emptyMember = (): MemberDraft => ({
  key: crypto.randomUUID(),
  name: "",
  githubUsername: "",
  email: "",
  capacity: "",
});
const inputClass =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-500";
const buttonClass = "btn btn-secondary";

export default function Setup() {
  const { project, setProject } = useProject();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [repos, setRepos] = useState("");
  const [deadline, setDeadline] = useState("");
  const [members, setMembers] = useState<MemberDraft[]>(() => [emptyMember()]);
  const [file, setFile] = useState<File | null>(null);
  const [created, setCreated] = useState<Project | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [step, setStep] = useState<"idle" | "create" | "upload" | "generate">(
    "idle",
  );
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [linkError, setLinkError] = useState("");
  const submitting = useRef(false);
  const mounted = useRef(true);
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);
  const busy = step !== "idle";

  function editMember(
    key: string,
    field: keyof Omit<MemberDraft, "key">,
    value: string,
  ) {
    setMembers((rows) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    if (!file || !/\.(pdf|docx|md|markdown)$/i.test(file.name)) {
      setError("Choose a PDF, Word (.docx), or Markdown specification.");
      return;
    }
    if (!file.size) {
      setError(
        "The specification is empty. Choose a file with the project requirements.",
      );
      return;
    }

    let current = created;
    // Validate before creating anything. Once created, retries resume the upload or generation.
    const result = CreateProjectBody.safeParse({
      name: name.trim(),
      repos: [
        ...new Set(
          repos
            .split(/[\n,]+/)
            .map((repo) =>
              repo
                .trim()
                .replace(/^https?:\/\/github\.com\//i, "")
                .replace(/\/$/, "")
                .replace(/\.git$/i, ""),
            )
            .filter(Boolean),
        ),
      ],
      deadline:
        deadline && Number.isFinite(Date.parse(deadline))
          ? new Date(deadline).toISOString()
          : "",
      members: members.map((m) => ({
        name: m.name.trim(),
        githubUsername: m.githubUsername.trim().replace(/^@/, ""),
        ...(m.email.trim() ? { email: m.email.trim() } : {}),
        ...(m.capacity !== ""
          ? { capacityHoursPerWeek: Number(m.capacity) }
          : {}),
      })),
    });
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue.path[0];
      setError(
        field === "repos"
          ? "Enter at least one GitHub repository as owner/repo or a GitHub URL."
          : field === "deadline"
            ? "Choose a valid project deadline."
            : field === "members"
              ? "Check each teammate’s name, GitHub username, email, and capacity (more than 0, up to 80 hours/week)."
              : "Enter a project name.",
      );
      return;
    }
    const logins = result.data.members.map((m) =>
      m.githubUsername.toLowerCase(),
    );
    if (new Set(logins).size !== logins.length) {
      setError("Each teammate needs a different GitHub username.");
      return;
    }
    if (!current && Date.parse(result.data.deadline) <= Date.now()) {
      setError("Choose a deadline in the future.");
      return;
    }

    submitting.current = true;
    try {
      if (!current) {
        setStep("create");
        current = await api.createProject(result.data);
        if (!mounted.current) return;
        setCreated(current);
        setProject(current);
      }
      if (uploadedFile !== file) {
        setStep("upload");
        await api.uploadSpec(current.id, file);
        if (!mounted.current) return;
        setUploadedFile(file);
      }
      setStep("generate");
      await api.generateTaskMap(current.id);
      if (mounted.current) navigate("/taskmap");
    } catch (error: unknown) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "Setup could not finish. Please try again.",
        );
    } finally {
      submitting.current = false;
      if (mounted.current) setStep("idle");
    }
  }

  async function refreshLinks() {
    if (!project || refreshing) return;
    setRefreshing(true);
    setLinkError("");
    try {
      const value = await api.getProject(project.id);
      if (mounted.current) setProject(value);
    } catch (error: unknown) {
      if (mounted.current)
        setLinkError(
          error instanceof Error
            ? error.message
            : "Could not refresh Discord links.",
        );
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }

  return (
    <div className="page-stack setup-page">
      <header className="page-heading">
        <div>
          <h1>Create a group</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            Add your repositories, requirements, and team. We’ll draft tasks and
            checkpoints for everyone to review and approve.
          </p>
        </div>
      </header>

      {busy && <PlanProgress step={step} />}
      <div className="setup-layout" hidden={busy}>
        <form onSubmit={submit} aria-busy={busy} className="setup-form">
          <fieldset
            disabled={busy || !!created}
            className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
          >
            <legend className="px-2 text-base font-semibold">
              1. Project details
            </legend>
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                Project name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="e.g. Team payments app"
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm font-medium">
                GitHub repositories
                <textarea
                  required
                  value={repos}
                  onChange={(e) => setRepos(e.target.value)}
                  rows={3}
                  className={inputClass}
                  placeholder={
                    "team/payments-api\nhttps://github.com/team/payments-ui"
                  }
                  aria-describedby="repos-help"
                  spellCheck={false}
                />
              </label>
              <p id="repos-help" className="text-xs text-gray-500">
                Public repositories only. Enter one per line, or separate them
                with commas.
              </p>
              <label className="block max-w-sm text-sm font-medium">
                Project deadline
                <input
                  required
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className={inputClass}
                  aria-describedby="deadline-help"
                />
              </label>
              <p id="deadline-help" className="text-xs text-gray-500">
                Use your local time. The plan will work backward from this
                deadline.
              </p>
            </div>
          </fieldset>

          <fieldset
            disabled={busy || !!created}
            className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
          >
            <legend className="px-2 text-base font-semibold">
              2. Your team
            </legend>
            <p className="mb-4 text-sm text-gray-600">
              Include yourself. Optional weekly capacity helps size realistic
              checkpoints.
            </p>
            <div className="space-y-4">
              {members.map((m, index) => (
                <fieldset
                  key={m.key}
                  className="rounded-lg border border-gray-200 p-4"
                >
                  <legend className="px-1 text-sm font-medium">
                    Teammate {index + 1}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium">
                      Name
                      <input
                        required
                        value={m.name}
                        onChange={(e) =>
                          editMember(m.key, "name", e.target.value)
                        }
                        className={inputClass}
                        autoComplete="name"
                      />
                    </label>
                    <label className="text-sm font-medium">
                      GitHub username
                      <input
                        required
                        value={m.githubUsername}
                        onChange={(e) =>
                          editMember(m.key, "githubUsername", e.target.value)
                        }
                        className={inputClass}
                        placeholder="octocat"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </label>
                    <label className="text-sm font-medium">
                      Email{" "}
                      <span className="font-normal text-gray-500">
                        (optional)
                      </span>
                      <input
                        type="email"
                        value={m.email}
                        onChange={(e) =>
                          editMember(m.key, "email", e.target.value)
                        }
                        className={inputClass}
                        autoComplete="email"
                      />
                    </label>
                    <label className="text-sm font-medium">
                      Hours per week{" "}
                      <span className="font-normal text-gray-500">
                        (optional)
                      </span>
                      <input
                        type="number"
                        min="0.5"
                        max="80"
                        step="0.5"
                        value={m.capacity}
                        onChange={(e) =>
                          editMember(m.key, "capacity", e.target.value)
                        }
                        className={inputClass}
                        placeholder="e.g. 8"
                      />
                    </label>
                  </div>
                  {members.length > 1 && (
                    <button
                      type="button"
                      className="mt-3 text-sm font-medium text-red-700 hover:underline"
                      aria-label={`Remove teammate ${index + 1}`}
                      onClick={() =>
                        setMembers((rows) =>
                          rows.filter((row) => row.key !== m.key),
                        )
                      }
                    >
                      Remove teammate
                    </button>
                  )}
                </fieldset>
              ))}
            </div>
            <button
              type="button"
              className={`${buttonClass} mt-4`}
              onClick={() => setMembers((rows) => [...rows, emptyMember()])}
            >
              + Add teammate
            </button>
          </fieldset>

          <fieldset
            disabled={busy}
            className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
          >
            <legend className="px-2 text-base font-semibold">
              3. Project specification
            </legend>
            <label className="block text-sm font-medium">
              Upload requirements
              <input
                required
                type="file"
                accept=".pdf,.docx,.md,.markdown"
                aria-describedby="spec-help"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError("");
                }}
                className="file-drop"
              />
            </label>
            <p id="spec-help" className="mt-3 text-xs text-gray-500">
              PDF, Word (.docx), or Markdown. Include the features and
              requirements the team needs to deliver.
            </p>
          </fieldset>

          {created && (
            <p className="text-sm text-gray-600">
              Project saved. If setup fails, retry to continue with this
              project.
            </p>
          )}
          {error && (
            <div
              ref={errorBox}
              tabIndex={-1}
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {step === "create"
                ? "Creating project…"
                : step === "upload"
                  ? "Uploading specification…"
                  : step === "generate"
                    ? "Drafting your plan…"
                    : created
                      ? "Continue setup"
                      : "Create project & draft plan"}
              {!busy && <Icon name="arrow" />}
            </button>
            <p role="status" className="text-sm text-gray-500">
              {busy
                ? "Keep this page open while we prepare your plan."
                : "Everyone approves their own tasks before the plan becomes active."}
            </p>
          </div>
        </form>
        <aside className="setup-guide">
          <Enforcer size="large" />
          <h2>A plan worth keeping.</h2>
          <p>
            Be specific about the work. Be realistic about the time. Everyone
            gets a say before the plan goes live.
          </p>
          <ol>
            <li>
              <strong>Define the work</strong>Repositories, requirements,
              deadline.
            </li>
            <li>
              <strong>Make it shared</strong>Bring in the people doing the work.
            </li>
            <li>
              <strong>Agree before you begin</strong>Review your tasks and
              checkpoints.
            </li>
          </ol>
        </aside>
      </div>

      <section
        aria-labelledby="discord-heading"
        className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="discord-heading" className="text-base font-semibold">
            Discord opt-in
          </h2>
          {project && (
            <button
              type="button"
              className={buttonClass}
              onClick={refreshLinks}
              disabled={refreshing || busy}
            >
              {refreshing ? "Refreshing…" : "Refresh link status"}
            </button>
          )}
        </div>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          Each teammate joins your Discord server and runs{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">
            /link &lt;github-username&gt;
          </code>{" "}
          to opt in.
        </p>
        {project ? (
          <>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">
              Current project · {project.name}
            </p>
            <ul className="mt-2 divide-y divide-gray-100">
              {project.members.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-2 text-gray-500">
                      @{m.githubUsername}
                    </span>
                  </div>
                  <span
                    className={`status-label ${m.discordId ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}
                  >
                    {m.discordId ? "Linked" : "Not linked"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            Link statuses will appear here after the project is created.
          </p>
        )}
        {linkError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {linkError}
          </p>
        )}
      </section>
    </div>
  );
}

const planSteps = [
  {
    key: "create",
    title: "Saving your group",
    detail: "Storing the team, repositories and deadline, and creating the group's invite code.",
  },
  {
    key: "upload",
    title: "Reading your requirements",
    detail: "Pulling the text out of your specification so the AI can work from it.",
  },
  {
    key: "generate",
    title: "Drafting the plan",
    detail:
      "The AI breaks the requirements into tasks, sizes each one, shares the work out based on everyone's weekly hours, and sets checkpoints that lead up to your deadline. This is the slow part: it can take up to a minute for a long spec.",
  },
] as const;

/** Shown in place of the form while the group is saved and the plan is drafted. */
function PlanProgress({ step }: { step: "idle" | "create" | "upload" | "generate" }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const active = planSteps.findIndex((s) => s.key === step);
  const current = planSteps[active];
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <section className="plan-progress" aria-labelledby="plan-progress-title">
      <Enforcer size="large" />
      <div className="plan-progress-copy">
        <h2 id="plan-progress-title">Building your plan</h2>
        <p className="plan-progress-lead">
          Keep this page open. You'll go to your team contract as soon as the draft is ready.
        </p>
        <ol className="plan-steps">
          {planSteps.map((s, i) => {
            const state = i < active ? "done" : i === active ? "active" : "waiting";
            return (
              <li key={s.key} className={`plan-step plan-step--${state}`} aria-current={state === "active" ? "step" : undefined}>
                <span className="plan-step-marker" aria-hidden="true">
                  {state === "done" ? <Icon name="check" /> : i + 1}
                </span>
                <div>
                  <p className="plan-step-title">
                    {s.title}
                    <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : " (waiting)"}</span>
                  </p>
                  {state === "active" && <p className="plan-step-detail">{s.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
        <p role="status" aria-live="polite" className="sr-only">{current ? `${current.title}…` : ""}</p>
        <p className="plan-progress-foot">
          <span>{elapsed}</span> Nothing is final yet: everyone reviews and approves their own tasks before the plan goes live.
        </p>
      </div>
    </section>
  );
}
