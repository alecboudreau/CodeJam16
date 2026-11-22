import { useState, type FormEvent } from "react";
import { sendEmailLink, signInWithDiscord } from "../auth/supabase";
import { Enforcer } from "../components/Enforcer";
import Icon from "../components/Icon";

// Shown when sign-in is on (#62) and nobody is signed in on this device.
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"" | "discord" | "email">("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");

  async function discord() {
    setError("");
    setBusy("discord");
    try {
      await signInWithDiscord();
    } catch (e) {
      // the browser leaves for Discord here
      setError(
        e instanceof Error ? e.message : "Couldn't start Discord sign-in.",
      );
      setBusy("");
    }
  }

  async function emailLink(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy("email");
    try {
      await sendEmailLink(email.trim());
      setSentTo(email.trim());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't send the sign-in link.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="auth-page">
      <aside className="auth-story">
        <a href="/" className="brand-lockup">
          <span className="brand-symbol">
            <Icon name="check" />
          </span>
          The Enforcer
        </a>
        <div className="auth-story-content">
          <Enforcer size="large" />
          <h2>Good intentions. Better follow-through.</h2>
          <p>
            A shared plan, clear checkpoints, and a watchful friend who keeps
            the work moving. Firm, fair, and always on your team.
          </p>
        </div>
      </aside>
      <main className="auth-panel">
        <div className="auth-form">
          <Enforcer className="auth-mobile-enforcer" />
          <h1>Back to the work.</h1>
          <p className="mt-2 text-sm text-gray-600">
            Sign in to see your team's plan and your own progress.
          </p>

          <button
            type="button"
            onClick={discord}
            disabled={busy !== ""}
            className="btn btn-primary mt-6 w-full"
          >
            {busy === "discord" ? "Opening Discord…" : "Sign in with Discord"}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            Use the Discord account you ran <code>/link</code> with.
          </p>

          <div className="my-6 flex items-center gap-3 text-xs text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            or
            <span className="h-px flex-1 bg-gray-200" />
          </div>

          {sentTo ? (
            <p
              role="status"
              className="rounded-lg bg-green-50 p-4 text-sm text-green-900"
            >
              Check <strong>{sentTo}</strong> for a sign-in link. You can close
              this tab; the link signs you in.
            </p>
          ) : (
            <form onSubmit={emailLink} className="space-y-3">
              <label className="block text-sm font-medium">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <button
                type="submit"
                disabled={busy !== "" || !email.trim()}
                className="btn btn-secondary w-full"
              >
                {busy === "email" ? "Sending…" : "Email me a sign-in link"}
              </button>
              <p className="text-xs text-gray-500">
                Use the email your team added for you.
              </p>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-800">
              {error}
            </p>
          )}
          <div className="auth-footnote">
            <Icon name="shield" />
            <p>Your own progress. Your own evidence.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
