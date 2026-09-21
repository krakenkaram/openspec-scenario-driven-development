import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Change, StatusResult } from "../shared/ipc-contract";
import { RepoGroup, ChangeCard } from "./board";
import { groupWorktrees } from "../shared/grouping";
import { Modal, type ModalSection } from "./modal";
import { Sidebar, type Selection } from "./sidebar";
import { DiffPanel } from "./diffPanel";
import { SettingsPanel } from "./settings";
import notificationSoundUrl from "./assets/msn-message.mp3";

const REFRESH_MS = 15000;
type ThemeChoice = "light" | "dark" | null;

const keyOf = (c: Change) => `${c.repoPath}\u0000${c.change}`;

// specs/<capability>/spec.md → <capability>; used as the tab label when several
// spec files are shown together. Falls back to the file name for other shapes.
function capabilityOf(file: string): string {
  const m = file.match(/specs\/([^/]+)\/[^/]+$/);
  return m ? (m[1] as string) : (file.split("/").pop() ?? file);
}

function readSavedTheme(): ThemeChoice {
  const saved = localStorage.getItem("osb-theme");
  return saved === "light" || saved === "dark" ? saved : null;
}

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem("osb-expanded") || "[]") as string[]);
  } catch {
    return new Set();
  }
}

function readSelection(): Selection {
  try {
    const s = JSON.parse(localStorage.getItem("osb-selection") || "null");
    if (s && s.kind === "repo" && typeof s.repositoryId === "string") return s as Selection;
    if (s && s.kind === "worktree" && typeof s.repoPath === "string") return s as Selection;
    return null;
  } catch {
    return null;
  }
}

