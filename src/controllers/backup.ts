import { join } from 'node:path';
import type { BackupRecord } from '../types';
import {
    initBackupDir,
    createSnapshot as engineCreateSnapshot,
    listSnapshots as engineListSnapshots,
    rollback as engineRollback,
} from '../engine/backup';
import { loadConfig, getBackupDirectory } from '../config';
import { FsService } from '../services/fs';
import { Logger } from '../utils/logger';

/**
 * Triggers a new system backup snapshot.
 * Discovers current configuration files and creates a timestamped archive.
 * 
 * @param filePaths - List of absolute paths to files to back up
 * @returns A promise resolving to the created BackupRecord
 */
export async function createBackup(filePaths: string[]): Promise<BackupRecord> {
    const config = await loadConfig();
    const backupDir = getBackupDirectory(config);
    return engineCreateSnapshot(filePaths, backupDir, config);
}

/**
 * Lists all available backup snapshots, sorted newest-first.
 * Scans primary and secondary backup paths as defined in the config.
 * 
 * @returns A promise resolving to an array of BackupRecords
 */
export async function listBackups(): Promise<BackupRecord[]> {
    const config = await loadConfig();
    const backupDir = getBackupDirectory(config);
    return engineListSnapshots(backupDir);
}

/**
 * Deletes a specific backup snapshot by its ID.
 * Permanently removes the snapshot directory and its contents.
 * 
 * @param snapshotId - The timestamp ID of the snapshot to delete (e.g., "20260228T120000Z")
 * @throws Error if the snapshot directory does not exist or cannot be deleted
 */
export async function deleteBackup(snapshotId: string): Promise<void> {
    const config = await loadConfig();
    const backupDir = getBackupDirectory(config);
    const snapshotDir = join(backupDir, snapshotId);

    if (!(await Bun.file(join(snapshotDir, 'manifest.json')).exists())) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const { rm } = await import('node:fs/promises');
    await rm(snapshotDir, { recursive: true, force: true });
}

/**
 * Exports a backup snapshot as a gzipped tar archive.
 * 
 * @param snapshotId - The ID of the snapshot to export
 * @param outputPath - The destination path for the .tar.gz file
 * @throws Error if the snapshot does not exist or tar fails
 */
export async function exportBackup(snapshotId: string, outputPath: string): Promise<void> {
    const config = await loadConfig();
    const backupDir = getBackupDirectory(config);
    const snapshotDir = join(backupDir, snapshotId);

    if (!(await Bun.file(join(snapshotDir, 'manifest.json')).exists())) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const { success, stderr } = Bun.spawnSync([
        'tar', '-czf', outputPath, '-C', backupDir, snapshotId
    ]);

    if (!success) {
        throw new Error(`Tar export failed: ${stderr.toString().trim()}`);
    }
}

/**
 * Imports a backup archive into the backup directory.
 * 
 * @param archivePath - Path to the .tar.gz backup archive
 * @returns A promise resolving to the imported BackupRecord
 * @throws Error if the archive is invalid or extraction fails
 */
export async function importBackup(archivePath: string): Promise<BackupRecord> {
    const file = Bun.file(archivePath);
    if (!(await file.exists())) {
        throw new Error(`Archive not found: ${archivePath}`);
    }

    const config = await loadConfig();
    const backupDir = getBackupDirectory(config);
    await initBackupDir(backupDir);

    const { success, stderr } = Bun.spawnSync([
        'tar', '-xzf', archivePath, '-C', backupDir
    ]);

    if (!success) {
        throw new Error(`Tar import failed: ${stderr.toString().trim()}`);
    }

    const records = await engineListSnapshots(backupDir);
    const newest = records[0];
    if (newest) {
        return newest;
    }

    throw new Error('Imported archive does not contain a valid backup manifest.');
}

/**
 * Restores the system state from a specific backup snapshot.
 * Overwrites current system files with the versions stored in the backup.
 * 
 * @param snapshotId - The ID of the snapshot to restore
 * @returns A promise resolving to the list of successfully restored absolute file paths
 */
export async function rollbackToSnapshot(snapshotId: string): Promise<string[]> {
    const config = await loadConfig();
    const backupDir = getBackupDirectory(config);
    return engineRollback(snapshotId, backupDir);
}
