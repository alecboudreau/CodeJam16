import { useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type GroupSummary } from "../api/client";
import { useProject } from "../App";
import Icon from "./Icon";

export default function GroupSwitcher() {
  const { project, setProject, projectLoading } = useProject();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 240, maxHeight: 320 });
  const options = project && !groups.some((group) => group.id === project.id)
    ? [{ id: project.id, name: project.name, planActive: project.planActive, contractJoinPending: false }, ...groups]
    : groups;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  function toggle() {
    if (open) { close(); return; }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
    const top = rect.bottom + 8;
    setPosition({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width, maxHeight: Math.min(360, window.innerHeight - top - 12) });
    setOpen(true);
  }

  useEffect(() => { setOpen(false); }, [pathname, project?.id]);
  useLayoutEffect(() => {
    if (!open) return;
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    (selected ?? menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'))?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const reposition = () => close();
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? [])];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    let next = -1;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== " ") {
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find(item => item.dataset.name?.toLowerCase().startsWith(event.key.toLowerCase()));
      if (match) { event.preventDefault(); match.focus(); }
    } else if (next >= 0 && items.length) { event.preventDefault(); items[next]?.focus(); }
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    async function refresh() {
      const current = ++request;
      try {
        const next = await api.listGroups();
        if (!cancelled && current === request) {
          setGroups(next);
          setError("");
        }
      } catch {
        if (!cancelled && current === request) setError("Couldn’t load your groups.");
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); };
  }, [project?.id, pathname, attempt]);

  async function switchGroup(id: string) {
    close(true);
    if (id === project?.id || switching) return;
    setSwitching(true);
    setError("");
    try {
      const next = await api.getProject(id);
      if (!mounted.current) return;
      setProject(next);
      // Start in the selected group's dashboard rather than leaving an old group's editor open.
      navigate("/dashboard");
    } catch {
      if (mounted.current) setError("Couldn’t switch groups. Try again.");
    } finally {
      if (mounted.current) setSwitching(false);
    }
  }

  return (
    <>
      <div className="rail-project" aria-busy={switching}>
        <button
          ref={trigger}
          type="button"
          className="group-switch-trigger"
          aria-label={`Switch group, ${project?.name ?? "choose a group"}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={switching || projectLoading}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); close(true); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) toggle();
            }
          }}
        >
          <span className="project-monogram" aria-hidden="true">{(project?.name ?? "Groups").slice(0, 1)}</span>
          <span className="rail-project-copy">
            <strong>{project?.name ?? "Choose a group"}</strong>
            <span role="status">
              {switching ? "Switching group…" : project
                ? `${project.members.length} teammates · ${project.planActive ? "Active" : "In review"}`
                : "Choose your workspace"}
            </span>
          </span>
          <Icon name="chevron" />
        </button>
      </div>
      {open && createPortal(
        <div ref={menu} id={menuId} className="group-switch-menu" role="menu" aria-label="Your groups" style={position} onKeyDown={menuKeys}>
          <p className="group-switch-heading" role="presentation">Your groups</p>
          {options.length === 0 && <p className="group-switch-empty" role="presentation">No groups yet. Join or create one from Groups.</p>}
          {options.map((group) => (
            <button key={group.id} type="button" role="menuitemradio" aria-checked={group.id === project?.id}
              data-name={group.name} disabled={group.contractJoinPending} tabIndex={-1}
              className="group-switch-option" onClick={() => { void switchGroup(group.id); }}>
              <span className="group-switch-monogram" aria-hidden="true">{group.name.slice(0, 1)}</span>
              <span className="group-switch-label"><strong>{group.name}</strong><span>{group.contractJoinPending ? "Join from Groups" : group.planActive ? "Active contract" : "In review"}</span></span>
              {group.id === project?.id && <Icon name="check" />}
            </button>
          ))}
        </div>, document.body,
      )}
      {error && (
        <p className="rail-switch-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Reload groups</button>
        </p>
      )}
    </>
  );
}
