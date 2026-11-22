import type { ReactNode } from "react";
import { Enforcer } from "./Enforcer";
import Icon from "./Icon";

export function LoadingState({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="feedback-card loading-state"
      aria-live="polite"
    >
      <Enforcer />
      <div className="loading-copy">
        <p>{message}</p>
        <div className="loading-lines" aria-hidden="true">
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export function ErrorState({
  title,
  children,
  onRetry,
  retryLabel = "Try again",
}: {
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <section role="alert" className="feedback-card error-state">
      <Enforcer />
      <div>
        <h2>{title}</h2>
        <div className="mt-2 space-y-3 text-sm leading-6">{children}</div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="btn btn-secondary mt-4"
          >
            <Icon name="refresh" />
            {retryLabel}
          </button>
        )}
      </div>
    </section>
  );
}
