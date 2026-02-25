import { describe, it, expect } from 'bun:test';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateDiff, injectGrub, injectSystemdBoot, writeModprobeConfig } from '../engine/mutate';
import type { OptimizationRule } from '../types';

/**
 * Creates a temporary file with the given content for testing.
 * @returns The absolute path to the created temp file
 */
function createTempFile(content: string, prefix = 'test-'): string {
    const dir = join(tmpdir(), 'gpu-opt-mutate-test');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${prefix}${crypto.randomUUID().slice(0, 8)}.conf`);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

describe('Mutation Engine — generateDiff', () => {
    it('shows unchanged lines with space prefix', () => {
        const diff = generateDiff('line1\nline2', 'line1\nline2');
        expect(diff).toContain('  line1');
        expect(diff).toContain('  line2');
    });

    it('shows removed lines in red and added lines in green', () => {
        const diff = generateDiff('old-line', 'new-line');
        expect(diff).toContain('old-line');
        expect(diff).toContain('new-line');
    });

    it('handles empty original (all-new content)', () => {
        const diff = generateDiff('', 'new-content');
        expect(diff).toContain('new-content');
    });

    it('handles empty modified (all-removed content)', () => {
        const diff = generateDiff('old-content', '');
        expect(diff).toContain('old-content');
    });
});

describe('Mutation Engine — injectGrub', () => {
    it('appends parameters to GRUB_CMDLINE_LINUX_DEFAULT', () => {
        const grubContent = [
            '# GRUB config',
            'GRUB_DEFAULT=0',
            'GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"',
            'GRUB_TIMEOUT=5',
        ].join('\n');

        const configPath = createTempFile(grubContent, 'grub-');
        const result = injectGrub(['nvidia-drm.modeset=1'], configPath);

        const staged = readFileSync(result.stagedPath, 'utf-8');
        expect(staged).toContain('nvidia-drm.modeset=1');
        expect(staged).toContain('quiet');
        expect(staged).toContain('splash');
        expect(result.targetPath).toBe(configPath);
        expect(result.diff).toBeTruthy();

        unlinkSync(result.stagedPath);
        unlinkSync(configPath);
    });

    it('deduplicates existing parameters', () => {
        const grubContent = 'GRUB_CMDLINE_LINUX_DEFAULT="quiet nvidia-drm.modeset=0"';
        const configPath = createTempFile(grubContent, 'grub-dedup-');

        const result = injectGrub(['nvidia-drm.modeset=1'], configPath);
        const staged = readFileSync(result.stagedPath, 'utf-8');

        /** Should have modeset=1 (new), not modeset=0 (old) */
        expect(staged).toContain('nvidia-drm.modeset=1');
        expect(staged).not.toContain('nvidia-drm.modeset=0');

        unlinkSync(result.stagedPath);
        unlinkSync(configPath);
    });

    it('preserves other lines in the config', () => {
        const grubContent = [
            'GRUB_DEFAULT=0',
            'GRUB_CMDLINE_LINUX_DEFAULT="quiet"',
            'GRUB_TIMEOUT=5',
        ].join('\n');

        const configPath = createTempFile(grubContent, 'grub-preserve-');
        const result = injectGrub(['test.param=1'], configPath);
        const staged = readFileSync(result.stagedPath, 'utf-8');

        expect(staged).toContain('GRUB_DEFAULT=0');
        expect(staged).toContain('GRUB_TIMEOUT=5');

        unlinkSync(result.stagedPath);
        unlinkSync(configPath);
    });

    it('throws when GRUB_CMDLINE_LINUX_DEFAULT is not found', () => {
        const configPath = createTempFile('GRUB_DEFAULT=0\nGRUB_TIMEOUT=5', 'grub-nodefault-');
        expect(() => injectGrub(['param=1'], configPath)).toThrow('Could not find GRUB_CMDLINE_LINUX_DEFAULT');
        unlinkSync(configPath);
    });
});

describe('Mutation Engine — injectSystemdBoot', () => {
    it('appends parameters to the options line', () => {
        const bootContent = [
            'title   Arch Linux',
            'linux   /vmlinuz-linux',
            'initrd  /initramfs-linux.img',
            'options root=UUID=abc-123 rw quiet',
        ].join('\n');

        const configPath = createTempFile(bootContent, 'sdboot-');
        const result = injectSystemdBoot(['nvidia-drm.modeset=1'], configPath);
        const staged = readFileSync(result.stagedPath, 'utf-8');

        expect(staged).toContain('nvidia-drm.modeset=1');
        expect(staged).toContain('root=UUID=abc-123');
        expect(staged).toContain('rw');

        unlinkSync(result.stagedPath);
        unlinkSync(configPath);
    });

    it('deduplicates existing parameters', () => {
        const bootContent = 'options root=UUID=abc rw nvidia-drm.modeset=0';
        const configPath = createTempFile(bootContent, 'sdboot-dedup-');

        const result = injectSystemdBoot(['nvidia-drm.modeset=1'], configPath);
        const staged = readFileSync(result.stagedPath, 'utf-8');

        expect(staged).toContain('nvidia-drm.modeset=1');
        expect(staged).not.toContain('nvidia-drm.modeset=0');

        unlinkSync(result.stagedPath);
        unlinkSync(configPath);
    });

    it('throws when no options line is found', () => {
        const configPath = createTempFile('title Arch\nlinux /vmlinuz', 'sdboot-noopts-');
        expect(() => injectSystemdBoot(['param=1'], configPath)).toThrow("Could not find 'options' line");
        unlinkSync(configPath);
    });
});

describe('Mutation Engine — writeModprobeConfig', () => {
    it('generates modprobe config with rule values', () => {
        const rules: OptimizationRule[] = [
            {
                id: 'intel-guc',
                vendor: 'Intel',
                description: 'Enable GuC/HuC',
                target: 'modprobe',
                value: 'options i915 enable_guc=3 enable_fbc=1',
                severity: 'recommended',
            },
        ];

        const result = writeModprobeConfig(rules);
        const staged = readFileSync(result.stagedPath, 'utf-8');

        expect(staged).toContain('options i915 enable_guc=3 enable_fbc=1');
        expect(staged).toContain('GPU Optimizer');
        expect(result.targetPath).toBe('/etc/modprobe.d/gpu-optimizer.conf');

        unlinkSync(result.stagedPath);
    });

    it('handles multiple rules', () => {
        const rules: OptimizationRule[] = [
            { id: 'r1', vendor: 'Intel', description: 'd1', target: 'modprobe', value: 'options i915 enable_guc=3', severity: 'recommended' },
            { id: 'r2', vendor: 'Intel', description: 'd2', target: 'modprobe', value: 'options xe', severity: 'optional' },
        ];

        const result = writeModprobeConfig(rules);
        const staged = readFileSync(result.stagedPath, 'utf-8');

        expect(staged).toContain('options i915 enable_guc=3');
        expect(staged).toContain('options xe');

        unlinkSync(result.stagedPath);
    });

    it('returns a diff for new file creation', () => {
        const rules: OptimizationRule[] = [
            { id: 'r1', vendor: 'AMD', description: 'd1', target: 'modprobe', value: 'options amdgpu ppfeaturemask=0xffffffff', severity: 'optional' },
        ];

        const result = writeModprobeConfig(rules);
        expect(result.diff).toBeTruthy();

        unlinkSync(result.stagedPath);
    });
});
