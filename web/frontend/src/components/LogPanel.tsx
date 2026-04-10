import { useEffect, useRef, useState } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import type { LogEntry } from '../types';

interface LogPanelProps {
  logs: LogEntry[];
  isProcessing: boolean;
  onClear: () => void;
}

const LOG_COLORS: Record<LogEntry['type'], string> = {
  info:    'text-zinc-400',
  log:     'text-zinc-300',
  success: 'text-emerald-400',
  error:   'text-red-400',
  done:    'text-emerald-300',
};

const LOG_PREFIX: Record<LogEntry['type'], string> = {
  info:    '  ',
  log:     '  ',
  success: '✓ ',
  error:   '✗ ',
  done:    '✓ ',
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function LogPanel({ logs, isProcessing, onClear }: LogPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevLogCount = useRef(0);

  /* Auto-scroll when new logs arrive (only if user hasn't scrolled up) */
  useEffect(() => {
    if (autoScroll && logs.length !== prevLogCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevLogCount.current = logs.length;
  }, [logs, autoScroll]);

  /* Detect manual scroll up → disable auto-scroll */
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  /* Re-enable auto-scroll and jump to bottom */
  function jumpToBottom() {
    setAutoScroll(true);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  const isEmpty = logs.length === 0;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] border border-[#2a2a35] rounded-xl overflow-hidden">

      {/* ── Panel header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2a2a35] bg-[#111114] shrink-0">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-zinc-500" />
          <span className="text-xs font-semibold tracking-widest uppercase text-zinc-500 select-none">
            Output
          </span>
          {logs.length > 0 && (
            <span className="ml-1 text-xs text-zinc-600 tabular-nums">
              ({logs.length} lines)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Jump-to-bottom button — shown when user has scrolled up */}
          {!autoScroll && logs.length > 0 && (
            <button
              onClick={jumpToBottom}
              className="text-xs text-violet-400 hover:text-violet-300 transition-colors px-2 py-0.5 rounded bg-violet-500/10 hover:bg-violet-500/20"
            >
              ↓ bottom
            </button>
          )}

          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
              </span>
              <span className="font-mono font-medium">running</span>
            </div>
          )}

          {/* Clear button */}
          <button
            onClick={onClear}
            disabled={isEmpty}
            title="Clear logs"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Trash2 size={12} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* ── Log body ─────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-auto p-4 log-panel"
      >
        {isEmpty ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center gap-3 select-none">
            <Terminal size={28} className="text-zinc-700" />
            <p className="text-zinc-600 text-sm text-center leading-relaxed">
              No logs yet —<br />
              select files and click <span className="text-zinc-500 font-medium">Remove Drums</span>
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {logs.map((entry, idx) => (
              <LogLine
                key={entry.id}
                entry={entry}
                isNew={idx >= prevLogCount.current - 1}
              />
            ))}

            {/* Blinking cursor while processing */}
            {isProcessing && (
              <div className="flex items-center gap-2 mt-1 h-5">
                <span className="cursor-blink" aria-hidden="true" />
              </div>
            )}

            {/* Invisible anchor for scrollIntoView */}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Individual log line ─────────────────────────────────────────────── */
interface LogLineProps {
  entry: LogEntry;
  isNew: boolean;
}

function LogLine({ entry, isNew }: LogLineProps) {
  const colorClass = LOG_COLORS[entry.type];
  const prefix = LOG_PREFIX[entry.type];
  const isBold = entry.type === 'done';

  /* Split on newlines so embedded \n are rendered as real lines */
  const lines = entry.message.split('\n');

  return (
    <div
      className={`group flex gap-3 py-0.5 px-1 rounded transition-colors hover:bg-white/[0.02] ${
        isNew ? 'log-line-enter' : ''
      } ${entry.type === 'done' ? 'mt-1 mb-1' : ''}`}
    >
      {/* Timestamp */}
      <span
        className="shrink-0 text-zinc-700 select-none tabular-nums pt-px"
        style={{ fontSize: '0.7rem', lineHeight: '1.65' }}
      >
        {formatTime(entry.timestamp)}
      </span>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${colorClass} ${isBold ? 'font-semibold' : ''}`}>
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
            {i === 0 && (
              <span className="select-none opacity-60">{prefix}</span>
            )}
            {i > 0 && (
              <span className="select-none opacity-0 mr-0">{prefix}</span>
            )}
            {line || '\u00A0'}
          </div>
        ))}

        {/* File path annotation */}
        {entry.file && (
          <div
            className="mt-0.5 text-zinc-600 truncate"
            style={{ fontSize: '0.7rem' }}
          >
            {entry.file}
          </div>
        )}
      </div>

      {/* Type badge — only shown on hover for non-log types */}
      {entry.type !== 'log' && (
        <span
          className={`shrink-0 self-start opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded-full border ${getBadgeStyle(entry.type)}`}
          style={{ marginTop: '2px' }}
        >
          {entry.type}
        </span>
      )}
    </div>
  );
}

function getBadgeStyle(type: LogEntry['type']): string {
  switch (type) {
    case 'success': return 'border-emerald-800 text-emerald-500 bg-emerald-500/5';
    case 'error':   return 'border-red-800 text-red-500 bg-red-500/5';
    case 'done':    return 'border-emerald-700 text-emerald-400 bg-emerald-500/10';
    case 'info':    return 'border-zinc-700 text-zinc-500 bg-zinc-500/5';
    default:        return 'border-zinc-700 text-zinc-500 bg-zinc-500/5';
  }
}
