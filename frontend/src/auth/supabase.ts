// Supabase Auth in the browser (#62). Sign-in only: data still goes through our own API, which
// verifies the token and decides which member you are.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** The current access token, refreshed by supabase-js when needed. */
export async function accessToken(): Promise<string | undefined> {
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

const returnTo = () => window.location.origin + window.location.pathname;

export async function signInWithDiscord(): Promise<void> {
  if (!supabase) throw new Error("Sign-in isn't configured (VITE_SUPABASE_URL).");
  const { error } = await supabase.auth.signInWithOAuth({ provider: "discord", options: { redirectTo: returnTo() } });
  if (error) throw error;
}

export async function sendEmailLink(email: string): Promise<void> {
  if (!supabase) throw new Error("Sign-in isn't configured (VITE_SUPABASE_URL).");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: returnTo() } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
