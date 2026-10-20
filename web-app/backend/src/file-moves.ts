import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface FileMove { from: string; to: string; backup: string | null }
export async function moveFile(from: string, to: string, moves: FileMove[], allowMissing = false) {
  try { await fs.access(from); }
  catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  if (from === to) return true;
  await fs.mkdir(path.dirname(to), { recursive: true });
  let backup: string | null = null;
  try { await fs.access(to); backup = `${to}.previous-${randomUUID()}`; await fs.rename(to, backup); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try { await fs.rename(from, to); }
  catch (error) { if (backup) await fs.rename(backup, to); throw error; }
  moves.push({ from, to, backup }); return true;
}
export async function rollbackMoves(moves: FileMove[]) {
  for (const move of [...moves].reverse()) {
    await fs.rename(move.to, move.from);
    if (move.backup) await fs.rename(move.backup, move.to);
  }
}
export async function discardMoveBackups(moves: FileMove[]) {
  for (const move of moves) if (move.backup) await fs.unlink(move.backup);
}
