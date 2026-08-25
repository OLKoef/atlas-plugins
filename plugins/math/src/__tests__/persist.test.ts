import { describe, expect, it } from 'vitest';
import {
  MATH_STATE_KEY,
  MATH_STATE_VERSION,
  emptyMathState,
  loadMathState,
  parseMathState,
  saveLastTool,
  serializeMathState,
} from '../lib/persist';

/** In-memory stand-in for the host's per-plugin `storage.*` namespace. */
function fakeStorage(seed?: unknown) {
  const cell: { value: unknown } = { value: seed };
  return {
    cell,
    get: async <T>(key: string): Promise<T | null> => {
      expect(key).toBe(MATH_STATE_KEY);
      return (cell.value ?? null) as T | null;
    },
    set: async <T>(key: string, value: T): Promise<void> => {
      expect(key).toBe(MATH_STATE_KEY);
      cell.value = value;
    },
  };
}

describe('parseMathState', () => {
  it('degrades to the empty state for an absent or malformed blob', () => {
    expect(parseMathState(undefined)).toEqual(emptyMathState);
    expect(parseMathState(null)).toEqual(emptyMathState);
    expect(parseMathState('nope')).toEqual(emptyMathState);
    expect(parseMathState([1, 2, 3])).toEqual(emptyMathState);
  });

  it('reads shell.lastTool', () => {
    const parsed = parseMathState({ version: 1, shell: { lastTool: 'matrix' } });
    expect(parsed.shell.lastTool).toBe('matrix');
  });

  it('falls back to Graphing for a lastTool that is not a live tool', () => {
    // A disabled slot, a removed tool, or plain garbage must never strand the shell.
    expect(parseMathState({ shell: { lastTool: 'geometry' } }).shell.lastTool).toBe('graphing');
    expect(parseMathState({ shell: { lastTool: 42 } }).shell.lastTool).toBe('graphing');
    expect(parseMathState({ shell: 'broken' }).shell.lastTool).toBe('graphing');
  });

  it('keeps the on-disk version rather than downgrading it', () => {
    expect(parseMathState({ version: 7, shell: { lastTool: 'graphing' } }).version).toBe(7);
    expect(parseMathState({ version: 'x' }).version).toBe(MATH_STATE_VERSION);
  });

  it('collects the tool sections it does not own', () => {
    const parsed = parseMathState({
      version: 1,
      shell: { lastTool: 'scientific' },
      graphing: { exprs: [{ src: 'sin(x)' }] },
      matrix: { matrices: [] },
    });
    expect(parsed.sections).toEqual({
      graphing: { exprs: [{ src: 'sin(x)' }] },
      matrix: { matrices: [] },
    });
  });
});

describe('serializeMathState', () => {
  it('round-trips through parse without losing anything', () => {
    const onDisk = {
      version: 1,
      shell: { lastTool: 'matrix' },
      scientific: { angleMode: 'deg', keypadCollapsed: true },
    };
    expect(serializeMathState(parseMathState(onDisk))).toEqual(onDisk);
  });

  it('tolerates forward-compatible sections written by a newer build', () => {
    const future = {
      version: 2,
      shell: { lastTool: 'graphing' },
      geometry: { shapes: ['circle'] },
      unknownTopLevel: 'keep me',
    };
    // Reading and rewriting an unknown section must not drop it.
    expect(serializeMathState(parseMathState(future))).toEqual(future);
  });
});

describe('loadMathState / saveLastTool', () => {
  it('restores the last active tool from storage', async () => {
    const storage = fakeStorage({ version: 1, shell: { lastTool: 'scientific' } });
    const loaded = await loadMathState(storage);
    expect(loaded.shell.lastTool).toBe('scientific');
  });

  it('restores the default tool when nothing is stored yet', async () => {
    const loaded = await loadMathState(fakeStorage());
    expect(loaded.shell.lastTool).toBe('graphing');
  });

  it('writes the new tool without clobbering other tools’ saved state', async () => {
    const storage = fakeStorage({
      version: 1,
      shell: { lastTool: 'graphing' },
      graphing: { exprs: [{ src: 'x^2' }] },
    });
    await saveLastTool(storage, 'matrix');
    expect(storage.cell.value).toEqual({
      version: 1,
      shell: { lastTool: 'matrix' },
      graphing: { exprs: [{ src: 'x^2' }] },
    });
  });

  it('skips the write when the stored tool is already current', async () => {
    const storage = fakeStorage({ version: 1, shell: { lastTool: 'matrix' } });
    const before = storage.cell.value;
    await saveLastTool(storage, 'matrix');
    expect(storage.cell.value).toBe(before);
  });
});
