import { useState } from 'react';
import {
  Folder,
  FolderOpen,
  Music,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  XCircle,
} from 'lucide-react';
import type { AudioItem, FolderItem, SongItem, TreeItem } from '../types';

interface FileTreeProps {
  items: TreeItem[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onToggleFolder: (folder: FolderItem) => void;
  processingFiles: Set<string>;
  isProcessing: boolean;
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1].toLowerCase()}` : '';
}

function isEligible(item: AudioItem | SongItem): boolean {
  return (
    item.type === 'audio' ||
    (item.type === 'song' && (item.status === 'partial' || item.status === 'done'))
  );
}

// ── Audio Row ─────────────────────────────────────────────────────────────────
interface AudioRowProps {
  item: AudioItem;
  selected: boolean;
  onToggle: () => void;
  isProcessingThis: boolean;
  isProcessing: boolean;
}

function AudioRow({ item, selected, onToggle, isProcessingThis, isProcessing }: AudioRowProps) {
  const ext = getFileExtension(item.name);
  const baseName = ext ? item.name.slice(0, item.name.length - ext.length) : item.name;

  return (
    <div
      className={[
        'flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer select-none group',
        'transition-colors duration-100',
        isProcessingThis
          ? 'row-processing'
          : selected
          ? 'bg-violet-600/10 hover:bg-violet-600/15'
          : 'hover:bg-white/[0.04]',
      ].join(' ')}
      onClick={() => {
        if (!isProcessing) onToggle();
      }}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        className="custom-checkbox"
        checked={selected}
        disabled={isProcessing}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Status / spinner */}
      <span className="flex-shrink-0 w-4 flex items-center justify-center">
        {isProcessingThis ? (
          <Loader2 size={14} className="text-violet-400 spin" />
        ) : item.status === 'error' ? (
          <XCircle size={14} className="text-red-400" />
        ) : (
          <Music size={14} className={selected ? 'text-violet-400' : 'text-zinc-500'} />
        )}
      </span>

      {/* Name */}
      <span
        className={[
          'flex-1 text-sm truncate',
          isProcessingThis
            ? 'text-violet-300'
            : selected
            ? 'text-zinc-100'
            : 'text-zinc-300 group-hover:text-zinc-100',
        ].join(' ')}
        title={item.name}
      >
        {baseName}
      </span>

      {/* Extension badge */}
      {ext && (
        <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-[#2a2a35] tracking-wide uppercase">
          {ext}
        </span>
      )}
    </div>
  );
}

// ── Song Row ──────────────────────────────────────────────────────────────────
interface SongRowProps {
  item: SongItem;
  selected: boolean;
  onToggle: () => void;
  isProcessingThis: boolean;
  isProcessing: boolean;
}

function SongRow({ item, selected, onToggle, isProcessingThis, isProcessing }: SongRowProps) {
  const isDone = item.status === 'done';
  const isPartial = item.status === 'partial';
  const isError = item.status === 'error';
  const canReprocess = isDone || isPartial;

  return (
    <div
      className={[
        'flex items-center gap-2.5 px-3 py-2 rounded-lg select-none group',
        'transition-colors duration-100',
        canReprocess ? 'cursor-pointer' : 'cursor-default',
        isProcessingThis
          ? 'row-processing'
          : selected && canReprocess
          ? 'bg-violet-600/10 hover:bg-violet-600/15'
          : isDone
          ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]'
          : isPartial
          ? 'hover:bg-amber-500/[0.06]'
          : isError
          ? 'hover:bg-red-500/[0.06]'
          : 'hover:bg-white/[0.04]',
      ].join(' ')}
      onClick={() => {
        if (canReprocess && !isProcessing) onToggle();
      }}
    >
      {/* Checkbox — shown for partial / done so user can re-process */}
      {canReprocess ? (
        <input
          type="checkbox"
          className="custom-checkbox"
          checked={selected}
          disabled={isProcessing}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="w-[15px] flex-shrink-0" />
      )}

      {/* Status icon / spinner */}
      <span className="flex-shrink-0 w-4 flex items-center justify-center">
        {isProcessingThis ? (
          <Loader2 size={14} className="text-violet-400 spin" />
        ) : isDone ? (
          <CheckCircle2 size={14} className="text-emerald-400" />
        ) : isPartial ? (
          <AlertTriangle size={14} className="text-amber-400" />
        ) : isError ? (
          <XCircle size={14} className="text-red-400" />
        ) : (
          <Loader2 size={14} className="text-zinc-600 spin" />
        )}
      </span>

      {/* Name */}
      <span
        className={[
          'flex-1 text-sm truncate',
          isProcessingThis
            ? 'text-violet-300'
            : isDone && !selected
            ? 'text-zinc-500'
            : isPartial
            ? 'text-zinc-300 group-hover:text-zinc-100'
            : isError
            ? 'text-red-400'
            : selected
            ? 'text-zinc-100'
            : 'text-zinc-400',
        ].join(' ')}
        title={item.name}
      >
        {item.name}
      </span>

      {/* Status badge */}
      {isProcessingThis ? (
        <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-300 border border-violet-500/30">
          processing
        </span>
      ) : isDone ? (
        <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          done
        </span>
      ) : isPartial ? (
        <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
          partial
        </span>
      ) : isError ? (
        <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-400 border border-red-500/20">
          error
        </span>
      ) : null}
    </div>
  );
}

// ── Folder Row ────────────────────────────────────────────────────────────────
interface FolderRowProps {
  folder: FolderItem;
  selected: Set<string>;
  onToggle: (path: string) => void;
  onToggleFolder: (folder: FolderItem) => void;
  processingFiles: Set<string>;
  isProcessing: boolean;
}

function FolderRow({
  folder,
  selected,
  onToggle,
  onToggleFolder,
  processingFiles,
  isProcessing,
}: FolderRowProps) {
  const [open, setOpen] = useState(true);

  const eligibleChildren = folder.children.filter(isEligible);
  const selectedCount = eligibleChildren.filter(
    (c) => c.originalFile && selected.has(c.originalFile)
  ).length;
  const allSelected = eligibleChildren.length > 0 && selectedCount === eligibleChildren.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const songCount = folder.children.filter((c) => c.type === 'song').length;
  const audioCount = folder.children.filter((c) => c.type === 'audio').length;
  const anyProcessing = folder.children.some(
    (c) => c.originalFile && processingFiles.has(c.originalFile)
  );

  const countLabel = (() => {
    const parts: string[] = [];
    if (songCount > 0) parts.push(`${songCount} song${songCount !== 1 ? 's' : ''}`);
    if (audioCount > 0) parts.push(`${audioCount} audio${audioCount !== 1 ? ' file' : ' file'}`);
    return parts.join(', ');
  })();

  return (
    <div className="mb-1">
      {/* Folder header */}
      <div
        className={[
          'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer select-none group',
          'hover:bg-white/[0.04] transition-colors duration-100',
        ].join(' ')}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Chevron */}
        <span className="flex-shrink-0 text-zinc-600 group-hover:text-zinc-400 transition-colors">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Folder icon */}
        <span className="flex-shrink-0">
          {open ? (
            <FolderOpen size={15} className="text-amber-400/80" />
          ) : (
            <Folder size={15} className="text-amber-400/60" />
          )}
        </span>

        {/* Folder name */}
        <span className="flex-1 text-sm font-medium text-zinc-300 group-hover:text-zinc-100 truncate transition-colors">
          {folder.name}
        </span>

        {/* Processing spinner */}
        {anyProcessing && (
          <span className="flex-shrink-0">
            <Loader2 size={12} className="text-violet-400 spin" />
          </span>
        )}

        {/* Song count label */}
        {countLabel && (
          <span className="flex-shrink-0 text-[11px] text-zinc-600 group-hover:text-zinc-500">
            {countLabel}
          </span>
        )}

        {/* Selected count badge */}
        {selectedCount > 0 && (
          <span
            className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-600 text-white min-w-[18px] text-center leading-none"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFolder(folder);
            }}
          >
            {selectedCount}
          </span>
        )}

        {/* Toggle-all checkbox (only when folder is open and has eligible children) */}
        {open && eligibleChildren.length > 0 && (
          <input
            type="checkbox"
            className="custom-checkbox flex-shrink-0"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            disabled={isProcessing}
            onChange={() => onToggleFolder(folder)}
            onClick={(e) => e.stopPropagation()}
            title={allSelected ? 'Deselect all' : 'Select all'}
          />
        )}
      </div>

      {/* Children */}
      {open && (
        <div className="ml-4 pl-3 border-l border-[#2a2a35] mt-0.5 space-y-0.5">
          {folder.children.length === 0 ? (
            <p className="text-xs text-zinc-600 py-2 px-2 italic">Empty folder</p>
          ) : (
            folder.children.map((child) => {
              const key = child.path;
              const originalFile = child.originalFile ?? '';
              const isProcessingThis = !!originalFile && processingFiles.has(originalFile);
              const isSelected = !!originalFile && selected.has(originalFile);

              if (child.type === 'audio') {
                return (
                  <AudioRow
                    key={key}
                    item={child}
                    selected={isSelected}
                    onToggle={() => onToggle(child.originalFile)}
                    isProcessingThis={isProcessingThis}
                    isProcessing={isProcessing}
                  />
                );
              }

              if (child.type === 'song') {
                return (
                  <SongRow
                    key={key}
                    item={child}
                    selected={isSelected}
                    onToggle={() => {
                      if (child.originalFile) onToggle(child.originalFile);
                    }}
                    isProcessingThis={isProcessingThis}
                    isProcessing={isProcessing}
                  />
                );
              }

              return null;
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── FileTree ──────────────────────────────────────────────────────────────────
export default function FileTree({
  items,
  selected,
  onToggle,
  onToggleFolder,
  processingFiles,
  isProcessing,
}: FileTreeProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
        <Folder size={40} strokeWidth={1} />
        <p className="text-sm">No files found</p>
        <p className="text-xs text-zinc-700">
          Add audio files to your music directory and refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item) => {
        if (item.type === 'folder') {
          return (
            <FolderRow
              key={item.path}
              folder={item}
              selected={selected}
              onToggle={onToggle}
              onToggleFolder={onToggleFolder}
              processingFiles={processingFiles}
              isProcessing={isProcessing}
            />
          );
        }

        if (item.type === 'audio') {
          const isProcessingThis = !!item.originalFile && processingFiles.has(item.originalFile);
          const isSelected = !!item.originalFile && selected.has(item.originalFile);
          return (
            <AudioRow
              key={item.path}
              item={item}
              selected={isSelected}
              onToggle={() => onToggle(item.originalFile)}
              isProcessingThis={isProcessingThis}
              isProcessing={isProcessing}
            />
          );
        }

        if (item.type === 'song') {
          const isProcessingThis = !!item.originalFile && processingFiles.has(item.originalFile);
          const isSelected = !!item.originalFile && selected.has(item.originalFile);
          return (
            <SongRow
              key={item.path}
              item={item}
              selected={isSelected}
              onToggle={() => {
                if (item.originalFile) onToggle(item.originalFile);
              }}
              isProcessingThis={isProcessingThis}
              isProcessing={isProcessing}
            />
          );
        }

        return null;
      })}
    </div>
  );
}
