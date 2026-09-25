import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Box, Button, Center, Divider, Group, List, Loader, MantineProvider, Modal as MantineModal, Paper, ScrollArea, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import type { AppNotification, Change, StatusResult } from "../shared/ipc-contract";
import { theme } from "./theme";
import { RepoGroup, ChangeCard } from "./board";
import { groupWorktrees } from "../shared/grouping";
import { Modal, type ModalSection } from "./modal";
import { Sidebar, type Selection } from "./sidebar";
import { DiffPanel } from "./diffPanel";
import { SettingsPanel } from "./settings";
import notificationSoundUrl from "./assets/msn-message.mp3";
import logoUrl from "./assets/logo.png";

const REFRESH_MS = 15000;

const keyOf = (c: Change) => `${c.repoPath}\u0000${c.change}`;

// Mantine owns the colour scheme end to end; app.css keys its diff-renderer and
// markdown colour variables off Mantine's [data-mantine-color-scheme] attribute.
// The far-left workspace rail: switch between workspaces. Decorative for now —
// the app scans a single configured root — but present to match the shell.
function WorkspaceRail() {
  const workspaces = [
    { key: "os", label: "🛠️", title: "OpenSpec", active: true },
    { key: "w", label: "W", title: "Wings" },
    { key: "c", label: "C", title: "Cloud" },
    { key: "d", label: "D", title: "Devices" },
  ];
  return (
    <Box component="nav" className="ws-rail" aria-label="Workspaces">
      <Stack gap="xs" align="center" className="ws-rail-list">
        {workspaces.map((w) => (
          <div key={w.key} className={`ws-avatar${w.active ? " active" : ""}`} title={w.title} aria-label={w.title}>
            {w.label}
          </div>
        ))}
        <UnstyledButton className="ws-avatar ws-avatar-add" title="Add workspace" aria-label="Add workspace">
          +
        </UnstyledButton>
      </Stack>
    </Box>
  );
}

