import type { Change, RepositoryGroup } from "../shared/ipc-contract";

// One Worktree leaf under a Repository: a distinct git checkout (repoPath) and
// the Changes it holds. A worktree may hold more than one Change; the leaf keeps
// them all so its status can aggregate least-done-wins.
export interface WorktreeLeaf {
  repoPath: string;
  branch: string | null;
  changes: Change[];
}

export type WorktreeStatus = "completed" | "in-progress" | "blocked" | "idle";

function isActive(c: Change): boolean {
  return c.applying || c.review === "pending" || c.phases.some((p) => p.inProgress === true);
}

// Blocked means a human must act: a Change whose pull request has requested
// changes. The one signal that unambiguously waits on a person, and the same
// predicate the attention sort uses for its waiting-on-human tier.
function isBlocked(c: Change): boolean {
  return c.pr?.reviewDecision === "CHANGES_REQUESTED";
}

// Least-done-wins aggregation of a worktree's Changes into one of four states,
// in the fixed precedence blocked > in-progress > completed > idle: blocked when
// any Change waits on human review; in-progress when any Change is actively
// worked (applying, a phase in progress, or in agent review); completed only when
// every Change is complete; idle otherwise. Derived from the same phase fields the
// main-panel card chain reads (plus the PR review decision), so the indicator can
// never claim a state the card chain contradicts.
export function worktreeStatus(changes: Change[]): WorktreeStatus {
  if (changes.length === 0) return "idle";
  if (changes.some(isBlocked)) return "blocked";
  if (changes.some(isActive)) return "in-progress";
  if (changes.every((c) => c.complete)) return "completed";
  return "idle";
}

// Attention tier for ordering (lower = higher attention), read from the single
// status derivation so the indicator shown and the row's sort position can never
// contradict: 0 blocked (waiting-on-human), 1 in-progress, 2 completed, 3 idle.
export function worktreeTier(leaf: WorktreeLeaf): number {
  const status = worktreeStatus(leaf.changes);
  if (status === "blocked") return 0;
  if (status === "in-progress") return 1;
  if (status === "completed") return 2;
  return 3;
}

// The distinct Worktree leaves of a Repository group, ordered by attention tier
// (stable within a tier). The primary checkout's branch and the aggregated
// Changes are preserved per leaf.
export function worktreeLeaves(group: RepositoryGroup): WorktreeLeaf[] {
  const byPath = new Map<string, Change[]>();
  for (const c of group.worktrees) {
    const list = byPath.get(c.repoPath);
    if (list) list.push(c);
    else byPath.set(c.repoPath, [c]);
  }

  const leaves: WorktreeLeaf[] = [];
  for (const [repoPath, changes] of byPath) {
    leaves.push({
      repoPath,
      branch: changes.find((c) => c.branch)?.branch ?? null,
      changes,
    });
  }

  // Array.prototype.sort is stable, so equal tiers keep insertion order.
  return leaves.sort((a, b) => worktreeTier(a) - worktreeTier(b));
}

export function worktreeDirName(repoPath: string): string {
  return repoPath.split("/").pop() ?? repoPath;
}
