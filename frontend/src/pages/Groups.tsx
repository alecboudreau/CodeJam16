import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type GroupSummary } from "../api/client";
import { useProject } from "../App";
import { ErrorState, LoadingState } from "../components/PageFeedback";
import { isDemoMode } from "../demo";

const inputClass = "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function formatDeadline(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Groups() {
  const { project, setProject } = useProject();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [openingId, setOpeningId] = useState("");
  const [code, setCode] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.listGroups()
      .then((value) => { if (!cancelled) setGroups(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your groups."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  async function openGroup(id: string) {
    if (openingId || joining) return;
    setOpeningId(id);
    setJoinError("");
    try {
      const next = await api.getProject(id);
      setProject(next);
      navigate("/dashboard");
    } catch (reason: unknown) {
      setJoinError(reason instanceof Error ? reason.message : "Could not open that group.");
      setOpeningId("");
    }
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    if (joining || openingId) return;
    setJoining(true);
    setJoinError("");
    try {
      const next = await api.joinGroup({ code: code.trim(), githubUsername: githubUsername.trim() });
      setProject(next);
      navigate("/dashboard");
    } catch (reason: unknown) {
      setJoinError(reason instanceof Error ? reason.message : "Could not join that group.");
      setJoining(false);
    }
  }

  // The demo has no account: it shows the demo project only, without join / create / add teammate.
  const demo = isDemoMode();

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-700">After you sign in</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your groups</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            Open a group you already belong to, join one with its invite code, or create a new one.
          </p>
        </div>
        {!demo && <button type="button" onClick={() => { setProject(null); navigate("/setup"); }} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">Create a group</button>}
      </header>

      {demo ? (
        <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
          In the demo you&apos;re in the PayLite sample group. Sign in with your own account to create groups, join one with an invite code, or add teammates.
        </p>
      ) : (
      <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold">Join a group</h2>
        <p className="mt-1 text-sm text-gray-600">Use the invite code from a teammate and the GitHub username they entered for you.</p>
        <form onSubmit={join} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-sm font-medium">Invite code
            <input required value={code} onChange={(event) => setCode(event.target.value)} className={inputClass} autoComplete="off" spellCheck={false} />
          </label>
          <label className="block text-sm font-medium">Your GitHub username
            <input required value={githubUsername} onChange={(event) => setGithubUsername(event.target.value)} className={inputClass} placeholder="octocat" autoComplete="off" spellCheck={false} />
          </label>
          <button type="submit" disabled={joining || !!openingId} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
            {joining ? "Joining…" : "Join"}
          </button>
        </form>
        {joinError && <p role="alert" className="mt-3 text-sm text-red-800">{joinError}</p>}
      </section>
      )}

      {loading ? <LoadingState message="Loading your groups…" /> : error ? <ErrorState title="Could not load your groups" onRetry={() => setAttempt((n) => n + 1)}><p>{error}</p></ErrorState> : groups.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">You are not in a group yet. Create one, or join with an invite code.</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => {
            const current = project?.id === group.id;
            return (
              <li key={group.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{group.name}</h2>
                    {current && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">Current</span>}
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{group.planActive ? "Plan active" : "Plan not active yet"} · Deadline {formatDeadline(group.deadline)}</p>
                  {group.memberName && <p className="mt-1 text-sm text-gray-600">You are {group.memberName} in this group.</p>}
                  {group.inviteCode && <p className="mt-2 text-sm text-gray-700">Invite code <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm">{group.inviteCode}</code></p>}
                </div>
                <button type="button" disabled={!!openingId || joining} onClick={() => { void openGroup(group.id); }} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                  {openingId === group.id ? "Opening…" : "Open"}
                </button>
                {!demo && <AddTeammate group={group} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Lets a member add someone who wasn't listed at setup. The new person then joins with the invite code. */
function AddTeammate({ group }: { group: GroupSummary }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const member = await api.addMember(group.id, {
        name: name.trim(),
        githubUsername: githubUsername.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      setAdded(`Added ${member.name}. Send them the invite code ${group.inviteCode} and their GitHub username (${member.githubUsername}) so they can join.`);
      setName("");
      setGithubUsername("");
      setEmail("");
      setOpen(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not add that teammate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full border-t border-gray-100 pt-3">
      {added && <p role="status" className="mb-2 text-sm text-green-800">{added}</p>}
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setAdded(""); }} className="text-sm font-semibold text-blue-700 hover:underline">+ Add teammate</button>
      ) : (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <label className="block text-sm font-medium">Name
            <input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} autoComplete="off" />
          </label>
          <label className="block text-sm font-medium">GitHub username
            <input required value={githubUsername} onChange={(event) => setGithubUsername(event.target.value)} className={inputClass} placeholder="octocat" autoComplete="off" spellCheck={false} />
          </label>
          <label className="block text-sm font-medium">Email <span className="font-normal text-gray-500">(optional)</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} autoComplete="off" />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? "Adding…" : "Add"}</button>
            <button type="button" onClick={() => { setOpen(false); setError(""); }} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
    </div>
  );
}
