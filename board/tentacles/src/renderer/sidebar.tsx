import { ActionIcon, Badge, Box, Group, Loader, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import type { RepositoryGroup } from "../shared/ipc-contract";
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
        data-worktree-delete
        variant="subtle"
        color="red"
        size="xs"
        title="Delete this worktree folder"
        aria-label={`Delete worktree ${leaf.branch ?? leaf.repoPath}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}
      >
        <span style={{ fontSize: 11, lineHeight: 1 }} aria-hidden>
          🗑
        </span>
      </ActionIcon>
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
}: {
  groups: RepositoryGroup[];
  expanded: Set<string>;
  selection: Selection;
  width: number;
  onToggle: (repositoryId: string) => void;
  onSelectRepo: (repositoryId: string) => void;
  onSelectWorktree: (repoPath: string) => void;
  onDeleteWorktree: (repoPath: string, branch: string | null) => void;
}) {
  return (
    <Box component="aside" className="sidebar" style={{ width, flex: "0 0 auto", overflowY: "auto" }}>
      <Box className="sidebar-head" p="sm">
        <TextInput
          size="xs"
          variant="filled"
          radius="md"
          placeholder="Search repositories…"
          leftSection={<span aria-hidden>🔍</span>}
          aria-label="Search repositories"
        />
      </Box>
      <Stack gap={4} p="xs">
        {groups.map((g) => (
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
  );
}
