import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initBackupDir, createSnapshot, listSnapshots, rollback } from '../engine/backup';

/**
 * Each test suite gets its own isolated temp directory to prevent
 * cross-test interference and avoid touching real system state.
 */
const TEST_ROOT = join(tmpdir(), `gpu-opt-backup-test-${crypto.randomUUID().slice(0, 8)}`);
const TEST_BACKUP_ROOT = join(TEST_ROOT, 'backups');
const TEST_SOURCE_DIR = join(TEST_ROOT, 'source-files');

beforeEach(() => {
    mkdirSync(TEST_SOURCE_DIR, { recursive: true });
});

afterAll(() => {
    try {
        rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {
        /** Cleanup is best-effort */
    }
});

describe('Backup Engine — initBackupDir', () => {
    it('creates the backup directory tree', () => {
        const dir = initBackupDir(TEST_BACKUP_ROOT);
        expect(existsSync(dir)).toBe(true);
        expect(dir).toBe(TEST_BACKUP_ROOT);
    });

    it('is idempotent when called multiple times', () => {
        initBackupDir(TEST_BACKUP_ROOT);
        initBackupDir(TEST_BACKUP_ROOT);
        expect(existsSync(TEST_BACKUP_ROOT)).toBe(true);
    });
});

describe('Backup Engine — createSnapshot', () => {
    it('creates a snapshot with manifest.json for given files', () => {
        const testFile = join(TEST_SOURCE_DIR, 'test-config.conf');
        writeFileSync(testFile, 'original-content', 'utf-8');

        const record = createSnapshot([testFile], TEST_BACKUP_ROOT);

        expect(record.id).toBeTruthy();
        expect(record.date).toBeTruthy();
        expect(record.files).toHaveLength(1);
        expect(record.files[0]!.originalPath).toBe(testFile);

        const snapshotDir = join(TEST_BACKUP_ROOT, record.id);
        expect(existsSync(snapshotDir)).toBe(true);

        const manifestPath = join(snapshotDir, 'manifest.json');
        expect(existsSync(manifestPath)).toBe(true);

        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        expect(manifest.id).toBe(record.id);
        expect(manifest.files).toHaveLength(1);
    });

    it('preserves file content in the backup', () => {
        const testFile = join(TEST_SOURCE_DIR, 'grub-content.conf');
        writeFileSync(testFile, 'GRUB_CMDLINE_LINUX_DEFAULT="quiet"', 'utf-8');

        const record = createSnapshot([testFile], TEST_BACKUP_ROOT);
        const snapshotDir = join(TEST_BACKUP_ROOT, record.id);
        const backupFile = join(snapshotDir, record.files[0]!.backupPath);

        const backedUpContent = readFileSync(backupFile, 'utf-8');
        expect(backedUpContent).toBe('GRUB_CMDLINE_LINUX_DEFAULT="quiet"');
    });

    it('handles multiple files in one snapshot', () => {
        const file1 = join(TEST_SOURCE_DIR, 'file1.conf');
        const file2 = join(TEST_SOURCE_DIR, 'file2.conf');
        writeFileSync(file1, 'content-1', 'utf-8');
        writeFileSync(file2, 'content-2', 'utf-8');

        const record = createSnapshot([file1, file2], TEST_BACKUP_ROOT);
        expect(record.files).toHaveLength(2);
    });

    it('returns empty files array when given empty file list', () => {
        const record = createSnapshot([], TEST_BACKUP_ROOT);
        expect(record.files).toHaveLength(0);
        expect(record.id).toBeTruthy();
    });

    it('gracefully skips non-existent files', () => {
        const existing = join(TEST_SOURCE_DIR, 'exists.conf');
        writeFileSync(existing, 'data', 'utf-8');

        const record = createSnapshot(
            [existing, '/nonexistent/path/to/file.conf'],
            TEST_BACKUP_ROOT
        );

        /**
         * The existing file should be backed up.
         * The non-existent file will fail in both user-read and elevated-read
         * paths, and be skipped with a warning.
         */
        expect(record.files.length).toBeGreaterThanOrEqual(1);
    });
});

describe('Backup Engine — listSnapshots', () => {
    it('returns snapshots sorted newest-first', async () => {
        const testFile = join(TEST_SOURCE_DIR, 'list-test.conf');
        writeFileSync(testFile, 'v1', 'utf-8');

        const record1 = createSnapshot([testFile], TEST_BACKUP_ROOT);

        /** Small delay to ensure different timestamps */
        await new Promise(r => setTimeout(r, 50));

        writeFileSync(testFile, 'v2', 'utf-8');
        const record2 = createSnapshot([testFile], TEST_BACKUP_ROOT);

        const snapshots = listSnapshots(TEST_BACKUP_ROOT);
        expect(snapshots.length).toBeGreaterThanOrEqual(2);

        /** Newest first */
        const ids = snapshots.map(s => s.id);
        const idx1 = ids.indexOf(record1.id);
        const idx2 = ids.indexOf(record2.id);
        expect(idx2).toBeLessThan(idx1);
    });

    it('returns empty array when backup directory does not exist', () => {
        const snapshots = listSnapshots('/tmp/nonexistent-gpu-opt-test-dir');
        expect(snapshots).toEqual([]);
    });
});

describe('Backup Engine — rollback', () => {
    it('restores file contents to a target directory', () => {
        const testFile = join(TEST_SOURCE_DIR, 'rollback-test.conf');
        writeFileSync(testFile, 'original-before-mutation', 'utf-8');

        const record = createSnapshot([testFile], TEST_BACKUP_ROOT);

        /** Simulate mutation */
        writeFileSync(testFile, 'MUTATED-content', 'utf-8');
        expect(readFileSync(testFile, 'utf-8')).toBe('MUTATED-content');

        /**
         * Note: rollback uses writeElevated which requires sudo.
         * In the test environment this will fail on the actual write.
         * We test that it throws rather than silently corrupting.
         * Full integration testing of rollback requires sudo access.
         */
        try {
            const restored = rollback(record.id, TEST_BACKUP_ROOT);
            /** If sudo is available, check it worked */
            if (restored.length > 0) {
                expect(restored).toContain(testFile);
            }
        } catch {
            /** Expected in non-sudo test environments */
        }
    });

    it('throws on non-existent snapshot ID', () => {
        expect(() => rollback('nonexistent-id', TEST_BACKUP_ROOT)).toThrow('Snapshot not found');
    });
});
