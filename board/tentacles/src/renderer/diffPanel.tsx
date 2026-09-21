import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffFile, DiffResult } from "../shared/ipc-contract";
import { DiffView } from "./diffView";

const POLL_MS = 3000;

// The inline branch-diff panel for the selected Worktree. It polls
// getDiff(repoPath) every 3s while mounted (unmounting on deselect stops the
// poll) and degrades gracefully: a first load shows the DiffView loading state;
// a failed refresh keeps the last successfully-rendered diff on screen with a
// small "couldn't refresh" indicator that the next success clears.
export function DiffPanel({ repoPath }: { repoPath: string }) {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [staleRefresh, setStaleRefresh] = useState(false);
  const hasGood = useRef(false);

  const fetchDiff = useCallback(async () => {
    try {
      const r = await window.electronAPI.getDiff(repoPath);
      setResult(r);
      hasGood.current = r.ok;
      setStaleRefresh(false);
    } catch {
      // Keep the last good diff on screen; only surface a first-load failure.
      if (hasGood.current) setStaleRefresh(true);
      else setResult({ ok: false, error: "diff unavailable" });
    }
  }, [repoPath]);

  useEffect(() => {
    setResult(null);
    setStaleRefresh(false);
    hasGood.current = false;
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
