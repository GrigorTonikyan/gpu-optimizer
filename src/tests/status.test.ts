import { describe, it, expect, mock } from 'bun:test';
import { checkRuleApplied } from '../engine/status';
import type { OptimizationRule } from '../types';

let mockFs: Record<string, string> = {};

// Mock node:fs
mock.module('node:fs', () => ({
    readFileSync: (path: string) => {
        if (mockFs[path]) return mockFs[path];
        throw new Error(`File not found: ${path}`);
    },
    existsSync: (path: string) => {
        return !!mockFs[path];
    }
}));

describe('Status Detection Logic', () => {
    it('detects kernel parameters present in /proc/cmdline', () => {
        mockFs['/proc/cmdline'] = 'BOOT_IMAGE=/vmlinuz-linux root=UUID=123-456 rw quiet nvidia-drm.modeset=1';

        const rule: OptimizationRule = {
            id: 'test-rule',
            vendor: 'NVIDIA',
            target: 'kernel-param',
            value: 'nvidia-drm.modeset=1',
            description: 'Test',
            severity: 'recommended'
        };

        expect(checkRuleApplied(rule)).toBe(true);
    });

    it('detects multiple kernel parameters in a single rule', () => {
        mockFs['/proc/cmdline'] = 'BOOT_IMAGE=/vmlinuz-linux i915.enable_guc=3 i915.enable_fbc=1 quiet';

        const rule: OptimizationRule = {
            id: 'intel-combo',
            vendor: 'Intel',
            target: 'kernel-param',
            value: 'i915.enable_guc=3 i915.enable_fbc=1',
            description: 'Intel Combo',
            severity: 'recommended'
        };

        expect(checkRuleApplied(rule)).toBe(true);
    });

    it('returns false if only some parameters are present', () => {
        mockFs['/proc/cmdline'] = 'BOOT_IMAGE=/vmlinuz-linux i915.enable_guc=3 quiet';

        const rule: OptimizationRule = {
            id: 'intel-combo',
            vendor: 'Intel',
            target: 'kernel-param',
            value: 'i915.enable_guc=3 i915.enable_fbc=1',
            description: 'Intel Combo',
            severity: 'recommended'
        };

        expect(checkRuleApplied(rule)).toBe(false);
    });

    it('returns false for kernel parameters NOT in /proc/cmdline', () => {
        mockFs['/proc/cmdline'] = 'BOOT_IMAGE=/vmlinuz-linux quiet';

        const rule: OptimizationRule = {
            id: 'test-rule',
            vendor: 'NVIDIA',
            target: 'kernel-param',
            value: 'nvidia-drm.modeset=1',
            description: 'Test',
            severity: 'recommended'
        };

        expect(checkRuleApplied(rule)).toBe(false);
    });

    it('detects modprobe options in gpu-optimizer.conf', () => {
        mockFs['/etc/modprobe.d/gpu-optimizer.conf'] = 'options i915 enable_guc=3';

        const rule: OptimizationRule = {
            id: 'test-rule',
            vendor: 'Intel',
            description: 'test',
            target: 'modprobe',
            value: 'options i915 enable_guc=3',
            severity: 'recommended'
        };

        expect(checkRuleApplied(rule)).toBe(true);
    });

    it('returns false for modprobe options NOT in gpu-optimizer.conf', () => {
        mockFs['/etc/modprobe.d/gpu-optimizer.conf'] = 'options i915 enable_guc=3';

        const rule: OptimizationRule = {
            id: 'test-rule',
            vendor: 'NVIDIA',
            description: 'test',
            target: 'modprobe',
            value: 'options nvidia-drm modeset=1',
            severity: 'recommended'
        };

        expect(checkRuleApplied(rule)).toBe(false);
    });
});
