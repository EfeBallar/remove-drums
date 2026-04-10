import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Drum } from "lucide-react";
import { fetchFiles, startProcessing } from "./api";
import type {
  AudioItem,
  FolderItem,
  LogEntry,
  SongItem,
  TreeItem,
} from "./types";
import FileTree from "./components/FileTree";
import LogPanel from "./components/LogPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEligibleItem(item: AudioItem | SongItem): boolean {
  if (item.type === "audio") return true;
  if (item.type === "song")
    return item.status === "partial" || item.status === "done";
  return false;
}

let logIdCounter = 0;
function makeLog(
  type: LogEntry["type"],
  message: string,
  file?: string,
): LogEntry {
  return { id: ++logIdCounter, type, message, file, timestamp: new Date() };
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [items, setItems] = useState<TreeItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(
    new Set(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Load files ──────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    setLoadError(null);
    try {
      const data = await fetchFiles();
      setItems(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFiles(false);
    return () => {
      eventSourceRef.current?.close();
    };
  }, [loadFiles]);

  // ── Selection logic ─────────────────────────────────────────────────────────

  const handleToggle = useCallback((originalFile: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(originalFile)) next.delete(originalFile);
      else next.add(originalFile);
      return next;
    });
  }, []);

  const handleToggleFolder = useCallback((folder: FolderItem) => {
    const eligible = folder.children
      .filter(isEligibleItem)
      .map((c) => c.originalFile)
      .filter(Boolean) as string[];

    if (eligible.length === 0) return;

    setSelected((prev) => {
      const allSelected = eligible.every((f) => prev.has(f));
      const next = new Set(prev);
      if (allSelected) {
        eligible.forEach((f) => next.delete(f));
      } else {
        eligible.forEach((f) => next.add(f));
      }
      return next;
    });
  }, []);

  // ── Process handler ─────────────────────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    if (selected.size === 0 || isProcessing) return;

    const files = Array.from(selected);
    setIsProcessing(true);
    setProcessingFiles(new Set(files));

    let jobId: string;
    try {
      jobId = await startProcessing(files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [
        ...prev,
        makeLog("error", `Failed to start job: ${msg}`),
      ]);
      setIsProcessing(false);
      setProcessingFiles(new Set());
      return;
    }

    // Close any existing stream
    eventSourceRef.current?.close();

    const es = new EventSource(`/api/stream/${jobId}`);
    eventSourceRef.current = es;

    es.onmessage = (event: MessageEvent) => {
      let parsed: { type: string; message?: string; file?: string };
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        // raw text line
        setLogs((prev) => [...prev, makeLog("log", event.data as string)]);
        return;
      }

      const { type, message = "", file } = parsed;

      if (type === "ping") return; // heartbeat, ignore

      if (type === "done") {
        setLogs((prev) => [
          ...prev,
          makeLog("done", message || "Processing complete.", file),
        ]);
        setIsProcessing(false);
        setProcessingFiles(new Set());
        setSelected(new Set());
        es.close();
        eventSourceRef.current = null;
        // Refresh file list after a brief delay so the backend has flushed
        setTimeout(() => loadFiles(true), 400);
        return;
      }

      const validTypes = ["log", "info", "success", "error"] as const;
      type ValidLogType = (typeof validTypes)[number];
      const logType: ValidLogType = validTypes.includes(type as ValidLogType)
        ? (type as ValidLogType)
        : "log";

      setLogs((prev) => [...prev, makeLog(logType, message, file)]);

      // Remove file from processingFiles on terminal events
      if (file && (type === "success" || type === "error")) {
        setProcessingFiles((prev) => {
          const next = new Set(prev);
          next.delete(file);
          return next;
        });
      }
    };

    es.onerror = () => {
      setLogs((prev) => [
        ...prev,
        makeLog(
          "error",
          "Connection to server lost. The job may still be running.",
        ),
      ]);
      setIsProcessing(false);
      setProcessingFiles(new Set());
      es.close();
      eventSourceRef.current = null;
    };
  }, [selected, isProcessing, loadFiles]);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const selectedCount = selected.size;

  return (
    <div className="flex flex-col h-full bg-[#0c0c0e] text-zinc-100">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-[#2a2a35] bg-[#111114] z-10">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[1.25rem] font-bold tracking-tight text-white leading-none">
              Drum
            </span>
            <span className="text-[1.25rem] font-bold tracking-tight text-violet-400 leading-none">
              Less
            </span>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2.5">
          {/* Selected count chip */}
          {selectedCount > 0 && !isProcessing && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-600/20 text-violet-300 border border-violet-500/30 tabular-nums">
              {selectedCount} selected
            </span>
          )}

          {/* Refresh button */}
          <button
            onClick={() => loadFiles(true)}
            disabled={isLoading || isRefreshing || isProcessing}
            title="Re-scan files"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.07] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <RefreshCw size={15} className={isRefreshing ? "spin" : ""} />
          </button>

          {/* Process button */}
          <button
            onClick={handleProcess}
            disabled={selectedCount === 0 || isProcessing}
            className={[
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
              selectedCount > 0 && !isProcessing
                ? "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/40 active:scale-[0.98]"
                : "bg-violet-600/30 text-violet-400/60 cursor-not-allowed",
            ].join(" ")}
          >
            {isProcessing ? (
              <>
                <Loader2 size={14} className="spin" />
                <span>Processing…</span>
              </>
            ) : (
              <>
                <Drum size={14} />
                <span>Remove Drums</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left: File tree (40%) ──────────────────────────────────── */}
        <aside className="w-[40%] min-w-[280px] max-w-[520px] flex flex-col border-r border-[#2a2a35] bg-[#0f0f12]">
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-[#2a2a35]">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600 select-none">
              Files
            </span>
            {items.length > 0 && (
              <span className="text-[11px] text-zinc-700 tabular-nums">
                {items.reduce((acc, i) => {
                  if (i.type === "folder") return acc + i.children.length;
                  return acc + 1;
                }, 0)}{" "}
                items
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
                <Loader2 size={24} className="spin" />
                <p className="text-sm">Loading files…</p>
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
                <div className="text-red-400 text-sm font-medium">
                  Failed to load files
                </div>
                <div className="text-red-500/70 text-xs break-all">
                  {loadError}
                </div>
                <button
                  onClick={() => loadFiles(false)}
                  className="mt-2 px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : (
              <FileTree
                items={items}
                selected={selected}
                onToggle={handleToggle}
                onToggleFolder={handleToggleFolder}
                processingFiles={processingFiles}
                isProcessing={isProcessing}
              />
            )}
          </div>
        </aside>

        {/* ── Right: Log panel (60%) ─────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col p-4">
          <LogPanel
            logs={logs}
            isProcessing={isProcessing}
            onClear={handleClearLogs}
          />
        </main>
      </div>
    </div>
  );
}
