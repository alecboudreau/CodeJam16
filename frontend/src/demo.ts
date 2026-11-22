// Demo mode (#76): /demo opens the public PayLite demo with the "Who are you?" picker and no sign-in.
// It's remembered per browser tab (sessionStorage), so a new tab opens the normal app. The presenter
// key (from /demo?key=…) is remembered per device: with it, demo check-ins also send Discord messages.
export const DEMO_PROJECT_ID = "demo-paylite";
const MODE_KEY = "enforcer:demo";
const PRESENTER_KEY = "enforcer:demoPresenterKey";

const read = (store: () => Storage, key: string): string => {
  try { return store().getItem(key) ?? ""; } catch { return ""; }
};
const write = (store: () => Storage, key: string, value: string | null): void => {
  try { if (value === null) store().removeItem(key); else store().setItem(key, value); } catch { /* storage is optional */ }
};

export const isDemoMode = (): boolean => read(() => sessionStorage, MODE_KEY) === "1";
export const presenterKey = (): string => read(() => localStorage, PRESENTER_KEY);

export function enterDemo(key?: string | null): void {
  write(() => sessionStorage, MODE_KEY, "1");
  if (key) write(() => localStorage, PRESENTER_KEY, key);
}

export function exitDemo(): void {
  write(() => sessionStorage, MODE_KEY, null);
}

export function forgetPresenterKey(): void {
  write(() => localStorage, PRESENTER_KEY, null);
}
