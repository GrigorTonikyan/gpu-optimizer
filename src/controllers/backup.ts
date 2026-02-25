import { existsSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { BackupRecord } from '../types';
import {
    initBackupDir,
    createSnapshot as engineCreateSnapshot,
    listSnapshots as engineListSnapshots,
    rollback as engineRollback,
} from '../engine/backup';
import { loadConfig } from '../config';

/**
 * Creates a manual backup snapshot of the specified system files.
 *
 * @param filePaths - Absolute paths to files to back up
 * @returns The BackupRecord describing the new snapshot
 */
export function createBackup(filePaths: string[]): BackupRecord {
    const config = loadConfig();
    return engineCreateSnapshot(filePaths, config.backupDirectory);
}

/**
 * Lists all available backup snapshots, sorted newest-first.
 *
 * @returns Array of BackupRecords
 */
export function listBackups(): BackupRecord[] {
    const config = loadConfig();
    return engineListSnapshots(config.backupDirectory);
}

/**
 * Deletes a specific backup snapshot by its ID.
 *
 * @param snapshotId - The timestamp ID of the snapshot to delete
 * @throws If the snapshot directory does not exist
 */
export function deleteBackup(snapshotId: string): void {
    const config = loadConfig();
    const snapshotDir = join(config.backupDirectory, snapshotId);

    if (!existsSync(snapshotDir)) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    rmSync(snapshotDir, { recursive: true, force: true });
}

/**
 * Exports a backup snapshot as a gzipped tar archive.
 * Uses `Bun.Archive` when available, otherwise falls back to system `tar`.
 *
 * @param snapshotId - The timestamp ID of the snapshot to export
 * @param outputPath - Absolute path for the output `.tar.gz` file
 * @throws If the snapshot does not exist or tar creation fails
 */
export function exportBackup(snapshotId: string, outputPath: string): void {
    const config = loadConfig();
    const snapshotDir = join(config.backupDirectory, snapshotId);

    if (!existsSync(snapshotDir)) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const { success, stderr } = Bun.spawnSync([
        'tar', '-czf', outputPath, '-C', config.backupDirectory, snapshotId
    ]);

    if (!success) {
        throw new Error(`Tar export failed: ${stderr.toString().trim()}`);
    }
}

/**
 * Imports a backup archive into the backup directory.
 * Extracts the tar.gz archive and validates the manifest.
 *
 * @param archivePath - Absolute path to the `.tar.gz` archive to import
 * @throws If the archive does not exist, extraction fails, or manifest is invalid
 */
export function importBackup(archivePath: string): BackupRecord {
    if (!existsSync(archivePath)) {
        throw new Error(`Archive not found: ${archivePath}`);
    }

    const config = loadConfig();
    initBackupDir(config.backupDirectory);

    const { success, stderr } = Bun.spawnSync([
        'tar', '-xzf', archivePath, '-C', config.backupDirectory
    ]);

    if (!success) {
        throw new Error(`Tar import failed: ${stderr.toString().trim()}`);
    }

    /**
     * The extracted directory name is the snapshot ID.
     * We need to find the newly extracted directory and validate its manifest.
     */
    const entries = readdirSync(config.backupDirectory, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse();

    for (const dirName of entries) {
        const manifestPath = join(config.backupDirectory, dirName, 'manifest.json');
        if (existsSync(manifestPath)) {
            try {
                const raw = readFileSync(manifestPath, 'utf-8');
                return JSON.parse(raw) as BackupRecord;
            } catch {
                continue;
            }
        }
    }

    throw new Error('Imported archive does not contain a valid backup manifest.');
}

/**
 * Restores files from a backup snapshot and returns the list of restored paths.
 *
 * @param snapshotId - The timestamp ID of the snapshot to restore
 * @returns Array of absolute file paths that were restored
 */
export function rollbackToSnapshot(snapshotId: string): string[] {
    const config = loadConfig();
    return engineRollback(snapshotId, config.backupDirectory);
}
