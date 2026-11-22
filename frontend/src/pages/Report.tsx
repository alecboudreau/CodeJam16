import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Project, Report as StatusReport } from "@enforcer/shared";
import { api } from "../api/client";
import { useProject } from "../App";
import { EmptyState } from "../components/Enforcer";

const buttonClass = "btn btn-secondary";

function safeLink(value: string): string | undefined {
  if (value.startsWith("#")) return value;
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function inline(text: string): ReactNode[] {
  return text
    .split(
      /(`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^\s)]+\))/g,
    )
    .map((part, index) => {
      if (/^`[^`\n]+`$/.test(part))
        return (
          <code key={index} className="rounded bg-gray-100 px-1 py-0.5 text-sm">
            {part.slice(1, -1)}
          </code>
        );
      if (/^(\*\*[^\n]+?\*\*|__[^\n]+?__)$/.test(part))
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (/^(\*[^*\n]+\*|_[^_\n]+_)$/.test(part))
        return <em key={index}>{part.slice(1, -1)}</em>;
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const href = safeLink(link[2]);
        return href ? (
          <a
            key={index}
            href={href}
            rel="noreferrer"
            className="text-blue-700 underline"
          >
            {link[1]}
          </a>
        ) : (
          <span key={index}>{link[1]}</span>
        );
      }
      return part;
    });
}

// The report prompt produces paragraphs, task headings, and checkpoint lists.
// Render those plus common inline formatting as React text, without raw HTML.
function MarkdownSummary({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/;
  const bullet = /^\s*([-+*]|\d+[.)])\s+(.+)$/;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }
    const key = i;
    if (/^```/.test(lines[i])) {
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={key}
          className="overflow-x-auto rounded-lg bg-gray-100 p-4 text-sm"
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const title = heading.exec(lines[i]);
    if (title) {
      const level = Math.max(2, title[1].length);
      blocks.push(
        createElement(
          `h${level}`,
          {
            key,
            className:
              level === 2 ? "text-xl font-semibold" : "text-lg font-semibold",
          },
          inline(title[2]),
        ),
      );
      i += 1;
      continue;
    }
    const first = bullet.exec(lines[i]);
    if (first) {
      const ordered = /^\d/.test(first[1]);
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = bullet.exec(lines[i]);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(<li key={i}>{inline(item[2])}</li>);
        i += 1;
      }
      blocks.push(
        ordered ? (
          <ol
            key={key}
            start={parseInt(first[1], 10)}
            className="list-decimal space-y-2 pl-6"
          >
            {items}
          </ol>
        ) : (
          <ul key={key} className="list-disc space-y-2 pl-6">
            {items}
          </ul>
        ),
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !heading.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !/^```/.test(lines[i])
    )
      paragraph.push(lines[i++]);
    blocks.push(
      <p key={key} className="whitespace-pre-line leading-7">
        {inline(paragraph.join("\n"))}
      </p>,
    );
  }
  return <>{blocks}</>;
}

export default function Report() {
  const { project } = useProject();
  if (!project)
    return (
      <div className="page-stack">
        <header className="page-heading">
          <h1>Status report</h1>
          <p>A clear picture of the work, ready to share.</p>
        </header>
        <EmptyState
          title="The story starts with a plan."
          action={{ to: "/groups", label: "Go to your groups" }}
        >
          <p>
            Once your project is set up, generate a neutral summary of tasks and
            checkpoints for the team.
          </p>
        </EmptyState>
      </div>
    );
  return <ProjectReport key={project.id} project={project} />;
}

function ProjectReport({ project }: { project: Project }) {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manualCopy, setManualCopy] = useState(false);
  const mounted = useRef(true),
    lock = useRef(false);
  const copyField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (manualCopy) {
      copyField.current?.focus();
      copyField.current?.select();
    }
  }, [manualCopy]);

  async function generate() {
    if (lock.current || copying) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setManualCopy(false);
    try {
      const value = await api.getReport(project.id);
      if (
        !value ||
        typeof value.markdown !== "string" ||
        !value.markdown.trim()
      )
        throw new Error("The server returned an empty status report.");
      if (!Number.isFinite(Date.parse(value.generatedAt)))
        throw new Error(
          "The server returned a report without a valid generation time.",
        );
      if (mounted.current) {
        setReport(value);
        setNotice("Status report generated.");
      }
    } catch (error: unknown) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "Could not generate the report. Please try again.",
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function copy() {
    if (!report || copying || busy) return;
    setCopying(true);
    setNotice("");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(report.markdown);
      if (mounted.current) {
        setManualCopy(false);
        setNotice("Markdown copied.");
      }
    } catch {
      if (mounted.current) {
        setManualCopy(true);
        setNotice(
          "Automatic copying is unavailable. Copy the selected Markdown below with ⌘C or Ctrl+C.",
        );
      }
    } finally {
      if (mounted.current) setCopying(false);
    }
  }

  function download() {
    if (!report || busy) return;
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    setNotice("");
    try {
      const slug =
        project.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60) || "project";
      url = URL.createObjectURL(
        new Blob([report.markdown], { type: "text/markdown;charset=utf-8" }),
      );
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}-status-report-${new Date(report.generatedAt).toISOString().slice(0, 10)}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      setNotice("Markdown download started.");
    } catch {
      setNotice(
        "The download could not start. Use Copy Markdown to save the report instead.",
      );
    } finally {
      anchor?.remove();
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <h1>Status report</h1>
          <p>
            Share where things stand. Clear, neutral, and focused on the work.
          </p>
        </div>
      </header>
      <section
        aria-label="Report controls"
        className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || copying}
            onClick={generate}
            className="btn btn-primary"
          >
            {busy
              ? "Generating report…"
              : report
                ? "Regenerate report"
                : "Generate status report"}
          </button>
          <button
            type="button"
            disabled={!report || busy || copying}
            onClick={copy}
            className={buttonClass}
          >
            {copying ? "Copying…" : "Copy Markdown"}
          </button>
          <button
            type="button"
            disabled={!report || busy}
            onClick={download}
            className={buttonClass}
          >
            Download Markdown
          </button>
        </div>
        <p role="status" className="mt-3 text-sm text-gray-600">
          {busy ? "Preparing the team’s status summary…" : notice}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {error}
            {report ? " Your previous report is still shown below." : ""}
          </p>
        )}
        {manualCopy && report && (
          <label className="mt-4 block text-sm font-medium">
            Markdown to copy
            <textarea
              ref={copyField}
              readOnly
              rows={8}
              value={report.markdown}
              className="mt-2 w-full rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-sm"
            />
          </label>
        )}
      </section>
      {report ? (
        <article
          aria-label="Generated status summary"
          className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 text-gray-800 sm:p-8"
        >
          <p className="border-b border-gray-100 pb-4 text-xs text-gray-500">
            Generated{" "}
            <time dateTime={report.generatedAt}>
              {new Date(report.generatedAt).toLocaleString()}
            </time>
          </p>
          <MarkdownSummary markdown={report.markdown} />
        </article>
      ) : (
        !busy && (
          <EmptyState title="Put the work into words.">
            <p>
              Generate a clear, neutral summary of the plan and checkpoints.
              Share where things stand, without comparing people.
            </p>
          </EmptyState>
        )
      )}
    </div>
  );
}
