export type ItemStatus = 'pending' | 'partial' | 'done' | 'processing' | 'error';

export interface BaseItem {
  type: 'audio' | 'song' | 'folder';
  name: string;
  path: string;
  status?: ItemStatus;
  originalFile?: string | null;
  drumlessFile?: string | null;
}

export interface AudioItem extends BaseItem {
  type: 'audio';
  status: 'pending' | 'processing' | 'error';
  originalFile: string;
  drumlessFile: null;
}

export interface SongItem extends BaseItem {
  type: 'song';
  status: 'done' | 'partial' | 'processing' | 'error';
  originalFile: string | null;
  drumlessFile: string | null;
}

export interface FolderItem extends BaseItem {
  type: 'folder';
  children: (AudioItem | SongItem)[];
}

export type TreeItem = AudioItem | SongItem | FolderItem;

export interface LogEntry {
  id: number;
  type: 'log' | 'info' | 'success' | 'error' | 'done';
  message: string;
  file?: string;
  timestamp: Date;
}
