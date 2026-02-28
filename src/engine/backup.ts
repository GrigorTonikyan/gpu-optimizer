import { join } from 'node:path';
import type { BackupRecord, AppConfig } from '../types';
import { runElevated, writeElevated } from '../utils/shell';
import { FsService } from '../services/fs';
import { Logger } from '../utils/logger';

/**
 * Flattens an absolute file path into a safe filename for storage.
 */
function flattenPath(filePath: string): string {
    return filePath.replace(/^\/+/, '').replace(/\//g, '_');
}

/**
 * Generates a filesystem-safe ISO timestamp string for use as snapshot IDs.
 * Format: YYYYMMDD'T'HHMMSS'Z' (e.g., 20260228T123200Z)
 */
function generateTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '').replace('T', 'T').slice(0, -1) + 'Z';
}

/**
 * Ensures the backup root directory exists.
 */
export async function initBackupDir(backupRoot: string): Promise<string> {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(backupRoot, { recursive: true });
    return backupRoot;
}

/**
 * Creates a snapshot of the specified system files before mutation.
 * 
 * @param filePaths - List of absolute paths to files to back up
 * @param backupRoot - The directory where snapshots are stored
 * @param config - Optional AppConfig for dry-run detection
 * @returns A promise resolving to the BackupRecord for the new snapshot
 */
export async function createSnapshot(filePaths: string[], backupRoot: string, config?: AppConfig): Promise<BackupRecord> {
    const snapshotId = generateTimestamp();
    const snapshotDir = join(backupRoot, snapshotId);

    if (config?.dryMode) {
        Logger.info(`[DRY RUN] Would back up ${filePaths.length} files to ${backupRoot}`);
        return {
            id: snapshotId,
            date: new Date().toLocaleString(),
            files: filePaths.map(p => ({
                originalPath: p,
                backupPath: flattenPath(p)
            }))
        };
    }

    const { mkdir } = await import('node:fs/promises');
    await mkdir(snapshotDir, { recursive: true });

    const record: BackupRecord = {
        id: snapshotId,
        date: new Date().toLocaleString(),
        files: [],
    };

    for (const originalPath of filePaths) {
        const flatName = flattenPath(originalPath);
        const backupFilePath = join(snapshotDir, flatName);

        try {
            const file = Bun.file(originalPath);
            if (await file.exists()) {
                // Try reading to see if we need elevation
                try {
                    const content = await file.arrayBuffer();
                    await Bun.write(backupFilePath, content);
                } catch {
                    // Requires elevation
                    const content = runElevated(`cat '${originalPath.replace(/'/g, "'\\''")}'`);
                    await Bun.write(backupFilePath, content);
                }

                record.files.push({
                    originalPath,
                    backupPath: flatName,
                });
            }
        } catch (e: any) {
            Logger.warn(`Could not back up ${originalPath}: ${e.message}`); // Replaced console.warn with Logger.warn
        }
    }

    const manifestPath = join(snapshotDir, 'manifest.json');
    await Bun.write(manifestPath, JSON.stringify(record, null, 2));

    return record;
}

/**
 * Lists all available backup snapshots, sorted newest-first.
 * 
 * @param backupRoot - The root directory to scan for snapshots
 * @returns A promise resolving to an array of BackupRecords
 */
export async function listSnapshots(backupRoot: string): Promise<BackupRecord[]> {
    const entries = await FsService.traverse(backupRoot, '', true);
    const sortedEntries = entries.sort().reverse();
    const records: BackupRecord[] = [];

    for (const dirName of sortedEntries) {
        const manifestPath = join(backupRoot, dirName, 'manifest.json');
        try {
            const file = Bun.file(manifestPath);
            if (await file.exists()) {
                const record = await file.json() as BackupRecord;
                records.push(record);
            }
        } catch {
            // Skip invalid
        }
    }

    return records;
}

/**
 * Restores all files from a specific backup snapshot.
 * Performs a broad restoration of system files from the snapshot directory.
 * 
 * @param snapshotId - Unique ID of the snapshot to restore
 * @param backupRoot - Directory where the snapshot is stored
 * @returns A promise resolving to the list of successfully restored absolute paths
 */
export async function rollback(snapshotId: string, backupRoot: string): Promise<string[]> {
    const snapshotDir = join(backupRoot, snapshotId);
    const manifestPath = join(snapshotDir, 'manifest.json');
    const manifestFile = Bun.file(manifestPath);

    if (!(await manifestFile.exists())) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const record = await manifestFile.json() as BackupRecord;
    const restored: string[] = [];

    for (const file of record.files) {
        const backupFilePath = join(snapshotDir, file.backupPath);
        try {
            const content = await Bun.file(backupFilePath).text();
            writeElevated(file.originalPath, content);
            restored.push(file.originalPath);
        } catch (e: any) {
            console.warn(`Warning: Could not restore ${file.originalPath}: ${e.message}`);
        }
    }

    return restored;
}
