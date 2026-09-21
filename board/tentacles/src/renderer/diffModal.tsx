import { useEffect } from "react";
import type { DiffFile, DiffResult } from "../shared/ipc-contract";
import { DiffView } from "./diffView";

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        <div className="diff-body">
          <DiffView result={result} getFullFile={getFullFile} />
        </div>
      </div>
    </div>
  );
}
