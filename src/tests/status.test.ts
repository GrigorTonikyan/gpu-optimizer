import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { checkRuleApplied } from '../engine/status';
import type { OptimizationRule } from '../types';

// Mock node:fs
mock.module('node:fs', () => ({
    readFileSync: (path: string) => {
        if (path === '/proc/cmdline') {
            return 'bootstrap_stuff console=ttyS0 nvidia-drm.modeset=1 intel_pstate=passive';
        }
        if (path === '/etc/modprobe.d/gpu-optimizer.conf') {
            return 'options i915 enable_guc=3\n# comment\noptions nvidia NVreg_PreserveVideoMemoryAllocations=1';
        }
        throw new Error('File not found');
    },
    existsSync: (path: string) => {
        return path === '/etc/modprobe.d/gpu-optimizer.conf';
    }
}));

describe('Status Detection Logic', () => {
    it('detects kernel parameters present in /proc/cmdline', () => {
        const rule: OptimizationRule = {
            id: 'test-rule',
            vendor: 'NVIDIA',
            description: 'test',
            target: 'kernel-param',
            value: 'nvidia-drm.modeset=1',
            severity: 'recommended'
        };

        expect(checkRuleApplied(rule)).toBe(true);
    });

    it('returns false for kernel parameters NOT in /proc/cmdline', () => {
        const rule: OptimizationRule = {
            id: 'test-rule',
            vendor: 'AMD',
            description: 'test',
            target: 'kernel-param',
            value: 'amdgpu.sg_display=0',
            severity: 'recommended'
        };

        expect(checkRuleApplied(rule)).toBe(false);
    });

    it('detects modprobe options in gpu-optimizer.conf', () => {
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
