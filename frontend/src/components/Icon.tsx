export type IconName =
  | "dashboard"
  | "plan"
  | "inbox"
  | "trace"
  | "report"
  | "setup"
  | "arrow"
  | "check"
  | "refresh"
  | "chevron"
  | "menu"
  | "close"
  | "clock"
  | "shield"
  | "help"
  | "work"
  | "info";

const paths: Record<IconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  plan: (
    <>
      <path d="M9 5H5v16h14V5h-4" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="m8 12 1 1 2-2m2 2h3m-8 4h8" />
    </>
  ),
  inbox: (
    <>
      <path d="m4 4-2 11v5h20v-5L20 4Z" />
      <path d="M2 15h6l2 3h4l2-3h6" />
    </>
  ),
  trace: (
    <>
      <path d="M5 4v16m0-11h9m-9 7h13" />
      <circle cx="17" cy="9" r="3" />
      <circle cx="20" cy="16" r="2" />
    </>
  ),
  report: (
    <>
      <path d="M14 3H5v18h14V8Z" />
      <path d="M14 3v5h5M8 12h8m-8 4h6" />
    </>
  ),
  setup: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" fill="currentColor" />
      <circle cx="15" cy="17" r="3" fill="currentColor" />
    </>
  ),
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  refresh: (
    <>
      <path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  work: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4V3h8v1M8 12h8M8 16h5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 8h.01" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01" />
    </>
  ),
};

export default function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`ui-icon ${className}`}
    >
      {paths[name]}
    </svg>
  );
}
