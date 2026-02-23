import { describe, it, expect } from 'bun:test';
import { generateOptimizationPlan } from '../engine/matrix';
import type { SystemProfile } from '../types';

/**
 * Creates a minimal SystemProfile with sensible defaults.
 * Override any properties as needed per test case.
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

describe('Optimization Matrix — Intel Rules', () => {
    it('generates i915 modprobe rules for Intel GPU with i915 driver', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'Intel', pciId: '8086:9a60', activeDriver: 'i915' }],
        });

        const plan = generateOptimizationPlan(profile);

        const gucRule = plan.modprobeOptions.find(r => r.id === 'intel-guc-huc-fbc');
        expect(gucRule).toBeDefined();
        expect(gucRule!.value).toBe('options i915 enable_guc=3 enable_fbc=1');
        expect(gucRule!.severity).toBe('recommended');
        expect(gucRule!.target).toBe('modprobe');
    });

    it('generates xe force_probe rule as optional for i915 systems with PCI ID', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'Intel', pciId: '8086:9a60', activeDriver: 'i915' }],
        });

        const plan = generateOptimizationPlan(profile);

        const xeRule = plan.kernelParams.find(r => r.id === 'intel-xe-force-probe');
        expect(xeRule).toBeDefined();
        expect(xeRule!.value).toBe('i915.force_probe=!8086:9a60 xe.force_probe=8086:9a60');
        expect(xeRule!.severity).toBe('optional');
    });

    it('generates xe-active info rule when xe is already the driver', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'Intel', pciId: '8086:9a60', activeDriver: 'xe' }],
        });

        const plan = generateOptimizationPlan(profile);

        expect(plan.modprobeOptions.find(r => r.id === 'intel-xe-active')).toBeDefined();
        expect(plan.kernelParams.find(r => r.id === 'intel-xe-force-probe')).toBeUndefined();
        expect(plan.modprobeOptions.find(r => r.id === 'intel-guc-huc-fbc')).toBeUndefined();
    });
});

describe('Optimization Matrix — NVIDIA Rules', () => {
    it('always generates nvidia-drm.modeset=1', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'NVIDIA', pciId: '10de:25a0', activeDriver: 'nvidia' }],
            displayServer: 'X11',
        });

        const plan = generateOptimizationPlan(profile);

        const modesetRule = plan.kernelParams.find(r => r.id === 'nvidia-drm-modeset');
        expect(modesetRule).toBeDefined();
        expect(modesetRule!.value).toBe('nvidia-drm.modeset=1');
        expect(modesetRule!.severity).toBe('recommended');
    });

    it('generates fbdev rule on Wayland', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'NVIDIA', pciId: '10de:25a0', activeDriver: 'nvidia' }],
            displayServer: 'Wayland',
        });

        const plan = generateOptimizationPlan(profile);

        const fbdevRule = plan.kernelParams.find(r => r.id === 'nvidia-drm-fbdev');
        expect(fbdevRule).toBeDefined();
        expect(fbdevRule!.value).toBe('nvidia-drm.fbdev=1');
        expect(fbdevRule!.severity).toBe('optional');
    });

    it('does not generate fbdev rule on X11', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'NVIDIA', pciId: '10de:25a0', activeDriver: 'nvidia' }],
            displayServer: 'X11',
        });

        const plan = generateOptimizationPlan(profile);
        expect(plan.kernelParams.find(r => r.id === 'nvidia-drm-fbdev')).toBeUndefined();
    });
});

describe('Optimization Matrix — AMD Rules', () => {
    it('generates ppfeaturemask, sg_display, and tmz rules', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'AMD', pciId: '1002:744c', activeDriver: 'amdgpu' }],
        });

        const plan = generateOptimizationPlan(profile);

        const ppRule = plan.kernelParams.find(r => r.id === 'amd-ppfeaturemask');
        expect(ppRule).toBeDefined();
        expect(ppRule!.value).toBe('amdgpu.ppfeaturemask=0xffffffff');
        expect(ppRule!.severity).toBe('optional');

        const sgRule = plan.kernelParams.find(r => r.id === 'amd-sg-display');
        expect(sgRule).toBeDefined();
        expect(sgRule!.value).toBe('amdgpu.sg_display=0');
        expect(sgRule!.severity).toBe('recommended');

        const tmzRule = plan.kernelParams.find(r => r.id === 'amd-tmz');
        expect(tmzRule).toBeDefined();
        expect(tmzRule!.value).toBe('amdgpu.tmz=0');
        expect(tmzRule!.severity).toBe('recommended');
    });
});

describe('Optimization Matrix — Memory Rules', () => {
    it('generates zswap disable when both zram and zswap are present', () => {
        const profile = createProfile({
            memory: { hasZram: true, hasZswap: true },
        });

        const plan = generateOptimizationPlan(profile);

        const zswapRule = plan.kernelParams.find(r => r.id === 'memory-zswap-disable');
        expect(zswapRule).toBeDefined();
        expect(zswapRule!.value).toBe('zswap.enabled=0');
        expect(zswapRule!.vendor).toBe('system');
    });

    it('does not generate zswap rule when only zram is present', () => {
        const profile = createProfile({
            memory: { hasZram: true, hasZswap: false },
        });

        const plan = generateOptimizationPlan(profile);
        expect(plan.kernelParams.find(r => r.id === 'memory-zswap-disable')).toBeUndefined();
    });

    it('does not generate zswap rule when only zswap is present', () => {
        const profile = createProfile({
            memory: { hasZram: false, hasZswap: true },
        });

        const plan = generateOptimizationPlan(profile);
        expect(plan.kernelParams.find(r => r.id === 'memory-zswap-disable')).toBeUndefined();
    });
});

describe('Optimization Matrix — Hybrid Systems', () => {
    it('generates rules for both Intel and NVIDIA on hybrid', () => {
        const profile = createProfile({
            gpus: [
                { vendor: 'Intel', pciId: '8086:9a60', activeDriver: 'i915' },
                { vendor: 'NVIDIA', pciId: '10de:25a0', activeDriver: 'nvidia' },
            ],
            isHybrid: true,
            displayServer: 'Wayland',
        });

        const plan = generateOptimizationPlan(profile);

        expect(plan.modprobeOptions.find(r => r.id === 'intel-guc-huc-fbc')).toBeDefined();
        expect(plan.kernelParams.find(r => r.id === 'nvidia-drm-modeset')).toBeDefined();
        expect(plan.kernelParams.find(r => r.id === 'nvidia-drm-fbdev')).toBeDefined();
    });
});

describe('Optimization Matrix — Edge Cases', () => {
    it('returns empty plan when no GPUs detected', () => {
        const profile = createProfile({ gpus: [] });
        const plan = generateOptimizationPlan(profile);

        expect(plan.kernelParams).toHaveLength(0);
        expect(plan.modprobeOptions).toHaveLength(0);
    });

    it('still generates rules for immutable systems (checked at apply-time)', () => {
        const profile = createProfile({
            gpus: [{ vendor: 'Intel', pciId: '8086:9a60', activeDriver: 'i915' }],
            isImmutable: true,
            immutableType: 'ostree',
        });

        const plan = generateOptimizationPlan(profile);
        expect(plan.modprobeOptions.length).toBeGreaterThan(0);
    });

    it('all rules have required fields populated', () => {
        const profile = createProfile({
            gpus: [
                { vendor: 'Intel', pciId: '8086:9a60', activeDriver: 'i915' },
                { vendor: 'NVIDIA', pciId: '10de:25a0', activeDriver: 'nvidia' },
                { vendor: 'AMD', pciId: '1002:744c', activeDriver: 'amdgpu' },
            ],
            displayServer: 'Wayland',
            memory: { hasZram: true, hasZswap: true },
        });

        const plan = generateOptimizationPlan(profile);
        const allRules = [...plan.kernelParams, ...plan.modprobeOptions];

        for (const rule of allRules) {
            expect(rule.id).toBeTruthy();
            expect(rule.vendor).toBeTruthy();
            expect(rule.description).toBeTruthy();
            expect(rule.value).toBeTruthy();
            expect(['kernel-param', 'modprobe']).toContain(rule.target);
            expect(['recommended', 'optional']).toContain(rule.severity);
        }
    });
});
