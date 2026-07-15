/**
 * Storage adapter. Picks a backend at runtime:
 *   • Supabase Storage  — when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 *     (the production path on Vercel, where the filesystem is ephemeral).
 *   • Filesystem        — otherwise (local dev), rooted at STORAGE_DIR.
 * Same bucket-relative API either way, e.g. "jd-captures/163/raw.md".
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';

const ROOT = path.resolve(process.cwd(), env.storageDir);
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = process.env.SUPABASE_BUCKET ?? 'jobsearch';

function abs(rel: string): string {
  return path.join(ROOT, rel);
}
async function ensureDir(rel: string): Promise<string> {
  const full = abs(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  return full;
}

// Lazy Supabase Storage client — only loaded when actually used.
async function bucket() {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  return client.storage.from(BUCKET);
}
async function sbUpload(rel: string, data: Blob | Buffer): Promise<string> {
  const { error } = await (await bucket()).upload(rel, data, { upsert: true });
  if (error) throw error;
  return rel;
}
async function sbDownload(rel: string): Promise<Blob> {
  const { data, error } = await (await bucket()).download(rel);
  if (error || !data) throw error ?? new Error('not found');
  return data;
}

export async function writeText(rel: string, content: string): Promise<string> {
  if (useSupabase) return sbUpload(rel, new Blob([content], { type: 'text/markdown' }));
  await fs.writeFile(await ensureDir(rel), content, 'utf8');
  return rel;
}

export async function writeBuffer(rel: string, buf: Buffer): Promise<string> {
  if (useSupabase) return sbUpload(rel, buf);
  await fs.writeFile(await ensureDir(rel), buf);
  return rel;
}

export async function readText(rel: string): Promise<string> {
  if (useSupabase) return (await sbDownload(rel)).text();
  return fs.readFile(abs(rel), 'utf8');
}

export async function readBuffer(rel: string): Promise<Buffer> {
  if (useSupabase) return Buffer.from(await (await sbDownload(rel)).arrayBuffer());
  return fs.readFile(abs(rel));
}

export async function exists(rel: string): Promise<boolean> {
  if (useSupabase) {
    const { data } = await (await bucket()).download(rel);
    return !!data;
  }
  try {
    await fs.access(abs(rel));
    return true;
  } catch {
    return false;
  }
}

export function localPath(rel: string): string {
  return abs(rel);
}
