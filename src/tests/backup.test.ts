import { expect, it, describe, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
    initBackupDir,
    createSnapshot,
    listSnapshots,
    rollback,
} from '../engine/backup';
import * as shell from '../utils/shell';
import { mock, spyOn } from 'bun:test';

// Mock shell utilities to avoid sudo prompts during testing
spyOn(shell, 'writeElevated').mockImplementation(async (path, content) => {
    // For test purposes, if the path is in /tmp, we can just write it normally
    if (path.startsWith('/tmp')) {
        await Bun.write(path, content);
    }
});
spyOn(shell, 'runElevated').mockImplementation(() => 'mocked content');

const TEST_ROOT = join(tmpdir(), `gpu-opt-backup-test-${Date.now()}`);
const TEST_BACKUP_ROOT = join(TEST_ROOT, 'backups');
const TEST_SOURCE_DIR = join(TEST_ROOT, 'sources');

describe('Backup Engine', () => {
    beforeEach(() => {
        mkdirSync(TEST_SOURCE_DIR, { recursive: true });
        mkdirSync(TEST_BACKUP_ROOT, { recursive: true });
    });

    afterEach(() => {
        rmSync(TEST_ROOT, { recursive: true, force: true });
    });

    it('initBackupDir creates the directory', async () => {
        const dir = await initBackupDir(TEST_BACKUP_ROOT);
        expect(existsSync(dir)).toBe(true);
    });

    it('createSnapshot creates a snapshot with manifest', async () => {
        const testFile = join(TEST_SOURCE_DIR, 'test.conf');
        writeFileSync(testFile, 'content', 'utf-8');

        const record = await createSnapshot([testFile], TEST_BACKUP_ROOT);
        expect(record.id).toBeTruthy();
        expect(record.files).toHaveLength(1);

        const snapshotDir = join(TEST_BACKUP_ROOT, record.id);
        expect(existsSync(snapshotDir)).toBe(true);
        expect(existsSync(join(snapshotDir, 'manifest.json'))).toBe(true);
    });

    it('listSnapshots returns sorted records', async () => {
        const testFile = join(TEST_SOURCE_DIR, 'test.conf');
        writeFileSync(testFile, 'content', 'utf-8');

        await createSnapshot([testFile], TEST_BACKUP_ROOT);
        // Ensure different timestamp
        await new Promise(r => setTimeout(r, 1100));
        await createSnapshot([testFile], TEST_BACKUP_ROOT);

        const snapshots = await listSnapshots(TEST_BACKUP_ROOT);
        expect(snapshots.length).toBe(2);
        // Newest first
        expect(new Date(snapshots[0]!.date).getTime()).toBeGreaterThanOrEqual(new Date(snapshots[1]!.date).getTime());
    });

    it('rollback restores file content', async () => {
        const testFile = join(TEST_SOURCE_DIR, 'restore-me.conf');
        writeFileSync(testFile, 'v1', 'utf-8');

        const record = await createSnapshot([testFile], TEST_BACKUP_ROOT);

        writeFileSync(testFile, 'v2', 'utf-8');
        await rollback(record.id, TEST_BACKUP_ROOT);

        const restored = Bun.file(testFile);
        expect(await restored.text()).toBe('v1');
    });
});
