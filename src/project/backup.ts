// When to remind the person to save a copy of a book. The books live in the browser's storage only,
// so a copy is the one thing that survives clearing the site's data.

export const BACKUP_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export interface BackupState {
  /** When the book was last downloaded as a zip, if ever. */
  lastBackup?: number;
  /** When this browser first showed the book in the list. */
  firstSeen: number;
  /** When the book last changed. */
  updatedAt: number;
}

/** True when the book changed since its last copy and that copy (or the book itself, if none) is over a week old. */
export function backupDue(now: number, s: BackupState): boolean {
  const changedSince = s.updatedAt > (s.lastBackup ?? 0);
  const reference = s.lastBackup ?? s.firstSeen;
  return changedSince && now - reference > BACKUP_DAYS * DAY;
}
