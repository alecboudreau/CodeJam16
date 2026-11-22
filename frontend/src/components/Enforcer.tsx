import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";

export function Enforcer({
  size = "small",
  className = "",
  decorative = false,
}: {
  size?: "small" | "large";
  className?: string;
  // The rail copy repeats on every page; screen readers hear the description once, from the page.
  decorative?: boolean;
}) {
  return (
    <img
      className={`enforcer-art ${className}`}
      src={
        size === "large" ? "/brand/enforcer.png" : "/brand/enforcer-small.png"
      }
      width="512"
      height="768"
      alt={
        decorative
          ? ""
          : "Enforcer, a muscular minotaur in a brown trench coat and tie, holding a baton"
      }
      draggable={false}
    />
  );
}

export function EnforcerNote({
  title,
  children,
  tone = "calm",
  action,
}: {
  title: string;
  children: ReactNode;
  tone?: "calm" | "attention" | "success";
  action?: { to: string; label: string };
}) {
  return (
    <section
      className={`enforcer-note enforcer-note--${tone}`}
      aria-label="A note from Enforcer"
    >
      <div className="enforcer-note-copy">
        <h2>{title}</h2>
        <div className="enforcer-note-detail">{children}</div>
        {action && (
          <Link className="text-action" to={action.to}>
            {action.label}
            <Icon name="arrow" />
          </Link>
        )}
      </div>
      <Enforcer size="large" />
    </section>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: { to: string; label: string };
}) {
  return (
    <section className="empty-state">
      <Enforcer />
      <div>
        <h2>{title}</h2>
        <div className="empty-state-detail">{children}</div>
        {action && (
          <Link className="btn btn-primary" to={action.to}>
            {action.label}
            <Icon name="arrow" />
          </Link>
        )}
      </div>
    </section>
  );
}
