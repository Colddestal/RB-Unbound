import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { RoomState } from '@rb-unbound/lobby';
import type { TurnState } from '@rb-unbound/lobby';
import type { ModulePackage, PlayerId, TableState } from '@rb-unbound/tabletop';

export type PersistedSession = {
  tokenHash: string;
  memberId: string;
  displayName: string;
  roomCode: string;
  seat?: PlayerId;
  spectator: boolean;
  disconnectedAt?: number;
};

export type PersistedMatch = {
  roomCode: string;
  revision: number;
  table: TableState;
  turn?: TurnState;
  lastActionSequence: Array<[string, number]>;
};

export type PersistenceSnapshot = {
  schemaVersion: 1;
  savedAt: string;
  rooms: RoomState[];
  matches: PersistedMatch[];
  sessions: PersistedSession[];
  modules?: ModulePackage[];
};

const statePath = resolve(process.env.RB_UNBOUND_STATE_PATH ?? '.data/server-state.json');

export async function loadSnapshot(): Promise<PersistenceSnapshot | null> {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const snapshot = parsed as Partial<PersistenceSnapshot>;
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.rooms) || !Array.isArray(snapshot.matches) || !Array.isArray(snapshot.sessions)) return null;
    return snapshot as PersistenceSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveSnapshot(snapshot: PersistenceSnapshot): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, statePath);
}

export function snapshotPath(): string {
  return statePath;
}
