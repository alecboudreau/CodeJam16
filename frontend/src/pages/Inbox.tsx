import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import type { Member } from "@enforcer/shared";
import { api, type InboxData, type InboxItem, type StatusInput } from "../api/client";
import { useProject } from "../App";
import { LoadingState } from "../components/PageFeedback";

const buttonClass = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Could not refresh your Inbox.";
interface Snapshot {
  identity: string; data: InboxData | null; loading: boolean; refreshing: boolean;
  pending: boolean; unconfirmed: boolean; error: string; notice: string;
}
const initial = (identity: string): Snapshot => ({ identity, data: null, loading: !!identity, refreshing: false, pending: false, unconfirmed: false, error: "", notice: "" });
interface Session {
  identity: string; active: boolean; sending: boolean; unconfirmed: boolean;
  reading: Promise<boolean> | null; load: () => Promise<boolean>;
}
export interface InboxState extends Snapshot {
  refresh: () => void;
  respond: (input: StatusInput) => Promise<void>;
}

// One poll feeds both the nav badge and the page. Responses belong to one project/member only.
export function useInbox(projectId: string, viewerId: string): InboxState {
  const identity = projectId && viewerId ? JSON.stringify([projectId, viewerId]) : "";
  const [snapshot, setSnapshot] = useState<Snapshot>(() => initial(identity));
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    setSnapshot(initial(identity));
    if (!identity) { sessionRef.current = null; return; }
    const session: Session = { identity, active: true, sending: false, unconfirmed: false, reading: null, load: async () => false };
    sessionRef.current = session;
    session.load = () => {
      if (!session.active) return Promise.resolve(false);
      if (session.reading) return session.reading;
      setSnapshot((state) => state.identity === identity ? { ...state, refreshing: true } : state);
      session.reading = (async () => {
        try {
          const data = await api.getInbox(projectId, viewerId);
          if (!session.active) return false;
          session.unconfirmed = false;
          setSnapshot((state) => state.identity === identity ? { ...state, data, loading: false, refreshing: false, unconfirmed: false, error: "" } : state);
          return true;
        } catch (error: unknown) {
          if (session.active) setSnapshot((state) => state.identity === identity ? { ...state, loading: false, refreshing: false, error: messageOf(error) } : state);
          return false;
        } finally { session.reading = null; }
      })();
      return session.reading;
    };
    void session.load();
    const timer = setInterval(() => { if (!session.sending) void session.load(); }, 5000);
    const onFocus = () => { if (!session.sending) void session.load(); };
    window.addEventListener("focus", onFocus);
    return () => { session.active = false; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [identity, projectId, viewerId]);

  const state = snapshot.identity === identity ? snapshot : initial(identity);
  const refresh = () => {
    const session = sessionRef.current;
    if (session?.active && session.identity === identity && !session.sending) void session.load();
  };
  const respond = async (input: StatusInput) => {
    const session = sessionRef.current;
    if (!session?.active || session.identity !== identity || session.sending || session.unconfirmed || !state.data) return;
    session.sending = true;
    setSnapshot((value) => ({ ...value, pending: true, error: "", notice: "" }));
    // Finish a read started before the press before asking the server to save a response.
    await session.reading;
    if (!session.active) return;
    let submissionError = "";
    try { await api.setMemberStatus(projectId, input, viewerId); }
    catch (error: unknown) { submissionError = messageOf(error); }
    if (!session.active) return;
    session.unconfirmed = true;
    setSnapshot((value) => ({ ...value, unconfirmed: true }));
    // Reconcile even a failed POST: it may have saved before the connection was lost.
    const confirmed = await session.load();
    if (!session.active) return;
    session.sending = false;
    setSnapshot((value) => ({ ...value, pending: false,
      error: submissionError || value.error,
      notice: submissionError ? "The latest Inbox was requested to check whether your response saved." : confirmed ? "Response saved. Your Inbox is up to date." : "Your response saved. Refresh the Inbox to confirm its latest state before responding again.",
    }));
  };
  return { ...state, refresh, respond };
}

