import type { ReactNode } from "react";

export function LoadingState({ message }: { message: string }) {
  return <div role="status" className="feedback-card flex items-center gap-3" aria-live="polite">
    <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700 motion-reduce:animate-none" />
    <p className="font-medium text-gray-700">{message}</p>
  </div>;
}

export function ErrorState({ title, children, onRetry, retryLabel = "Try again" }: {
  title: string; children?: ReactNode; onRetry?: () => void; retryLabel?: string;
}) {
  return <section role="alert" className="feedback-card border-red-200 bg-red-50">
    <h2 className="text-lg font-semibold text-red-900">{title}</h2>
    <div className="mt-2 space-y-3 text-sm leading-6 text-red-900">{children}</div>
    {onRetry && <button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100">{retryLabel}</button>}
  </section>;
}
