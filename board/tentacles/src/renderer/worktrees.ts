import type { Change, RepositoryGroup } from "../shared/ipc-contract";

// One Worktree leaf under a Repository: a distinct git checkout (repoPath) and
// the Changes it holds. A worktree may hold more than one Change; the leaf keeps
// them all so its status can aggregate least-done-wins.
export interface WorktreeLeaf {
  repoPath: string;
  branch: string | null;
  isPrimary: boolean;
  changes: Change[];
}

export type WorktreeStatus = "done" | "in-progress" | "idle";

function isActive(c: Change): boolean {
  return c.applying || c.review === "pending" || c.phases.some((p) => p.inProgress === true);
}

// Least-done-wins aggregation of a worktree's Changes: done only when every
// Change is complete; in-progress when any Change is actively worked (applying,
// a phase in progress, or in agent review); idle otherwise. Derived from the same
// phase fields the main-panel card chain reads, so the indicator can never claim
// "done" while any Change is unfinished.
export function worktreeStatus(changes: Change[]): WorktreeStatus {
  if (changes.length === 0) return "idle";
  if (changes.every((c) => c.complete)) return "done";
  if (changes.some(isActive)) return "in-progress";
  return "idle";
}

// Attention tier for ordering (lower = higher attention): 0 waiting-on-human,
// 1 agent-active, 2 done, 3 idle. Waiting-on-human is keyed on a pull request
// requesting changes — the one field that unambiguously means a person must act.
export function worktreeTier(leaf: WorktreeLeaf): number {
  if (leaf.changes.some((c) => c.pr?.reviewDecision === "CHANGES_REQUESTED")) return 0;
  const status = worktreeStatus(leaf.changes);
  if (status === "in-progress") return 1;
  if (status === "done") return 2;
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
      isPrimary: changes.some((c) => c.isPrimary),
      changes,
    });
  }

  // Array.prototype.sort is stable, so equal tiers keep insertion order.
  return leaves.sort((a, b) => worktreeTier(a) - worktreeTier(b));
}

export function worktreeDirName(repoPath: string): string {
  return repoPath.split("/").pop() ?? repoPath;
}
