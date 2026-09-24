import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Group, Modal as MantineModal, Text } from "@mantine/core";
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
  const [overlayOpen, setOverlayOpen] = useState(false);
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

  const openFileExternally = useCallback(
    async (rel: string) => {
      try {
        const res = await window.electronAPI.openFile(repoPath, rel);
        if (!res.ok) window.alert("Could not open file: " + res.error);
      } catch {
        window.alert("Could not open file.");
      }
    },
    [repoPath]
  );

  const label = repoPath.split("/").pop();
  const fileCount = result && result.ok ? result.files.length : 0;

  return (
    <div className="diff-panel">
      <Group className="diff-panel-head" gap="sm" justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text aria-hidden>⎇</Text>
          <Text className="diff-panel-title" fw={600}>
            Branch diff — {label}
          </Text>
          {staleRefresh && (
            <Text className="diff-stale" c="orange" size="sm" title="The last refresh failed; showing the previous diff.">
              couldn't refresh
            </Text>
          )}
        </Group>
        <Group gap={4} wrap="nowrap" className="diff-tabs">
          <span className="diff-tab active">Changes</span>
          <span className="diff-tab">
            Files <b>{fileCount}</b>
          </span>
          <span className="diff-tab">Checks</span>
          <span className="diff-tab">Insights</span>
          <Button
            variant="light"
            color="magenta"
            size="compact-sm"
            onClick={() => setOverlayOpen(true)}
            rightSection={<span aria-hidden>▾</span>}
          >
            Review
          </Button>
        </Group>
      </Group>
      <div className="diff-body">
        <DiffView result={result} getFullFile={getFullFile} onOpenFile={openFileExternally} />
      </div>
      <div className="ai-review">
        <Group gap="xs" wrap="nowrap">
          <Text aria-hidden>✨</Text>
          <Text fw={600} size="sm">
            AI Review Summary
          </Text>
          <Badge size="xs" variant="light" color="magenta">
            BETA
          </Badge>
          <Group gap={6} ml="auto" wrap="nowrap">
            <Badge variant="light" color="yellow" size="sm">
              improvements
            </Badge>
            <Badge variant="light" color="teal" size="sm">
              no issues
            </Badge>
            <Badge variant="light" color="green" size="sm">
              ready to review
            </Badge>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mt={4}>
          The automated review summary appears here once a review has run on this branch.
        </Text>
      </div>
      <MantineModal
        opened={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        title={`Branch diff — ${label}`}
        fullScreen
        transitionProps={{ duration: 0 }}
        closeButtonProps={{ "aria-label": "Close" }}
      >
        <div data-diff-overlay style={{ height: "82vh", display: "flex" }}>
          <DiffView result={result} getFullFile={getFullFile} onOpenFile={openFileExternally} />
        </div>
      </MantineModal>
    </div>
  );
}
