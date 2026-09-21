import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffFile, DiffResult } from "../shared/ipc-contract";
import { DiffView } from "./diffView";

const POLL_MS = 3000;

// The inline branch-diff panel for the selected Worktree. It polls
// getDiff(repoPath) every 3s while mounted (unmounting on deselect stops the
// poll) and degrades gracefully: a first load shows the DiffView loading state;
// a failed refresh — whether the call rejects OR resolves { ok: false }, which
// is how the main process reports operational failures — keeps the last good
// diff on screen with a "couldn't refresh" indicator that the next success
// clears. This component is keyed on repoPath by its parent so switching
// worktrees remounts it (resetting selection/expansion state); the generation
// guard additionally drops any out-of-order response.
export function DiffPanel({ repoPath }: { repoPath: string }) {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [staleRefresh, setStaleRefresh] = useState(false);
  const hasGood = useRef(false);
  const reqGen = useRef(0);

  const fetchDiff = useCallback(async () => {
    const gen = ++reqGen.current;
    let outcome: DiffResult;
    try {
      outcome = await window.electronAPI.getDiff(repoPath);
    } catch {
      outcome = { ok: false, error: "diff unavailable" };
    }
    if (gen !== reqGen.current) return; // a newer fetch superseded this one
    if (outcome.ok) {
      setResult(outcome);
      hasGood.current = true;
      setStaleRefresh(false);
    } else if (hasGood.current) {
      // Retain the last good diff; only flag the failed refresh.
      setStaleRefresh(true);
    } else {
      // First load failed — surface the error rather than an endless spinner.
      setResult(outcome);
    }
  }, [repoPath]);

  useEffect(() => {
    void fetchDiff();
    const id = setInterval(() => void fetchDiff(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchDiff]);

  const getFullFile = useCallback(
    async (filePath: string): Promise<DiffFile | null> => {
      try {
        const res = await window.electronAPI.getFileDiff(repoPath, filePath);
        if (!res.ok) return null;
        return res.files.find((f) => f.path === filePath) ?? res.files[0] ?? null;
      } catch {
        return null;
      }
    },
    [repoPath]
  );

  return (
    <div className="diff-panel">
      <div className="diff-panel-head">
        <span className="diff-panel-title">Branch diff — {repoPath.split("/").pop()}</span>
        {staleRefresh && (
          <span className="diff-stale" title="The last refresh failed; showing the previous diff.">
            couldn't refresh
          </span>
        )}
      </div>
      <div className="diff-body">
        <DiffView result={result} getFullFile={getFullFile} />
      </div>
    </div>
  );
}
