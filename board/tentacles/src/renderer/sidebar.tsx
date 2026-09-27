import { useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Box, Button, Divider, Group, Loader, Paper, ScrollArea, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import type { AppNotification, RepositoryGroup } from "../shared/ipc-contract";
import { worktreeLeaves, worktreeStatus, worktreeDirName, type WorktreeLeaf } from "./worktrees";

// The single active navigation scope. A repository selection scopes the main
// panel to that repository's change chains; a worktree selection scopes it to
// that worktree's live branch diff.
export type Selection =
  | { kind: "repo"; repositoryId: string }
  | { kind: "worktree"; repoPath: string }
  | null;

const statusDotColor: Record<string, string> = {
  blocked: "red",
  idle: "gray",
};

function StatusIndicator({ changes }: { changes: WorktreeLeaf["changes"] }) {
  const status = worktreeStatus(changes);
  if (status === "in-progress") {
    return (
      <Box component="span" title="in progress" aria-label="in progress" data-status="in-progress" style={{ display: "inline-flex" }}>
        <Loader size={12} />
      </Box>
    );
  }
  if (status === "completed") {
    return (
      <Text component="span" c="teal" title="completed" aria-label="completed" data-status="completed">
        ✓
      </Text>
    );
  }
  return (
    <Box
      component="span"
      title={status}
      aria-label={status}
      data-status={status}
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: `var(--mantine-color-${statusDotColor[status] ?? "gray"}-6)`,
      }}
    />
  );
}

