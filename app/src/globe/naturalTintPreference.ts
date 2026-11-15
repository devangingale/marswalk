const KEY = 's48.naturalTint';

export function readNaturalTint(storage: Pick<Storage, 'getItem'> | null = browserStorage()): boolean {
  try {
    const value = storage?.getItem(KEY);
    return value === null || value === undefined ? true : value !== 'false';
  } catch {
    return true;
  }
}

export function writeNaturalTint(enabled: boolean, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void {
  try {
    storage?.setItem(KEY, String(enabled));
  } catch {
    // Tint remains available for this session when storage is blocked.
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
