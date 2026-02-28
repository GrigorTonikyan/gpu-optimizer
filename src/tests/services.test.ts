import { describe, it, expect } from 'bun:test';
import { readFileSync, unlinkSync } from 'node:fs';
import { getAvailableServices, stageUdevPowerRule } from '../engine/services';
import type { SystemProfile } from '../types';

/**
 * Creates a minimal SystemProfile with sensible defaults.
 */
function createProfile(overrides: Partial<SystemProfile> = {}): SystemProfile {
    return {
        gpus: [],
        isHybrid: false,
        displayServer: 'Unknown',
        isImmutable: false,
        kernelVersion: '6.18.0-test',
        bootloader: { type: 'Unknown', configPath: '' },
        initramfs: 'Unknown',
        memory: { hasZram: false, hasZswap: false },
        cpuInfo: { model: 'Test CPU', cores: 4, usagePercent: 0 },
        memoryStats: { total: 16 * 1024 * 1024 * 1024, used: 8 * 1024 * 1024 * 1024, free: 8 * 1024 * 1024 * 1024 },
        ...overrides,
    };
}

describe('Services — getAvailableServices', () => {
    it('returns no services for non-NVIDIA systems', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'Intel', model: 'Test Intel GPU', pciId: '8086:9a60', activeDriver: 'i915' }],
        });

        const services = getAvailableServices(profile);
        expect(services.nvidiaPersistence).toBe(false);
        expect(services.udevPowerManagement).toBe(false);
    });

    it('returns nvidiaPersistence for NVIDIA GPU', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'NVIDIA', model: 'Test NVIDIA GPU', pciId: '10de:25a0', activeDriver: 'nvidia' }],
        });

        const services = getAvailableServices(profile);
        expect(services.nvidiaPersistence).toBe(true);
        expect(services.udevPowerManagement).toBe(false);
    });

    it('returns both services for hybrid NVIDIA', () => {
        const profile = createProfile({
            gpus: [
                { vendor: 'Intel', model: 'Test Intel GPU', pciId: '8086:9a60', activeDriver: 'i915' },
                { vendor: 'NVIDIA', model: 'Test NVIDIA GPU', pciId: '10de:25a0', activeDriver: 'nvidia' },
            ],
            isHybrid: true,
        });

        const services = getAvailableServices(profile);
        expect(services.nvidiaPersistence).toBe(true);
        expect(services.udevPowerManagement).toBe(true);
    });

    it('returns no services for AMD-only system', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'AMD', model: 'Test AMD GPU', pciId: '1002:744c', activeDriver: 'amdgpu' }],
        });

        const services = getAvailableServices(profile);
        expect(services.nvidiaPersistence).toBe(false);
        expect(services.udevPowerManagement).toBe(false);
    });
});

describe('Services — stageUdevPowerRule', () => {
    it('stages a valid udev rule file', async () => {
        const result = await stageUdevPowerRule();

        expect(result.targetPath).toBe('/etc/udev/rules.d/80-gpu-pm.rules');
        expect(result.stagedPath).toBeTruthy();
        expect(result.diff).toBeTruthy();

        const content = readFileSync(result.stagedPath, 'utf-8');
        expect(content).toContain('ATTR{vendor}=="0x10de"');
        expect(content).toContain('power/control');
        expect(content).toContain('GPU Optimizer');

        unlinkSync(result.stagedPath);
    });
});
