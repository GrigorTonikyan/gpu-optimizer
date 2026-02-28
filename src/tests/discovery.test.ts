import { describe, it, expect } from 'bun:test';

describe('Shell Utilities', () => {
    it('runUser executes commands and returns stdout', async () => {
        const { runUser } = await import('../utils/shell');
        const result = runUser('echo hello');
        expect(result).toBe('hello');
    });

    it('runUser throws on failed commands', async () => {
        const { runUser } = await import('../utils/shell');
        expect(() => runUser('false')).toThrow();
    });

    it('stageFile creates a temp file with content', async () => {
        const { stageFile } = await import('../utils/shell');
        const { readFileSync, unlinkSync } = await import('node:fs');

        const filePath = await stageFile('test-content', 'unit-test-');
        expect(filePath).toContain('gpu-optimizer-staging');
        expect(filePath).toContain('unit-test-');

        expect(readFileSync(filePath, 'utf-8')).toBe('test-content');

        unlinkSync(filePath);
    });
});

describe('Discovery — Hardware', () => {
    it('getKernelVersion returns a non-empty string', async () => {
        const { getKernelVersion } = await import('../discovery/hardware');
        const version = getKernelVersion();
        expect(version).toBeTruthy();
        expect(version).not.toBe('Unknown');
    });

    it('detectDisplayServer returns a valid value', async () => {
        const { detectDisplayServer } = await import('../discovery/hardware');
        const server = detectDisplayServer();
        expect(['Wayland', 'X11', 'Unknown']).toContain(server);
    });

    it('detectGPUs returns valid GPU devices', async () => {
        const { detectGPUs } = await import('../discovery/hardware');
        const { gpus, isHybrid } = detectGPUs();

        expect(Array.isArray(gpus)).toBe(true);

        for (const gpu of gpus) {
            expect(['Intel', 'NVIDIA', 'AMD']).toContain(gpu.vendor);
            expect(typeof gpu.model).toBe('string');
            expect(typeof gpu.pciId).toBe('string');
            expect(typeof gpu.activeDriver).toBe('string');
        }

        if (gpus.length > 1) {
            const vendors = new Set(gpus.map(g => g.vendor));
            expect(isHybrid).toBe(vendors.size > 1);
        }
    });
});

describe('Discovery — Bootloader', () => {
    it('detectBootloader returns a valid bootloader type', async () => {
        const { detectBootloader } = await import('../discovery/boot');
        const { getKernelVersion } = await import('../discovery/hardware');

        const kernelVersion = getKernelVersion();
        const bootloader = detectBootloader(kernelVersion);

        expect(['GRUB', 'systemd-boot', 'Unknown']).toContain(bootloader.type);
        expect(typeof bootloader.configPath).toBe('string');
    });
});

describe('Discovery — Initramfs', () => {
    it('detectInitramfs returns a valid generator type', async () => {
        const { detectInitramfs } = await import('../discovery/initramfs');
        const initramfs = detectInitramfs();
        expect(['mkinitcpio', 'dracut', 'update-initramfs', 'Unknown']).toContain(initramfs);
    });
});

describe('Discovery — Memory', () => {
    it('detectMemory returns boolean flags', async () => {
        const { detectMemory } = await import('../discovery/memory');
        const memory = detectMemory();

        expect(typeof memory.hasZram).toBe('boolean');
        expect(typeof memory.hasZswap).toBe('boolean');
    });
});

describe('Discovery — Immutability', () => {
    it('detectImmutability returns valid immutability info', async () => {
        const { detectImmutability } = await import('../discovery/immutability');
        const result = detectImmutability();

        expect(typeof result.isImmutable).toBe('boolean');
        if (result.isImmutable) {
            expect(['ostree', 'steamos', 'nixos']).toContain(result.immutableType!);
        }
    });
});

describe('Discovery — Full Profile', () => {
    it('discoverSystem returns a complete SystemProfile', async () => {
        const { discoverSystem } = await import('../discovery');
        const profile = await discoverSystem();

        expect(Array.isArray(profile.gpus)).toBe(true);
        expect(typeof profile.isHybrid).toBe('boolean');
        expect(['Wayland', 'X11', 'Unknown']).toContain(profile.displayServer);
        expect(typeof profile.isImmutable).toBe('boolean');
        expect(typeof profile.kernelVersion).toBe('string');
        expect(['GRUB', 'systemd-boot', 'Unknown']).toContain(profile.bootloader.type);
        expect(typeof profile.bootloader.configPath).toBe('string');
        expect(['mkinitcpio', 'dracut', 'update-initramfs', 'Unknown']).toContain(profile.initramfs);
        expect(typeof profile.memory.hasZram).toBe('boolean');
        expect(typeof profile.memory.hasZswap).toBe('boolean');

        expect(typeof profile.cpuInfo.model).toBe('string');
        expect(typeof profile.cpuInfo.cores).toBe('number');
        expect(profile.cpuInfo.cores).toBeGreaterThanOrEqual(1);
        expect(typeof profile.cpuInfo.usagePercent).toBe('number');

        expect(typeof profile.memoryStats.total).toBe('number');
        expect(typeof profile.memoryStats.used).toBe('number');
        expect(typeof profile.memoryStats.free).toBe('number');
        expect(profile.memoryStats.total).toBeGreaterThan(0);

        for (const gpu of profile.gpus) {
            expect(typeof gpu.model).toBe('string');
        }
    });
});
