import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Center, Loader, Text, TextInput } from "@mantine/core";
import type { DiffFile, DiffResult } from "../shared/ipc-contract";
import { highlightLine, languageForPath } from "./highlight";

function FileLines({ file }: { file: DiffFile }) {
  const language = languageForPath(file.path);
  return (
    <>
      {file.hunks.map((h, hi) => (
        <div className="diff-hunk" key={hi}>
          {hi > 0 && h.oldStart !== undefined && (
            <div className="diff-line diff-hunk-header" key="header">
              <span className="diff-gutter diff-gutter-old" style={{ userSelect: "none" }} />
              <span className="diff-gutter diff-gutter-new" style={{ userSelect: "none" }} />
              <span className="diff-sign" />
              <span className="diff-text">{`@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`}</span>
            </div>
          )}
          {h.lines.map((l, li) => {
            const html = highlightLine(l.text, language);
            return (
              <div className={`diff-line ${l.kind}`} key={li}>
                <span className="diff-gutter diff-gutter-old" style={{ userSelect: "none" }}>{l.oldNo ?? ""}</span>
                <span className="diff-gutter diff-gutter-new" style={{ userSelect: "none" }}>{l.newNo ?? ""}</span>
                <span className="diff-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
                {html !== null ? (
                  <span className="diff-text hljs" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <span className="diff-text">{l.text}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

interface FileEntry {
  file: DiffFile;
  index: number;
}
interface DirNode {
  dirs: Map<string, DirNode>;
  files: FileEntry[];
}

function buildTree(files: DiffFile[]): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  files.forEach((file, index) => {
    const parts = file.path.split("/");
    parts.pop();
    let node = root;
    for (const dir of parts) {
      let child = node.dirs.get(dir);
      if (!child) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(dir, child);
      }
      node = child;
    }
    node.files.push({ file, index });
  });
  return root;
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function DirLevel({
  node,
  depth,
  parentPath,
  collapsed,
  onToggleDir,
  filtering,
  selectedPath,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  parentPath: string;
  collapsed: Set<string>;
  onToggleDir: (path: string) => void;
  filtering: boolean;
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
}) {
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b));
  const files = [...node.files].sort((a, b) => baseName(a.file.path).localeCompare(baseName(b.file.path)));
  return (
    <>
      {dirs.map(([name, child]) => {
        // Collapse single-child directory chains into one row (a/b/c) so a long
        // unique path does not waste a nesting level per segment.
        let label = name;
        let current = child;
        while (current.files.length === 0 && current.dirs.size === 1) {
          const [childName, grandChild] = [...current.dirs.entries()][0] as [string, DirNode];
          label += "/" + childName;
          current = grandChild;
        }
        const dirPath = parentPath ? `${parentPath}/${label}` : label;
        const isCollapsed = !filtering && collapsed.has(dirPath);
        return (
          <div className="diff-tree-branch" key={`d\u0000${label}`}>
            <button
              type="button"
              className="diff-tree-dir-row"
              style={{ paddingLeft: depth * 12 + 8 }}
              aria-expanded={!isCollapsed}
              onClick={() => onToggleDir(dirPath)}
            >
              <span className="diff-tree-caret" aria-hidden>{isCollapsed ? "\u25B8" : "\u25BE"}</span>
              <span className="diff-tree-dir" title={label}>{label}/</span>
            </button>
            {!isCollapsed && (
              <DirLevel
                node={current}
                depth={depth + 1}
                parentPath={dirPath}
                collapsed={collapsed}
                onToggleDir={onToggleDir}
                filtering={filtering}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
      {files.map(({ file, index }) => (
        <button
          key={`${file.path}\u0000${index}`}
          className={`diff-file-item ${file.path === selectedPath ? "active" : ""}`}
          style={{ paddingLeft: depth * 12 + 8 }}
          onClick={() => onSelect(file.path)}
          title={file.path}
        >
          <span className={`diff-status diff-status-abbr ${file.status}`} title={file.status}>
            {file.status.charAt(0)}
          </span>
          <span className="diff-file-name">{baseName(file.path)}</span>
        </button>
      ))}
    </>
  );
}

// The structured branch-diff renderer: a hierarchical file tree beside a single
// file's hunks, with syntax highlighting and on-demand full-file expansion. It
// paints a DiffResult and holds only view state (selected file, expanded set,
// fetched full files); it does no I/O beyond the injected getFullFile. Shared by
// the modal overlay and the inline worktree panel so both render diffs
// identically.
export function DiffView({
  result,
  getFullFile,
  onOpenFile,
}: {
  result: DiffResult | null;
  getFullFile: (filePath: string) => Promise<DiffFile | null>;
  onOpenFile?: (filePath: string) => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fullByPath, setFullByPath] = useState<Record<string, DiffFile>>({});
  const [treeWidth, setTreeWidth] = useState(240);
  const [filter, setFilter] = useState("");
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const layoutRef = useRef<HTMLDivElement>(null);

  const toggleDir = (path: string) =>
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Drag the handle between the file tree and the diff pane to resize the tree.
  // Bounds: min 160px (never collapse) and max ~60% of the panel (never squeeze
  // the diff away); when the panel width can't be measured the max is unbounded.
  // Not persisted — resets to the default each launch.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeWidth;
    const onMove = (ev: MouseEvent) => {
      const panel = layoutRef.current?.clientWidth ?? 0;
      const maxW = panel > 0 ? Math.round(panel * 0.6) : Number.POSITIVE_INFINITY;
      setTreeWidth(Math.max(160, Math.min(startW + (ev.clientX - startX), maxW)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // When the live diff refreshes (the inline panel re-polls every 3s), re-fetch
  // the full contents of any expanded file so the expanded view stays live rather
  // than showing a stale snapshot. A refresh that comes back empty/failed (null)
  // DROPS the cached full file so `shown` falls back to the current hunk view
  // rather than displaying stale content indefinitely — and a full fetch that was
  // missed on the first expand is retried on the next refresh.
  useEffect(() => {
    if (!result || !result.ok) return;
    const present = new Set(result.files.map((f) => f.path));
    let cancelled = false;
    for (const path of expanded) {
      if (!present.has(path)) continue;
      void getFullFile(path).then((full) => {
        if (cancelled) return;
        setFullByPath((prev) => {
          if (full) return { ...prev, [path]: full };
          if (!(path in prev)) return prev;
          const next = { ...prev };
          delete next[path];
          return next;
        });
      });
    }
    return () => {
      cancelled = true;
    };
    // Intentionally keyed on the diff result: refresh expanded files per poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const files = result && result.ok ? result.files : [];
  const query = filter.trim().toLowerCase();
  const filteredFiles = query ? files.filter((f) => f.path.toLowerCase().includes(query)) : files;
  // Electron structured-clones each IPC response, so `files` is a new array every
  // 3s poll. Key the memo on the tree-relevant data (ordered path+status) instead,
  // so the tree only rebuilds when the file set, a status, or the filter actually
  // changes — not on every poll. The expanded-file refresh effect above still
  // keys on `result`.
  const treeKey = filteredFiles.map((f) => `${f.path}\u0000${f.status}`).join("\u0001");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildTree(filteredFiles), [treeKey]);
  // Selection is keyed by path, not array index, so a live poll that adds or
  // removes OTHER files never shifts which file is shown — the open file stays
  // open until it is itself removed (then it falls back to the first file).
  const current = files.find((f) => f.path === selectedPath) ?? files[0];
  const currentPath = current?.path;

  const toggleExpand = async (path: string) => {
    if (expanded.has(path)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }
    if (!fullByPath[path]) {
      const full = await getFullFile(path);
      if (full) setFullByPath((prev) => ({ ...prev, [path]: full }));
    }
    setExpanded((prev) => new Set(prev).add(path));
  };

  if (result === null) {
    return (
      <Center className="diff-empty" style={{ flex: 1 }} p="md">
        <Loader color="magenta" aria-label="Loading diff" />
      </Center>
    );
  }
  if (!result.ok) {
    return <Text className="diff-empty" c="red" p="md">Could not load diff: {result.error}</Text>;
  }
  if (files.length === 0) {
    return <Text className="diff-empty" c="dimmed" p="md">No changes on this branch yet.</Text>;
  }

  const isExpanded = current ? expanded.has(current.path) : false;
  const shown = current && isExpanded && fullByPath[current.path] ? fullByPath[current.path] : current;
  return (
    <div className="diff-layout" ref={layoutRef}>
      <nav className="diff-sidebar" style={{ width: treeWidth, flex: "0 0 auto" }}>
        <TextInput
          className="diff-file-search"
          size="xs"
          placeholder="Search files…"
          aria-label="Search files"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          leftSection={<span aria-hidden>🔍</span>}
        />
        <div className="diff-tree-scroll">
          <DirLevel
            node={tree}
            depth={0}
            parentPath=""
            collapsed={collapsedDirs}
            onToggleDir={toggleDir}
            filtering={query.length > 0}
            selectedPath={currentPath}
            onSelect={setSelectedPath}
          />
        </div>
      </nav>
      <div
        className="diff-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file list"
        onMouseDown={startResize}
      />
      <div className="diff-pane">
        {current && (
          <div className="diff-file-head">
            <span className={`diff-status ${current.status}`}>{current.status}</span>
            {onOpenFile ? (
              <Button
                className="diff-path diff-path-btn"
                variant="subtle"
                size="compact-xs"
                title={`Open ${current.path} in your editor`}
                onClick={() => onOpenFile(current.path)}
              >
                {current.path}
              </Button>
            ) : (
              <span className="diff-path">{current.path}</span>
            )}
            <Button className="diff-expand" variant="default" size="compact-xs" style={{ marginLeft: "auto", flex: "0 0 auto" }} onClick={() => void toggleExpand(current.path)}>
              {isExpanded ? "Collapse" : "Expand full file"}
            </Button>
          </div>
        )}
        {shown && <FileLines file={shown} />}
      </div>
    </div>
  );
}
