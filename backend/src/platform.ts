// Runs work after a response has been sent. On Vercel, waitUntil() keeps the function alive until
// the promise settles; on a normal Node server (local dev) the process stays up anyway.
import { waitUntil } from "@vercel/functions";

export const onVercel = Boolean(process.env.VERCEL);

export function keepAlive(promise: Promise<unknown>): void {
  const settled = promise.catch((e) => console.error("background work failed:", e));
  if (onVercel) waitUntil(settled);
}