function messageDetails(item: InboxItem) {
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600"><span>{item.kind === "nudge_blocker" ? "Teammate waiting" : item.kind === "help_post" ? "Help request" : item.kind === "team_alert" ? "Team alert" : "Checkpoint reminder"}</span>
      <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></div>
    <h2 className="mt-3 font-semibold">{item.checkpoint.taskTitle}</h2>
    <p className="mt-1 text-sm text-gray-600">Checkpoint: {item.checkpoint.criteria}</p>
    <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{item.message}</p>
    {item.deliveredOnDiscord && <p className="mt-3 text-xs text-gray-600">Also sent on Discord</p>}
  </>;
}
function answeredText(item: InboxItem): string {
  const answer = item.answered!;
  if (answer.status === "blocked") return `✓ You pressed Blocked: waiting on ${answer.blockedByName || "a teammate"}. Reminders paused.`;
  if (answer.status === "on_it") return "✓ You pressed On it. Reminders paused for 2 days; the grace period is unchanged.";
  return "✓ You pressed Need help.";
}
function Reminder({ item, teammates, disabled, onRespond }: {
  item: InboxItem; teammates: Member[]; disabled: boolean; onRespond: (input: StatusInput) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [blocker, setBlocker] = useState("");
  if (item.answered) return <details className="rounded-xl border border-gray-200 bg-white p-4">
    <summary className="text-sm font-medium text-green-800">{answeredText(item)}</summary>
    <div className="mt-4 border-t border-gray-100 pt-4">{messageDetails(item)}</div>
  </details>;
  return <article aria-label={`${item.checkpoint.taskTitle}: ${item.checkpoint.criteria}`} className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
    {messageDetails(item)}
    <div className="mt-5 flex flex-wrap gap-2">
      <button type="button" disabled={disabled} className={buttonClass} onClick={() => { void onRespond({ status: "on_it" }); }}>On it</button>
      <button type="button" disabled={disabled} aria-expanded={picking} className={buttonClass} onClick={() => setPicking((value) => !value)}>Blocked ▾</button>
      <button type="button" disabled={disabled} className={buttonClass} onClick={() => { void onRespond({ status: "need_help" }); }}>Need help</button>
    </div>
    {picking && <form className="mt-4 space-y-3 rounded-lg bg-gray-50 p-4" onSubmit={(event) => { event.preventDefault(); if (blocker && teammates.some((m) => m.id === blocker)) void onRespond({ status: "blocked", blockedById: blocker }); }}>
      <label className="block text-sm font-medium">Who are you waiting on?
        <select autoFocus required value={blocker} disabled={disabled} onChange={(event) => setBlocker(event.target.value)} className="mt-2 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2">
          <option value="">Choose a teammate</option>{teammates.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </label>
      {!teammates.length && <p className="text-sm text-gray-600">There are no other teammates to select.</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={disabled || !blocker} className={buttonClass}>Save Blocked response</button><button type="button" className={buttonClass} disabled={disabled} onClick={() => setPicking(false)}>Cancel</button></div>
    </form>}
  </article>;
}

export default function Inbox({ inbox }: { inbox: InboxState }) {
  const { project, viewerId, viewerLoading } = useProject();
  const [tab, setTab] = useState<"forYou" | "team">("forYou");
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (inbox.error) errorBox.current?.focus(); }, [inbox.error]);
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : tab === "forYou" ? 1 : 0;
    setTab(next === 0 ? "forYou" : "team"); tabButtons.current[next]?.focus();
  }
  if (!project) return <div className="mx-auto max-w-5xl"><h1 className="text-3xl font-semibold">Inbox</h1><p className="mt-4">Create a project in <Link to="/setup" className="text-blue-700 underline">Setup</Link> to view reminders.</p></div>;
  if (viewerLoading) return <LoadingState message="Checking your project membership…" />;
  if (!viewerId) return <div className="mx-auto max-w-5xl"><h1 className="text-3xl font-semibold">Inbox</h1><p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Choose yourself in “Who are you?” to open your Inbox.</p></div>;
  const items = inbox.data?.[tab] ?? [];
  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-blue-700">{project.name}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Inbox</h1><p className="mt-2 text-sm text-gray-600">Your checkpoint reminders and the team’s requests for help. Updates every 5 seconds.</p></div>
      <button type="button" className={buttonClass} disabled={inbox.refreshing || inbox.pending} onClick={inbox.refresh}>Refresh Inbox</button></header>
    <div role="tablist" aria-label="Inbox views" className="flex flex-wrap gap-2">{([ ["forYou", "For you"], ["team", "Team"] ] as const).map(([value, label], index) => <button key={value} ref={(node) => { tabButtons.current[index] = node; }} role="tab" type="button" id={`inbox-tab-${value}`} aria-controls={`inbox-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onKeyDown={tabKeys} onClick={() => setTab(value)} className={`${buttonClass} ${tab === value ? "border-blue-300 bg-blue-50 text-blue-800" : "text-gray-600"}`}>{label}{value === "forYou" && inbox.data ? ` (${inbox.data.unreadCount})` : ""}</button>)}</div>
    {inbox.error && <div ref={errorBox} tabIndex={-1} role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{inbox.error}</p>{inbox.data && <p className="mt-2">Showing the last loaded messages. They may have changed.</p>}<button type="button" className={`${buttonClass} mt-3`} disabled={inbox.refreshing || inbox.pending} onClick={inbox.refresh}>Retry Inbox</button></div>}
    {(inbox.notice || inbox.pending) && <p role="status" className="text-sm text-gray-600">{inbox.pending ? "Saving response and refreshing your Inbox…" : inbox.notice}</p>}
    <section role="tabpanel" id={`inbox-panel-${tab}`} aria-labelledby={`inbox-tab-${tab}`} className="space-y-4">
      {inbox.loading ? <LoadingState message="Loading your Inbox…" /> : inbox.data && (!items.length ? <p className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">{tab === "forYou" ? "No reminders for you yet." : "No team help requests or alerts yet."}</p> : items.map((item) => tab === "team" ? <article key={item.id} className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">{messageDetails(item)}</article> : <Reminder key={item.id} item={item} teammates={project.members.filter((m) => m.id !== viewerId)} disabled={inbox.pending || inbox.unconfirmed || inbox.refreshing || !!inbox.error} onRespond={inbox.respond} />))}
    </section>
  </div>;
}
