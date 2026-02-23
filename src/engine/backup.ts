import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { BackupRecord } from '../types';
import { runElevated, writeElevated } from '../utils/shell';

/**
 * Default root directory for all backup snapshots.
 * Located in XDG state home to follow Linux conventions.
 */
const DEFAULT_BACKUP_ROOT = join(homedir(), '.local', 'state', 'gpu-optimizer', 'backups');

/**
 * Flattens an absolute file path into a safe filename for storage.
 * Replaces path separators and leading slashes with underscores.
 *
 * @example
 * ```ts
 * flattenPath('/etc/default/grub') // => 'etc_default_grub'
 * flattenPath('/etc/modprobe.d/i915.conf') // => 'etc_modprobe.d_i915.conf'
 * ```
 *
 * @param filePath - Absolute path to flatten
 * @returns A safe filename string with no directory separators
 */
function flattenPath(filePath: string): string {
    return filePath.replace(/^\/+/, '').replace(/\//g, '_');
}

/**
 * Generates a filesystem-safe ISO timestamp string for use as snapshot IDs.
 * Colons are replaced with dashes to be compatible with all filesystems.
 *
 * @returns Timestamp string like "2026-02-23T075500Z"
 */
function generateTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '').replace('T', 'T').slice(0, -1) + 'Z';
}

/**
 * Ensures the backup root directory exists.
 * Creates the full directory tree recursively if it doesn't exist.
 *
 * @param backupRoot - Override the default backup directory (useful for testing)
 * @returns The absolute path to the backup root directory
 */
export function initBackupDir(backupRoot = DEFAULT_BACKUP_ROOT): string {
    mkdirSync(backupRoot, { recursive: true });
    return backupRoot;
}

/**
 * Creates a snapshot of the specified system files before mutation.
 *
 * Each snapshot is stored in a timestamped subdirectory containing:
 * - Copies of all specified files (with flattened filenames)
 * - A `manifest.json` linking each backup file to its original path
 *
 * Files that require elevated permissions are read via `sudo cat`.
 * Files readable by the current user are copied directly.
 *
 * @param filePaths - Array of absolute paths to system files to back up
 * @param backupRoot - Override the default backup directory (useful for testing)
 * @returns The BackupRecord describing this snapshot
 * @throws If the snapshot directory cannot be created
 */
export function createSnapshot(filePaths: string[], backupRoot = DEFAULT_BACKUP_ROOT): BackupRecord {
    initBackupDir(backupRoot);

    const snapshotId = generateTimestamp();
    const snapshotDir = join(backupRoot, snapshotId);
    mkdirSync(snapshotDir, { recursive: true });

    const record: BackupRecord = {
        id: snapshotId,
        date: new Date().toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'medium',
        }),
        files: [],
    };

    for (const originalPath of filePaths) {
        const flatName = flattenPath(originalPath);
        const backupFilePath = join(snapshotDir, flatName);

        try {
            if (existsSync(originalPath) && isReadableByUser(originalPath)) {
                copyFileSync(originalPath, backupFilePath);
            } else {
                /**
                 * File may require elevated permissions to read (e.g., boot entries).
                 * Use sudo cat to read the content and write it locally.
                 */
                const content = runElevated(`cat '${originalPath.replace(/'/g, "'\\''")}'`);
                writeFileSync(backupFilePath, content, 'utf-8');
            }

            record.files.push({
                originalPath,
                backupPath: flatName,
            });
        } catch (e: any) {
            /**
             * If a file cannot be read even with elevation, log it but
             * don't fail the entire snapshot — partial backups are better
             * than no backups.
             */
            console.warn(`Warning: Could not back up ${originalPath}: ${e.message}`);
        }
    }

    const manifestPath = join(snapshotDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(record, null, 2), 'utf-8');

    return record;
}

/**
 * Tests whether the current user can read a file without elevation.
 *
 * @param filePath - Absolute path to test
 * @returns `true` if the file is readable by the current process
 */
function isReadableByUser(filePath: string): boolean {
    try {
        readFileSync(filePath, { flag: 'r' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Lists all available backup snapshots, sorted newest-first.
 *
 * Reads each snapshot's `manifest.json` to reconstruct the `BackupRecord`.
 * Snapshots with missing or corrupt manifests are silently skipped.
 *
 * @param backupRoot - Override the default backup directory (useful for testing)
 * @returns Array of BackupRecords sorted by ID (newest first)
 */
export function listSnapshots(backupRoot = DEFAULT_BACKUP_ROOT): BackupRecord[] {
    if (!existsSync(backupRoot)) return [];

    const entries = readdirSync(backupRoot, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse();

    const records: BackupRecord[] = [];

    for (const dirName of entries) {
        const manifestPath = join(backupRoot, dirName, 'manifest.json');
        try {
            const raw = readFileSync(manifestPath, 'utf-8');
            const record = JSON.parse(raw) as BackupRecord;
            records.push(record);
        } catch {
            /** Skip directories without valid manifests */
        }
    }

    return records;
}

/**
 * Restores all files from a specific backup snapshot.
 *
 * Reads the snapshot's `manifest.json`, then copies each backed-up file
 * back to its original system path using `writeElevated` for JIT privilege
 * escalation.
 *
 * Does **not** trigger an initramfs rebuild — the caller (CLI or mutation
 * engine) is responsible for that step after rollback completes.
 *
 * @param snapshotId - The timestamp ID of the snapshot to restore
 * @param backupRoot - Override the default backup directory (useful for testing)
 * @returns Array of original file paths that were successfully restored
 * @throws If the snapshot directory or manifest doesn't exist
 */
export function rollback(snapshotId: string, backupRoot = DEFAULT_BACKUP_ROOT): string[] {
    const snapshotDir = join(backupRoot, snapshotId);
    const manifestPath = join(snapshotDir, 'manifest.json');

    if (!existsSync(manifestPath)) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const raw = readFileSync(manifestPath, 'utf-8');
    const record = JSON.parse(raw) as BackupRecord;
    const restored: string[] = [];

    for (const file of record.files) {
        const backupFilePath = join(snapshotDir, file.backupPath);

        try {
            const content = readFileSync(backupFilePath, 'utf-8');
            writeElevated(file.originalPath, content);
            restored.push(file.originalPath);
        } catch (e: any) {
            console.warn(`Warning: Could not restore ${file.originalPath}: ${e.message}`);
        }
    }

    return restored;
}
