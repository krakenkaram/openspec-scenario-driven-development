import type { RepositoryGroup } from "../shared/ipc-contract";
import { worktreeLeaves, worktreeStatus, worktreeDirName, type WorktreeLeaf } from "./worktrees";

// The single active navigation scope. A repository selection scopes the main
// panel to that repository's change chains; a worktree selection scopes it to
// that worktree's live branch diff.
export type Selection =
  | { kind: "repo"; repositoryId: string }
  | { kind: "worktree"; repoPath: string }
  | null;

function StatusIndicator({ changes }: { changes: WorktreeLeaf["changes"] }) {
  const status = worktreeStatus(changes);
  if (status === "in-progress") {
    return <span className="spinner sb-status" title="in progress" />;
  }
  if (status === "completed") {
    return (
      <span className="sb-tick sb-status" title="completed" aria-label="completed">
        ✓
      </span>
    );
  }
  return <span className={`sb-dot ${status}`} title={status} />;
}

function SidebarLeaf({
  leaf,
  selected,
  onSelect,
}: {
  leaf: WorktreeLeaf;
  selected: boolean;
  onSelect: () => void;
}) {
  const completed = worktreeStatus(leaf.changes) === "completed";
  return (
    <button
      className={`sb-leaf ${selected ? "selected" : ""} ${completed ? "completed" : ""}`}
      onClick={onSelect}
      title={leaf.repoPath}
    >
      <StatusIndicator changes={leaf.changes} />
      <span className="sb-leaf-main">
        <span className="sb-leaf-title">{leaf.branch ?? "(detached)"}</span>
        <span className="sb-leaf-sub">{worktreeDirName(leaf.repoPath)}</span>
      </span>
      <span className="sb-diff-glyph" aria-hidden="true">
        ±
      </span>
    </button>
  );
}

function SidebarRepo({
  group,
  expanded,
  selection,
  onToggle,
  onSelectRepo,
  onSelectWorktree,
}: {
  group: RepositoryGroup;
  expanded: boolean;
  selection: Selection;
  onToggle: (repositoryId: string) => void;
  onSelectRepo: (repositoryId: string) => void;
  onSelectWorktree: (repoPath: string) => void;
}) {
  const leaves = worktreeLeaves(group);
  const isSelectedRepo = selection?.kind === "repo" && selection.repositoryId === group.repositoryId;
  const hasSelectedLeaf =
    selection?.kind === "worktree" && leaves.some((l) => l.repoPath === selection.repoPath);
  return (
    <div className={`sb-repo ${isSelectedRepo ? "selected" : ""} ${hasSelectedLeaf ? "active-ancestor" : ""}`}>
      <div className="sb-repo-row" onClick={() => onSelectRepo(group.repositoryId)}>
        <button
          className="sb-chevron"
          aria-label={expanded ? "Collapse repository" : "Expand repository"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(group.repositoryId);
          }}
        >
          {expanded ? "▼" : "▶"}
        </button>
        <span className="sb-repo-icon" aria-hidden="true">
          🗂️
        </span>
        <span className="sb-repo-name">{group.repositoryName}</span>
        <span className="sb-count" title={`${leaves.length} worktree(s)`}>
          {leaves.length}
        </span>
      </div>
      {expanded && (
        <div className="sb-leaves">
          {leaves.map((leaf) => (
            <SidebarLeaf
              key={leaf.repoPath}
              leaf={leaf}
              selected={selection?.kind === "worktree" && selection.repoPath === leaf.repoPath}
              onSelect={() => onSelectWorktree(leaf.repoPath)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  groups,
  expanded,
  selection,
  onToggle,
  onSelectRepo,
  onSelectWorktree,
}: {
  groups: RepositoryGroup[];
  expanded: Set<string>;
  selection: Selection;
  onToggle: (repositoryId: string) => void;
  onSelectRepo: (repositoryId: string) => void;
  onSelectWorktree: (repoPath: string) => void;
}) {
  return (
    <aside className="sidebar">
      {groups.map((g) => (
        <SidebarRepo
          key={g.repositoryId}
          group={g}
          expanded={expanded.has(g.repositoryId)}
          selection={selection}
          onToggle={onToggle}
          onSelectRepo={onSelectRepo}
          onSelectWorktree={onSelectWorktree}
        />
      ))}
    </aside>
  );
}