// specs/<capability>/spec.md → <capability>; used as the tab label when several
// spec files are shown together. Falls back to the file name for other shapes.
function capabilityOf(file: string): string {
  const m = file.match(/specs\/([^/]+)\/[^/]+$/);
  return m ? (m[1] as string) : (file.split("/").pop() ?? file);
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
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpanded());
  const [selection, setSelection] = useState<Selection>(() => readSelection());
  const [archived, setArchived] = useState<Set<string>>(() => new Set());
  const [archiving, setArchiving] = useState<Set<string>>(() => new Set());
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const [modal, setModal] = useState<{ open: boolean; title: string; sections: ModalSection[]; openInEditor?: () => void }>({
    open: false,
    title: "",
    sections: [],
  });
  const [notes, setNotes] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | {
    title: string;
    detail?: string;
    warnings: string[];
    confirmLabel: string;
    run: () => Promise<void>;
  }>(null);
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

  useEffect(() => {
    return window.electronAPI.onNotification((n) => {
      setNotes((prev) => [n, ...prev].slice(0, 100));
      setUnread((u) => u + 1);
    });
  }, []);

  const openArtifacts = useCallback(async (files: string[], repoPath: string) => {
    if (files.length === 0) return;
    const single = files.length === 1;
    const title = single ? (files[0] as string) : `${files.length} spec files`;
    const openInEditor = single
      ? () => {
          void window.electronAPI.openFile(repoPath, files[0] as string).then((res) => {
            if (!res.ok) window.alert("Could not open file: " + res.error);
          });
        }
      : undefined;
    setModal({ open: true, title, sections: [{ label: "", body: "Loading…" }], openInEditor });
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
      setModal({ open: true, title, sections, openInEditor });
    } catch {
      setModal({ open: true, title, sections: [{ label: "", body: "Could not read file." }], openInEditor });
    }
  }, []);

  const closeModal = useCallback(() => setModal((m) => ({ ...m, open: false })), []);

  const onArchive = useCallback(
    async (c: Change) => {
      const k = keyOf(c);
      if (inFlight.current.has(k)) return; // guard against a duplicate submission

      const runExecute = async (execute: () => Promise<{ ok: boolean; error?: string }>) => {
        if (inFlight.current.has(k)) return;
        inFlight.current.add(k);
        setArchiving((prev) => new Set(prev).add(k));
        const clearArchiving = () =>
          setArchiving((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
        try {
          const res = await execute();
          if (res.ok) {
            if (res.error) window.alert(res.error); // archive succeeded; teardown was partial
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
            window.alert("Archive failed: " + res.error);
            inFlight.current.delete(k);
            clearArchiving();
          }
        } catch (e) {
          window.alert("Archive failed: " + e);
          inFlight.current.delete(k);
          clearArchiving();
        }
      };

      let plan: Awaited<ReturnType<typeof window.electronAPI.archivePlan>>;
      try {
        plan = await window.electronAPI.archivePlan({ repoPath: c.repoPath, change: c.change });
      } catch (e) {
        window.alert("Archive failed: " + e);
        return;
      }

      if (plan.applies) {
        const execute = async () => {
          const r = await window.electronAPI.archiveExecute({
            repoPath: c.repoPath,
            change: c.change,
            acceptUnmerged: !plan.branchMerged,
            acceptDirty: plan.dirty,
          });
          if (!r.archived) return { ok: false, error: r.archiveError || "unknown" };
          if (r.worktreeRemoved === false) {
            return { ok: true, error: `Archived, but the worktree could not be removed: ${r.worktreeError || "unknown"}` };
          }
          if (r.branchDeleted === false) {
            return { ok: true, error: `Archived and worktree removed, but the branch was not deleted: ${r.branchError || "unknown"}` };
          }
          return { ok: true };
        };
        setConfirm({
          title: `Archive "${c.change}" and tear down its worktree?`,
          detail: "This cannot be undone.",
          warnings: plan.warnings,
          confirmLabel: "Archive and remove worktree",
          run: () => runExecute(execute),
        });
      } else if (plan.keptReason === "primary") {
        const execute = async () => {
          const d = await window.electronAPI.archive({ repoPath: c.repoPath, change: c.change });
          return d.ok ? { ok: true } : { ok: false, error: d.error || "unknown" };
        };
        setConfirm({
          title: `Archive "${c.change}"?`,
          detail: "This is the last change in this worktree, but the worktree will be kept because it is the primary checkout.",
          warnings: [],
          confirmLabel: "Archive",
          run: () => runExecute(execute),
        });
      } else {
        const execute = async () => {
          const d = await window.electronAPI.archive({ repoPath: c.repoPath, change: c.change });
          return d.ok ? { ok: true } : { ok: false, error: d.error || "unknown" };
        };
        setConfirm({
          title: `Archive "${c.change}"?`,
          detail: "This runs `openspec archive` (moves it to changes/archive/). Reversible on disk.",
          warnings: [],
          confirmLabel: "Archive",
          run: () => runExecute(execute),
        });
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

  const onDeleteWorktree = useCallback(
    (repoPath: string, branch: string | null) => {
      setConfirm({
        title: "Delete this worktree folder?",
        detail: `This permanently deletes the folder at ${repoPath}${
          branch ? ` (branch "${branch}")` : ""
        } from disk. This cannot be undone.`,
        warnings: ["Any uncommitted or unpushed work in this worktree will be lost."],
        confirmLabel: "Delete folder",
        run: async () => {
          const res = await window.electronAPI.removeWorktree({ repoPath });
          if (!res.ok) window.alert("Could not delete worktree: " + res.error);
          else {
            if (selection?.kind === "worktree" && selection.repoPath === repoPath) applySelection(null);
            void refresh();
          }
        },
      });
    },
    [applySelection, refresh, selection]
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
      ? `${changeCount} change(s) · updated ${updatedAt}`
      : "connecting…";

  let main: React.ReactNode;
  if (!status) {
    main = (
      <Center p="xl" style={{ height: "100%" }}>
        <Loader color="magenta" size="lg" />
      </Center>
    );
  } else if ("error" in status) {
    main = (
      <Center p="xl">
        <Text c="red">Error: {status.error}</Text>
      </Center>
    );
  } else if (grouped.length === 0) {
    main = (
      <Center p="xl">
        <Text c="dimmed">No active OpenSpec changes found across {repoCount} repo(s).</Text>
      </Center>
    );
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
        showToggle={false}
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
      <Stack className="worktree-detail" gap="md">
        <Stack gap="sm">
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
        </Stack>
        <DiffPanel key={selectedWorktreePath} repoPath={selectedWorktreePath} />
      </Stack>
    );
  } else {
    main = (
      <Center p="xl">
        <Text c="dimmed" ta="center" style={{ maxWidth: 420 }}>
          Select a repository to view its progress, or a worktree to view its live diff.
        </Text>
      </Center>
    );
  }

  return (
    <MantineProvider theme={theme} forceColorScheme="dark">
      <Group component="header" className="topbar" justify="space-between" wrap="nowrap" gap="md">
        <Group gap="xs" wrap="nowrap" className="topbar-brand">
          <img className="brand-logo" src={logoUrl} alt="Tentacles" width={48} height={48} />
          <Title order={1} style={{ margin: 0, fontSize: "1.2rem" }}>
            Tentacles
          </Title>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Box style={{ position: "relative" }}>
            <ActionIcon
              variant="subtle"
              color="gray"
              className="bell"
              title="Notifications"
              aria-label="Notifications"
              style={{ position: "relative", overflow: "visible" }}
              onClick={() => {
                setBellOpen((o) => !o);
                setUnread(0);
              }}
            >
              🔔
              {notes.length > 0 && (
                <Box
                  data-bell-dot
                  style={{
                    position: "absolute",
                    top: unread > 0 ? -4 : -2,
                    right: unread > 0 ? -4 : -2,
                    minWidth: unread > 0 ? 16 : 9,
                    height: unread > 0 ? 16 : 9,
                    padding: unread > 0 ? "0 4px" : 0,
                    borderRadius: 999,
                    background: "var(--mantine-color-magenta-6)",
                    color: "#fff",
                    fontSize: 10,
                    lineHeight: unread > 0 ? "16px" : "9px",
                    textAlign: "center",
                    pointerEvents: "none",
                    border: "1.5px solid var(--mantine-color-body)",
                  }}
                >
                  {unread > 0 ? (unread > 9 ? "9+" : unread) : ""}
                </Box>
              )}
            </ActionIcon>
            {bellOpen && (
              <>
                <Box
                  onClick={() => setBellOpen(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 200 }}
                  aria-hidden
                />
                <Paper
                  withBorder
                  shadow="md"
                  radius="md"
                  data-notifications-panel
                  style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, width: 340, zIndex: 201 }}
                >
                  <Group justify="space-between" px="sm" py="xs" wrap="nowrap">
                    <Text fw={700} size="sm">
                      Notifications
                    </Text>
                    {notes.length > 0 && (
                      <Button variant="subtle" size="compact-xs" color="gray" onClick={() => setNotes([])}>
                        Clear
                      </Button>
                    )}
                  </Group>
                  <Divider />
                  {notes.length === 0 ? (
                    <Text c="dimmed" size="sm" p="sm">
                      No notifications yet.
                    </Text>
                  ) : (
                    <ScrollArea.Autosize mah={360}>
                      <Stack gap={0} p="xs">
                        {notes.map((n, i) => (
                          <Box key={`${n.at}\u0000${i}`} data-notification py={6} px="xs">
                            <Text size="sm" fw={600}>
                              {n.title}
                            </Text>
                            <Text size="xs">{n.body}</Text>
                            <Text size="xs" c="dimmed">
                              {new Date(n.at).toLocaleTimeString()}
                            </Text>
                          </Box>
                        ))}
                      </Stack>
                    </ScrollArea.Autosize>
                  )}
                </Paper>
              </>
            )}
          </Box>
          <ActionIcon variant="subtle" color="gray" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
            ⚙
          </ActionIcon>
          <Group gap={8} wrap="nowrap" className="topbar-status" ml="xs">
            <Box
              component="span"
              data-stale={stale || undefined}
              title={stale ? "stale" : "live"}
              className="status-dot"
              style={{ background: stale ? "var(--mantine-color-orange-6)" : "var(--mantine-color-teal-6)" }}
            />
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              {statusText}
            </Text>
          </Group>
        </Group>
      </Group>
      <div className="app-body">
        <WorkspaceRail />
        <div className="layout" ref={layoutRef}>
          <Sidebar
            groups={grouped}
            expanded={expanded}
            selection={selection}
            width={sidebarWidth}
            onToggle={toggleRepo}
            onSelectRepo={selectRepo}
            onSelectWorktree={selectWorktree}
            onDeleteWorktree={onDeleteWorktree}
          />
          <div
            className="sb-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onMouseDown={startResize}
          />
          <main
            key={selection ? (selection.kind === "repo" ? `r:${selection.repositoryId}` : `w:${selection.repoPath}`) : "none"}
            className="panel-fade"
          >
            {main}
          </main>
        </div>
      </div>
      <Modal open={modal.open} title={modal.title} sections={modal.sections} onOpenInEditor={modal.openInEditor} onClose={closeModal} />
      <MantineModal
        opened={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        transitionProps={{ duration: 0 }}
        closeButtonProps={{ "aria-label": "Close" }}
      >
        {confirm?.detail && <Text mb="sm">{confirm.detail}</Text>}
        {confirm && confirm.warnings.length > 0 && (
          <List spacing="xs" mb="md">
            {confirm.warnings.map((w, i) => (
              <List.Item key={i}>{w}</List.Item>
            ))}
          </List>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              const pending = confirm;
              setConfirm(null);
              void pending?.run();
            }}
          >
            {confirm?.confirmLabel}
          </Button>
        </Group>
      </MantineModal>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => void refresh()} />
    </MantineProvider>
  );
}
