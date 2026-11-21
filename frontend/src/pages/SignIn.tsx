import { useState, type FormEvent } from "react";
import { sendEmailLink, signInWithDiscord } from "../auth/supabase";

// Shown when sign-in is on (#62) and nobody is signed in on this device.
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"" | "discord" | "email">("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");

  async function discord() {
    setError("");
    setBusy("discord");
    try { await signInWithDiscord(); } // the browser leaves for Discord here
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't start Discord sign-in."); setBusy(""); }
  }

  async function emailLink(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy("email");
    try { await sendEmailLink(email.trim()); setSentTo(email.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't send the sign-in link."); }
    finally { setBusy(""); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 text-gray-900">
      <main className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Group Project Enforcer</h1>
        <p className="mt-2 text-sm text-gray-600">Sign in to see your team's plan and your own progress.</p>

        <button type="button" onClick={discord} disabled={busy !== ""}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4752c4] disabled:opacity-60">
          {busy === "discord" ? "Opening Discord…" : "Sign in with Discord"}
        </button>
        <p className="mt-2 text-xs text-gray-500">Use the Discord account you ran <code>/link</code> with.</p>

        <div className="my-6 flex items-center gap-3 text-xs text-gray-400"><span className="h-px flex-1 bg-gray-200" />or<span className="h-px flex-1 bg-gray-200" /></div>

        {sentTo ? (
          <p role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-900">
            Check <strong>{sentTo}</strong> for a sign-in link. You can close this tab; the link signs you in.
          </p>
        ) : (
          <form onSubmit={emailLink} className="space-y-3">
            <label className="block text-sm font-medium">Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
            </label>
            <button type="submit" disabled={busy !== "" || !email.trim()}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60">
              {busy === "email" ? "Sending…" : "Email me a sign-in link"}
            </button>
            <p className="text-xs text-gray-500">Use the email your team added for you.</p>
          </form>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
      </main>
    </div>
  );
}
