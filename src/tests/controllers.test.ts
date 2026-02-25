import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Tests for the controller layer.
 * Validates that controllers correctly orchestrate engine calls
 * and return properly structured results.
 */
describe('Controllers — Status', () => {
    it('getStatusSnapshot returns a valid SystemProfile', async () => {
        const { getStatusSnapshot } = await import('../controllers/status');
        const profile = await getStatusSnapshot();

        expect(Array.isArray(profile.gpus)).toBe(true);
        expect(typeof profile.isHybrid).toBe('boolean');
        expect(typeof profile.kernelVersion).toBe('string');
        expect(typeof profile.cpuInfo.model).toBe('string');
        expect(typeof profile.memoryStats.total).toBe('number');
    });
});

describe('Controllers — Optimize', () => {
    it('checkImmutability returns null for mutable systems', async () => {
        const { checkImmutability } = await import('../controllers/optimize');
        const result = checkImmutability({
            gpus: [],
            isHybrid: false,
            displayServer: 'Unknown',
            isImmutable: false,
            kernelVersion: '6.18.0',
            bootloader: { type: 'Unknown', configPath: '' },
            initramfs: 'Unknown',
            memory: { hasZram: false, hasZswap: false },
            cpuInfo: { model: 'Test', cores: 4, usagePercent: 0 },
            memoryStats: { total: 0, used: 0, free: 0 },
        });
        expect(result).toBeNull();
    });

    it('checkImmutability returns instructions for immutable systems', async () => {
        const { checkImmutability } = await import('../controllers/optimize');
        const result = checkImmutability({
            gpus: [],
            isHybrid: false,
            displayServer: 'Unknown',
            isImmutable: true,
            immutableType: 'ostree',
            kernelVersion: '6.18.0',
            bootloader: { type: 'Unknown', configPath: '' },
            initramfs: 'Unknown',
            memory: { hasZram: false, hasZswap: false },
            cpuInfo: { model: 'Test', cores: 4, usagePercent: 0 },
            memoryStats: { total: 0, used: 0, free: 0 },
        });
        expect(result).toContain('rpm-ostree');
    });

    it('analyzeOptimizations categorizes rules correctly', async () => {
        const { analyzeOptimizations } = await import('../controllers/optimize');
        const analysis = analyzeOptimizations({
            gpus: [{ vendor: 'Intel', model: 'Test GPU', pciId: '8086:9a60', activeDriver: 'i915' }],
            isHybrid: false,
            displayServer: 'Unknown',
            isImmutable: false,
            kernelVersion: '6.18.0',
            bootloader: { type: 'Unknown', configPath: '' },
            initramfs: 'Unknown',
            memory: { hasZram: false, hasZswap: false },
            cpuInfo: { model: 'Test', cores: 4, usagePercent: 0 },
            memoryStats: { total: 0, used: 0, free: 0 },
        });

        expect(analysis.totalRules).toBeGreaterThan(0);
        expect(analysis.recommended.length + analysis.optional.length).toBe(analysis.totalRules);
    });
});

describe('Controllers — Settings', () => {
    const testConfigBase = join(tmpdir(), `gpu-opt-ctrl-test-${Date.now()}`);

    beforeEach(() => {
        Bun.env.XDG_CONFIG_HOME = testConfigBase;
        Bun.env.XDG_STATE_HOME = join(tmpdir(), `gpu-opt-ctrl-state-${Date.now()}`);
    });

    afterEach(() => {
        try { rmSync(testConfigBase, { recursive: true, force: true }); } catch { }
        try { rmSync(Bun.env.XDG_STATE_HOME!, { recursive: true, force: true }); } catch { }
        delete Bun.env.XDG_CONFIG_HOME;
        delete Bun.env.XDG_STATE_HOME;
    });

    it('getSettings returns defaults on fresh install', async () => {
        const { getSettings } = await import('../controllers/settings');
        const settings = getSettings();
        expect(settings.verbosity).toBe(1);
        expect(settings.dryMode).toBe(false);
    });

    it('updateSettings persists partial changes', async () => {
        const { updateSettings, getSettings } = await import('../controllers/settings');

        updateSettings({ dryMode: true, verbosity: 2 });
        const settings = getSettings();

        expect(settings.dryMode).toBe(true);
        expect(settings.verbosity).toBe(2);
        expect(settings.loggingEnabled).toBe(false);
    });

    it('resetSettings restores defaults', async () => {
        const { updateSettings, resetSettings } = await import('../controllers/settings');

        updateSettings({ dryMode: true });
        const reset = resetSettings();

        expect(reset.dryMode).toBe(false);
        expect(reset.verbosity).toBe(1);
    });
});

describe('Controllers — Backup', () => {
    const testBackupBase = join(tmpdir(), `gpu-opt-backup-ctrl-${Date.now()}`);

    beforeEach(() => {
        mkdirSync(testBackupBase, { recursive: true });
        Bun.env.XDG_STATE_HOME = testBackupBase;
        Bun.env.XDG_CONFIG_HOME = join(tmpdir(), `gpu-opt-config-ctrl-${Date.now()}`);
    });

    afterEach(() => {
        try { rmSync(testBackupBase, { recursive: true, force: true }); } catch { }
        try { rmSync(Bun.env.XDG_CONFIG_HOME!, { recursive: true, force: true }); } catch { }
        delete Bun.env.XDG_STATE_HOME;
        delete Bun.env.XDG_CONFIG_HOME;
    });

    it('listBackups returns empty array when no backups exist', async () => {
        const { listBackups } = await import('../controllers/backup');
        const list = listBackups();
        expect(list).toEqual([]);
    });

    it('deleteBackup throws for non-existent snapshot', async () => {
        const { deleteBackup } = await import('../controllers/backup');
        expect(() => deleteBackup('non-existent-id')).toThrow('Snapshot not found');
    });
});

describe('Controllers — Services', () => {
    it('getAvailableServices works through controller layer', async () => {
        const { getAvailableServices } = await import('../controllers/services');
        const result = getAvailableServices({
            gpus: [{ vendor: 'Intel', model: 'Test', pciId: '8086:9a60', activeDriver: 'i915' }],
            isHybrid: false,
            displayServer: 'Unknown',
            isImmutable: false,
            kernelVersion: '6.18.0',
            bootloader: { type: 'Unknown', configPath: '' },
            initramfs: 'Unknown',
            memory: { hasZram: false, hasZswap: false },
            cpuInfo: { model: 'Test', cores: 4, usagePercent: 0 },
            memoryStats: { total: 0, used: 0, free: 0 },
        });

        expect(result.nvidiaPersistence).toBe(false);
        expect(result.udevPowerManagement).toBe(false);
    });
});