export default function App() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [theme, setTheme] = useState<ThemeChoice>(() => readSavedTheme());
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpanded());
  const [selection, setSelection] = useState<Selection>(() => readSelection());
  const [archived, setArchived] = useState<Set<string>>(() => new Set());
  const [archiving, setArchiving] = useState<Set<string>>(() => new Set());
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const [modal, setModal] = useState<{ open: boolean; title: string; sections: ModalSection[] }>({
    open: false,
    title: "",
    sections: [],
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const layoutRef = useRef<HTMLDivElement>(null);

  // Drag the handle on the sidebar's right edge to resize it. Bounds: min 180px
  // (below this the monospace repo/branch labels truncate uselessly) and max the
  // smaller of 480px or 40% of the window (stricter than the diff picker's 60%
  // because the main panel is the point of the app); when the layout width can't
  // be measured the max falls back to 480. Not persisted — resets each launch,
  // matching the diff file-picker's resizer.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const layout = layoutRef.current?.clientWidth ?? 0;
      const maxW = layout > 0 ? Math.min(480, Math.round(layout * 0.4)) : 480;
      setSidebarWidth(Math.max(180, Math.min(startW + (ev.clientX - startX), maxW)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useLayoutEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const effective = prev || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      const next: ThemeChoice = effective === "dark" ? "light" : "dark";
      localStorage.setItem("osb-theme", next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await window.electronAPI.getStatus();
      setStatus(data);
      setStale(false);
      setRefreshFailed(false);
      setUpdatedAt(new Date().toLocaleTimeString());
      if (!("error" in data)) {
        const present = new Set(data.changes.map(keyOf));
        setArchived((prev) => {
          const next = new Set([...prev].filter((k) => present.has(k)));
          return next.size === prev.size ? prev : next;
        });
      }
    } catch {
      setStale(true);
      setRefreshFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const audio = new Audio(notificationSoundUrl);
    return window.electronAPI.onNotificationSound(() => {
      audio.currentTime = 0;
      void audio.play().catch(() => {});
    });
  }, []);

  const openArtifacts = useCallback(async (files: string[]) => {
    if (files.length === 0) return;
    const single = files.length === 1;
    const title = single ? (files[0] as string) : `${files.length} spec files`;
    setModal({ open: true, title, sections: [{ label: "", body: "Loading…" }] });
    try {
      const sections = await Promise.all(
        files.map(async (file) => {
          let contents = "Could not read file.";
          try {
            const res = await window.electronAPI.readFile(file);
            if (res.ok) contents = res.contents;
          } catch {
            /* keep the fallback */
          }
          return { label: capabilityOf(file), body: contents };
        })
      );
      setModal({ open: true, title, sections });
    } catch {
      setModal({ open: true, title, sections: [{ label: "", body: "Could not read file." }] });
    }
  }, []);

  const closeModal = useCallback(() => setModal((m) => ({ ...m, open: false })), []);

  const onArchive = useCallback(
    async (c: Change) => {
      const k = keyOf(c);
      if (inFlight.current.has(k)) return; // guard against a duplicate submission
      const confirmed = window.confirm(
        `Archive "${c.change}"?\n\nThis runs \`openspec archive\` (moves it to changes/archive/). Reversible on disk.`
      );
      if (!confirmed) return;
      inFlight.current.add(k);
      setArchiving((prev) => new Set(prev).add(k));
      const clearArchiving = () =>
        setArchiving((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      try {
        const d = await window.electronAPI.archive({ repoPath: c.repoPath, change: c.change });
        if (d.ok) {
          clearArchiving();
          setRemoving((prev) => new Set(prev).add(k));
          setTimeout(() => {
            inFlight.current.delete(k);
            setArchived((prev) => new Set(prev).add(k));
            setRemoving((prev) => {
              const next = new Set(prev);
              next.delete(k);
              return next;
            });
            void refresh();
          }, 320);
        } else {
          window.alert("Archive failed: " + (d.error || "unknown"));
          inFlight.current.delete(k);
          clearArchiving();
        }
      } catch (e) {
        window.alert("Archive failed: " + e);
        inFlight.current.delete(k);
        clearArchiving();
      }
    },
    [refresh]
  );

  const persistExpanded = (next: Set<string>) =>
    localStorage.setItem("osb-expanded", JSON.stringify([...next]));

  const applySelection = useCallback((next: Selection) => {
    setSelection(next);
    if (next) localStorage.setItem("osb-selection", JSON.stringify(next));
    else localStorage.removeItem("osb-selection");
  }, []);

  const toggleRepo = useCallback((repositoryId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(repositoryId)) next.delete(repositoryId);
      else next.add(repositoryId);
      persistExpanded(next);
      return next;
    });
  }, []);

  const selectRepo = useCallback(
    (repositoryId: string) => {
      setExpanded((prev) => {
        if (prev.has(repositoryId)) return prev;
        const next = new Set(prev).add(repositoryId);
        persistExpanded(next);
        return next;
      });
      applySelection({ kind: "repo", repositoryId });
    },
    [applySelection]
  );

  const selectWorktree = useCallback(
    (repoPath: string) => applySelection({ kind: "worktree", repoPath }),
    [applySelection]
  );

  const grouped = useMemo(() => {
    if (!status || "error" in status) return [];
    const visible = status.changes.filter((c) => !archived.has(keyOf(c)));
    return groupWorktrees(visible);
  }, [status, archived]);

  // A persisted (or now-removed) target that no longer exists falls back to the
  // neutral empty state; clear it so the sidebar highlight and storage agree.
  const selectedGroup =
    selection?.kind === "repo" ? grouped.find((g) => g.repositoryId === selection.repositoryId) : undefined;
  const selectedWorktreePath =
    selection?.kind === "worktree" && grouped.some((g) => g.worktrees.some((c) => c.repoPath === selection.repoPath))
      ? selection.repoPath
      : undefined;

  useEffect(() => {
    if (!status || "error" in status || !selection) return;
    const exists = selection.kind === "repo" ? Boolean(selectedGroup) : Boolean(selectedWorktreePath);
    if (!exists) applySelection(null);
  }, [status, selection, selectedGroup, selectedWorktreePath, applySelection]);

  const repoCount = status && "repoCount" in status ? status.repoCount : 0;
  const changeCount = status && "changes" in status ? status.changes.length : 0;
  const statusText = refreshFailed
    ? "refresh failed — retrying"
    : status
      ? `${changeCount} change(s) · ${repoCount} repo(s) · updated ${updatedAt}`
      : "connecting…";

  let main: React.ReactNode;
  if (!status) {
    main = <div className="empty">Loading…</div>;
  } else if ("error" in status) {
    main = <div className="err">Error: {status.error}</div>;
  } else if (grouped.length === 0) {
    main = <div className="empty">No active OpenSpec changes found across {repoCount} repo(s).</div>;
  } else if (selectedGroup) {
    main = (
      <RepoGroup
        key={selectedGroup.repositoryId}
        repositoryId={selectedGroup.repositoryId}
        repositoryName={selectedGroup.repositoryName}
        nested={selectedGroup.nested}
        list={selectedGroup.worktrees}
        collapsed={false}
        onToggle={() => {}}
        openArtifacts={openArtifacts}
        onArchive={onArchive}
        archivingKeys={archiving}
        removingKeys={removing}
      />
    );
  } else if (selectedWorktreePath) {
    const worktreeChanges = grouped
      .flatMap((g) => g.worktrees)
      .filter((c) => c.repoPath === selectedWorktreePath);
    main = (
      <div className="worktree-detail">
        <div className="worktree-detail-nodes">
          {worktreeChanges.map((c) => (
            <ChangeCard
              key={keyOf(c)}
              c={c}
              showBranch={false}
              openArtifacts={openArtifacts}
              onArchive={onArchive}
              busy={archiving.has(keyOf(c))}
              removing={removing.has(keyOf(c))}
            />
          ))}
        </div>
        <DiffPanel key={selectedWorktreePath} repoPath={selectedWorktreePath} />
      </div>
    );
  } else {
    main = (
      <div className="empty select-hint">
        Select a repository to view its progress, or a worktree to view its live diff.
      </div>
    );
  }

  return (
    <>
      <header>
        <h1>🗂️ OpenSpec Board</h1>
        <div className="meta">
          <button className="settings-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            ⚙
          </button>
          <button className="theme-btn" onClick={toggleTheme} title="Toggle dark / light">
            🌓
          </button>
          <span className={`dot ${stale ? "stale" : ""}`} />
          <span>{statusText}</span>
        </div>
      </header>
      <div className="layout" ref={layoutRef}>
        <Sidebar
          groups={grouped}
          expanded={expanded}
          selection={selection}
          width={sidebarWidth}
          onToggle={toggleRepo}
          onSelectRepo={selectRepo}
          onSelectWorktree={selectWorktree}
        />
        <div
          className="sb-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={startResize}
        />
        <main>{main}</main>
      </div>
      <Modal open={modal.open} title={modal.title} sections={modal.sections} onClose={closeModal} />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => void refresh()} />
    </>
  );
}
