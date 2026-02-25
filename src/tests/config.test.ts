import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Tests for the XDG-compliant configuration module.
 * Uses a temporary directory as XDG_CONFIG_HOME to avoid polluting the real config.
 */
describe('Config Module', () => {
    const testConfigBase = join(tmpdir(), `gpu-opt-test-config-${Date.now()}`);

    beforeEach(() => {
        Bun.env.XDG_CONFIG_HOME = testConfigBase;
        Bun.env.XDG_STATE_HOME = join(tmpdir(), `gpu-opt-test-state-${Date.now()}`);
    });

    afterEach(() => {
        try { rmSync(testConfigBase, { recursive: true, force: true }); } catch { }
        try { rmSync(Bun.env.XDG_STATE_HOME!, { recursive: true, force: true }); } catch { }
        delete Bun.env.XDG_CONFIG_HOME;
        delete Bun.env.XDG_STATE_HOME;
    });

    it('resolveXdgPath respects XDG environment variable', async () => {
        const { resolveXdgPath } = await import('../config');
        const result = resolveXdgPath('XDG_CONFIG_HOME', '.config', 'config.json');
        expect(result).toBe(join(testConfigBase, 'gpu-optimizer', 'config.json'));
    });

    it('resolveXdgPath falls back to home directory when env is unset', async () => {
        delete Bun.env.XDG_CONFIG_HOME;
        const { resolveXdgPath } = await import('../config');
        const { homedir } = await import('node:os');
        const result = resolveXdgPath('XDG_CONFIG_HOME', '.config', 'config.json');
        expect(result).toBe(join(homedir(), '.config', 'gpu-optimizer', 'config.json'));
    });

    it('getDefaultConfig returns valid defaults', async () => {
        const { getDefaultConfig } = await import('../config');
        const config = getDefaultConfig();

        expect(config.verbosity).toBe(1);
        expect(config.loggingEnabled).toBe(false);
        expect(config.dryMode).toBe(false);
        expect(typeof config.logDirectory).toBe('string');
        expect(typeof config.backupDirectory).toBe('string');
    });

    it('loadConfig returns defaults when no config file exists', async () => {
        const { loadConfig, getDefaultConfig } = await import('../config');
        const config = loadConfig();
        const defaults = getDefaultConfig();

        expect(config.verbosity).toBe(defaults.verbosity);
        expect(config.loggingEnabled).toBe(defaults.loggingEnabled);
        expect(config.dryMode).toBe(defaults.dryMode);
    });

    it('saveConfig creates config file and loadConfig reads it back', async () => {
        const { saveConfig, loadConfig, getConfigPath } = await import('../config');

        const customConfig = {
            verbosity: 2 as const,
            loggingEnabled: true,
            logDirectory: '/tmp/test-logs',
            backupDirectory: '/tmp/test-backups',
            dryMode: true,
        };

        saveConfig(customConfig);

        const configPath = getConfigPath();
        expect(existsSync(configPath)).toBe(true);

        const loaded = loadConfig();
        expect(loaded.verbosity).toBe(2);
        expect(loaded.loggingEnabled).toBe(true);
        expect(loaded.dryMode).toBe(true);
        expect(loaded.logDirectory).toBe('/tmp/test-logs');
        expect(loaded.backupDirectory).toBe('/tmp/test-backups');
    });

    it('loadConfig returns defaults for invalid JSON', async () => {
        const { loadConfig, getConfigPath, getDefaultConfig } = await import('../config');

        const configPath = getConfigPath();
        const dir = join(configPath, '..');
        mkdirSync(dir, { recursive: true });
        writeFileSync(configPath, '{ invalid json }', 'utf-8');

        const config = loadConfig();
        const defaults = getDefaultConfig();
        expect(config.verbosity).toBe(defaults.verbosity);
    });

    it('loadConfig returns defaults for schema-invalid config', async () => {
        const { loadConfig, getConfigPath, getDefaultConfig } = await import('../config');

        const configPath = getConfigPath();
        const dir = join(configPath, '..');
        mkdirSync(dir, { recursive: true });
        writeFileSync(configPath, JSON.stringify({ verbosity: 99, loggingEnabled: 'yes' }), 'utf-8');

        const config = loadConfig();
        const defaults = getDefaultConfig();
        expect(config.verbosity).toBe(defaults.verbosity);
    });

    it('resetConfig overwrites with defaults', async () => {
        const { saveConfig, resetConfig, loadConfig } = await import('../config');

        saveConfig({
            verbosity: 2,
            loggingEnabled: true,
            logDirectory: '/tmp',
            backupDirectory: '/tmp',
            dryMode: true,
        });

        const reset = resetConfig();
        expect(reset.verbosity).toBe(1);
        expect(reset.dryMode).toBe(false);

        const loaded = loadConfig();
        expect(loaded.verbosity).toBe(1);
    });
});
