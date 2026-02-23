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
        ...overrides,
    };
}

describe('Services — getAvailableServices', () => {
    it('returns no services for non-NVIDIA systems', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'Intel', pciId: '8086:9a60', activeDriver: 'i915' }],
        });

        const services = getAvailableServices(profile);
        expect(services.nvidiaPersistence).toBe(false);
        expect(services.udevPowerManagement).toBe(false);
    });

    it('returns nvidiaPersistence for NVIDIA GPU', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'NVIDIA', pciId: '10de:25a0', activeDriver: 'nvidia' }],
        });

        const services = getAvailableServices(profile);
        expect(services.nvidiaPersistence).toBe(true);
        expect(services.udevPowerManagement).toBe(false);
    });

    it('returns both services for hybrid NVIDIA', () => {
        const profile = createProfile({
            gpus: [
                { vendor: 'Intel', pciId: '8086:9a60', activeDriver: 'i915' },
                { vendor: 'NVIDIA', pciId: '10de:25a0', activeDriver: 'nvidia' },
            ],
            isHybrid: true,
        });

        const services = getAvailableServices(profile);
        expect(services.nvidiaPersistence).toBe(true);
        expect(services.udevPowerManagement).toBe(true);
    });

    it('returns no services for AMD-only system', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'AMD', pciId: '1002:744c', activeDriver: 'amdgpu' }],
        });

        const services = getAvailableServices(profile);
        expect(services.nvidiaPersistence).toBe(false);
        expect(services.udevPowerManagement).toBe(false);
    });
});

describe('Services — stageUdevPowerRule', () => {
    it('stages a valid udev rule file', () => {
        const result = stageUdevPowerRule();

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