function SidebarLeaf({
  leaf,
  selected,
  onSelect,
  onDelete,
}: {
  leaf: WorktreeLeaf;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const completed = worktreeStatus(leaf.changes) === "completed";
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menuOpen) itemRef.current?.focus();
  }, [menuOpen]);
  const closeMenu = () => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <Box style={{ position: "relative" }}>
      <UnstyledButton
        data-worktree-leaf
        data-branch={leaf.branch ?? "(detached)"}
        data-completed={completed || undefined}
        aria-current={selected || undefined}
        onClick={onSelect}
        title={leaf.repoPath}
        p="xs"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRadius: 6,
          width: "100%",
          paddingRight: 28,
          opacity: completed ? 0.6 : 1,
          backgroundColor: selected ? "var(--mantine-color-grape-light)" : undefined,
        }}
      >
        <StatusIndicator changes={leaf.changes} />
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" truncate>
            {worktreeDirName(leaf.repoPath)}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {leaf.branch ?? "(detached)"}
          </Text>
        </Stack>
      </UnstyledButton>
      <ActionIcon
        ref={triggerRef}
        data-worktree-menu
        variant="subtle"
        color="gray"
        size="xs"
        title="Worktree actions"
        aria-label={`Worktree actions for ${leaf.branch ?? leaf.repoPath}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}
      >
        <span style={{ fontSize: 15, lineHeight: 1 }} aria-hidden>
          ⋯
        </span>
      </ActionIcon>
      {menuOpen && (
        <>
          <Box
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
            }}
            style={{ position: "fixed", inset: 0, zIndex: 200 }}
            aria-hidden
          />
          <Paper
            withBorder
            shadow="md"
            radius="md"
            role="menu"
            className="wt-menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                closeMenu();
              }
            }}
            style={{ position: "absolute", right: 6, top: "calc(50% + 12px)", zIndex: 201, minWidth: 168 }}
          >
            <UnstyledButton
              ref={itemRef}
              role="menuitem"
              className="wt-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
            >
              <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>🗑</span>
              Delete worktree
            </UnstyledButton>
          </Paper>
        </>
      )}
    </Box>
  );
}

function SidebarRepo({
  group,
  expanded,
  selection,
  onToggle,
  onSelectRepo,
  onSelectWorktree,
  onDeleteWorktree,
}: {
  group: RepositoryGroup;
  expanded: boolean;
  selection: Selection;
  onToggle: (repositoryId: string) => void;
  onSelectRepo: (repositoryId: string) => void;
  onSelectWorktree: (repoPath: string) => void;
  onDeleteWorktree: (repoPath: string, branch: string | null) => void;
}) {
  const leaves = worktreeLeaves(group);
  const isSelectedRepo = selection?.kind === "repo" && selection.repositoryId === group.repositoryId;
  return (
    <Box data-repo aria-current={isSelectedRepo || undefined}>
      <Group
        gap={4}
        wrap="nowrap"
        data-repo-row
        onClick={() => onSelectRepo(group.repositoryId)}
        style={{
          cursor: "pointer",
          borderRadius: 6,
          padding: "4px 6px",
          backgroundColor: isSelectedRepo ? "var(--mantine-color-grape-light)" : undefined,
        }}
      >
        <UnstyledButton
          aria-label={expanded ? "Collapse repository" : "Expand repository"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(group.repositoryId);
          }}
          c="dimmed"
        >
          {expanded ? "▼" : "▶"}
        </UnstyledButton>
        <Text aria-hidden="true">🗂️</Text>
        <Text data-repo-name fw={600} style={{ flex: 1, minWidth: 0 }} truncate>
          {group.repositoryName}
        </Text>
        <Badge size="sm" variant="light" color="gray" title={`${leaves.length} worktree(s)`}>
          {leaves.length}
        </Badge>
      </Group>
      {expanded && (
        <Stack gap={2} pl="md" pt={4}>
          {leaves.map((leaf) => (
            <SidebarLeaf
              key={leaf.repoPath}
              leaf={leaf}
              selected={selection?.kind === "worktree" && selection.repoPath === leaf.repoPath}
              onSelect={() => onSelectWorktree(leaf.repoPath)}
              onDelete={() => onDeleteWorktree(leaf.repoPath, leaf.branch ?? null)}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

export function Sidebar({
  groups,
  expanded,
  selection,
  width,
  onToggle,
  onSelectRepo,
  onSelectWorktree,
  onDeleteWorktree,
  notes,
  unread,
  bellOpen,
  onToggleBell,
  onCloseBell,
  onClearNotes,
  onOpenSettings,
}: {
  groups: RepositoryGroup[];
  expanded: Set<string>;
  selection: Selection;
  width: number;
  onToggle: (repositoryId: string) => void;
  onSelectRepo: (repositoryId: string) => void;
  onSelectWorktree: (repoPath: string) => void;
  onDeleteWorktree: (repoPath: string, branch: string | null) => void;
  notes: AppNotification[];
  unread: number;
  bellOpen: boolean;
  onToggleBell: () => void;
  onCloseBell: () => void;
  onClearNotes: () => void;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? groups.filter(
        (g) =>
          g.repositoryName.toLowerCase().includes(q) ||
          worktreeLeaves(g).some(
            (l) =>
              (l.branch ?? "").toLowerCase().includes(q) ||
              worktreeDirName(l.repoPath).toLowerCase().includes(q)
          )
      )
    : groups;
  return (
    <Box
      component="aside"
      className="sidebar"
      style={{ width, flex: "0 0 auto", display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <Box className="sidebar-head" p="sm">
        <TextInput
          size="xs"
          variant="filled"
          radius="md"
          placeholder="Search repositories…"
          leftSection={<span aria-hidden>🔍</span>}
          aria-label="Search repositories"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </Box>
      <Box className="sidebar-list" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Stack gap={4} p="xs">
          {shown.map((g) => (
            <SidebarRepo
              key={g.repositoryId}
              group={g}
              expanded={expanded.has(g.repositoryId)}
              selection={selection}
              onToggle={onToggle}
              onSelectRepo={onSelectRepo}
              onSelectWorktree={onSelectWorktree}
              onDeleteWorktree={onDeleteWorktree}
            />
          ))}
        </Stack>
      </Box>
      <SidebarFooter
        notes={notes}
        unread={unread}
        bellOpen={bellOpen}
        onToggleBell={onToggleBell}
        onCloseBell={onCloseBell}
        onClearNotes={onClearNotes}
        onOpenSettings={onOpenSettings}
      />
    </Box>
  );
}

function SidebarFooter({
  notes,
  unread,
  bellOpen,
  onToggleBell,
  onCloseBell,
  onClearNotes,
  onOpenSettings,
}: {
  notes: AppNotification[];
  unread: number;
  bellOpen: boolean;
  onToggleBell: () => void;
  onCloseBell: () => void;
  onClearNotes: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <Group className="sidebar-footer" gap="xs" wrap="nowrap" p="sm">
      <Box style={{ position: "relative" }}>
        <ActionIcon
          variant="subtle"
          color="gray"
          className="bell"
          title="Notifications"
          aria-label="Notifications"
          style={{ position: "relative", overflow: "visible" }}
          onClick={onToggleBell}
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
            <Box onClick={onCloseBell} style={{ position: "fixed", inset: 0, zIndex: 200 }} aria-hidden />
            <Paper
              withBorder
              shadow="md"
              radius="md"
              data-notifications-panel
              style={{ position: "absolute", left: 0, bottom: "100%", marginBottom: 6, width: 340, zIndex: 201 }}
            >
              <Group justify="space-between" px="sm" py="xs" wrap="nowrap">
                <Text fw={700} size="sm">
                  Notifications
                </Text>
                {notes.length > 0 && (
                  <Button variant="subtle" size="compact-xs" color="gray" onClick={onClearNotes}>
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
      <ActionIcon variant="subtle" color="gray" onClick={onOpenSettings} title="Settings" aria-label="Settings">
        ⚙
      </ActionIcon>
    </Group>
  );
}
