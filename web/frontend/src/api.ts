import type { TreeItem } from './types';

export async function fetchFiles(): Promise<TreeItem[]> {
  const res = await fetch('/api/files');
  if (!res.ok) {
    throw new Error(`Failed to fetch files: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.items as TreeItem[];
}

export async function startProcessing(files: string[]): Promise<string> {
  const res = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) {
    throw new Error(`Failed to start processing: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.jobId as string;
}
