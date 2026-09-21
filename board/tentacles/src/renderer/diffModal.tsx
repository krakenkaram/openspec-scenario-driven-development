import { useEffect, useState } from "react";
import type { DiffFile, DiffResult } from "../shared/ipc-contract";
import { highlightLine, languageForPath } from "./highlight";

function FileLines({ file }: { file: DiffFile }) {
  const language = languageForPath(file.path);
  return (
    <>
      {file.hunks.map((h, hi) => (
        <div className="diff-hunk" key={hi}>
          {h.lines.map((l, li) => {
            const html = highlightLine(l.text, language);
            return (
              <div className={`diff-line ${l.kind}`} key={li}>
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
  sel,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  sel: number;
  onSelect: (index: number) => void;
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
        return (
          <div className="diff-tree-branch" key={`d\u0000${label}`}>
            <div className="diff-tree-dir" style={{ paddingLeft: depth * 12 + 8 }} title={label}>
              {label}/
            </div>
            <DirLevel node={current} depth={depth + 1} sel={sel} onSelect={onSelect} />
          </div>
        );
      })}
      {files.map(({ file, index }) => (
        <button
          key={`${file.path}\u0000${index}`}
          className={`diff-file-item ${index === sel ? "active" : ""}`}
          style={{ paddingLeft: depth * 12 + 8 }}
          onClick={() => onSelect(index)}
          title={file.path}
        >
          <span className={`diff-status ${file.status}`}>{file.status}</span>
          <span className="diff-file-name">{baseName(file.path)}</span>
        </button>
      ))}
    </>
  );
}

export function DiffModal({
  open,
  title,
  result,
  onClose,
  getFullFile,
}: {
  open: boolean;
  title: string;
  result: DiffResult | null;
  onClose: () => void;
  getFullFile: (filePath: string) => Promise<DiffFile | null>;
}) {
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fullByPath, setFullByPath] = useState<Record<string, DiffFile>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const files = result && result.ok ? result.files : [];
  const sel = files.length ? Math.min(selected, files.length - 1) : 0;
  const current = files[sel];

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

  let body: React.ReactNode;
  if (result === null) {
    body = <div className="diff-empty">Loading…</div>;
  } else if (!result.ok) {
    body = <div className="diff-empty">Could not load diff: {result.error}</div>;
  } else if (files.length === 0) {
    body = <div className="diff-empty">No changes on this branch yet.</div>;
  } else {
    const isExpanded = current ? expanded.has(current.path) : false;
    const shown = current && isExpanded && fullByPath[current.path] ? fullByPath[current.path] : current;
    body = (
      <div className="diff-layout">
        <nav className="diff-sidebar">
          <DirLevel node={buildTree(files)} depth={0} sel={sel} onSelect={setSelected} />
        </nav>
        <div className="diff-pane">
          {current && (
            <div className="diff-file-head">
              <span className={`diff-status ${current.status}`}>{current.status}</span>
              <span className="diff-path">{current.path}</span>
              <button className="diff-expand" onClick={() => void toggleExpand(current.path)}>
                {isExpanded ? "Collapse" : "Expand full file"}
              </button>
            </div>
          )}
          {shown && <FileLines file={shown} />}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`diff-overlay ${open ? "open" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("diff-overlay")) onClose();
      }}
    >
      <div className="diff-modal">
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="modal-x" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="diff-body">{body}</div>
      </div>
    </div>
  );
}
