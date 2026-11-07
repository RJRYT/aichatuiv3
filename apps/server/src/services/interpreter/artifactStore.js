import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const artifacts = new Map();
const MAX_TOTAL = 10 * 1024 * 1024;
const MAX_FILES = 8;
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/;
const TTL_MS = 60 * 60 * 1000;

async function pruneExpired() {
  const dirs = new Set();
  for (const [id, item] of artifacts) {
    if (item.expiresAt <= Date.now()) { dirs.add(item.dir); artifacts.delete(id); }
  }
  for (const dir of dirs) {
    if (![...artifacts.values()].some(item => item.dir === dir)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function collectArtifacts(workspace, ownerId) {
  await pruneExpired();
  const root = path.resolve(workspace);
  const found = [];
  async function walk(folder, prefix = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = path.join(folder, entry.name);
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(full, rel);
      else if (entry.isFile() && SAFE_NAME.test(entry.name) && found.length < MAX_FILES) {
        const real = await fs.realpath(full);
        if (!real.startsWith(root + path.sep)) continue;
        const stat = await fs.stat(real);
        if (stat.size <= MAX_TOTAL) found.push({ name: rel, path: real, size: stat.size });
      }
    }
  }
  await walk(root);
  let total = 0;
  const result = [];
  for (const file of found) {
    if (total + file.size > MAX_TOTAL) break;
    const id = randomUUID();
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nemotron-artifact-'));
    const artifactPath = path.join(artifactDir, path.basename(file.name));
    await fs.copyFile(file.path, artifactPath);
    artifacts.set(id, {
      ownerId: String(ownerId), name: path.basename(file.name),
      path: artifactPath, size: file.size, dir: artifactDir, expiresAt: Date.now() + TTL_MS
    });
    total += file.size;
    result.push({ id, name: path.basename(file.name), size: file.size, downloadUrl: `/api/interpreter/artifacts/${id}` });
  }
  return result;
}

export function getArtifact(id, ownerId) {
  const item = artifacts.get(id);
  if (!item || item.expiresAt <= Date.now() || item.ownerId !== String(ownerId)) return null;
  return item;
}
