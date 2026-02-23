import pc from 'picocolors';
import type { SystemProfile, StagedMutation } from '../types';
import { runElevated, stageFile } from '../utils/shell';
import { generateDiff } from './mutate';
import { readFileSync } from 'node:fs';

/**
 * Enables the NVIDIA persistence daemon via systemd.
 *
 * The persistence daemon prevents the NVIDIA kernel module from being
 * unloaded when no GPU clients are active, eliminating the lag caused
 * by module load/unload cycles. This is especially important for
 * hybrid GPU setups where the dGPU may be frequently suspended.
 *
 * @throws If the systemctl command fails
 */
export function enableNvidiaPersistence(): void {
    console.log(pc.cyan('Enabling nvidia-persistenced service...'));
    runElevated('systemctl enable --now nvidia-persistenced');
    console.log(pc.green('nvidia-persistenced enabled and started.'));
}

/**
 * The target path for the GPU power management udev rule.
 */
const UDEV_RULE_PATH = '/etc/udev/rules.d/80-gpu-pm.rules';

/**
 * Generates the content for the GPU power management udev rule.
 *
 * This rule sets PCI power management to "auto" for NVIDIA GPUs,
 * allowing the discrete GPU to enter low-power states when idle.
 * Critical for battery life on hybrid GPU laptops.
 *
 * @returns The udev rule content string
 */
function generateUdevRuleContent(): string {
    return [
        '# GPU Optimizer — PCI Power Management for NVIDIA dGPU',
        '# Allows the discrete GPU to sleep when not in use (hybrid setups)',
        'ACTION=="add", SUBSYSTEM=="pci", ATTR{vendor}=="0x10de", ATTR{power/control}="auto"',
        '',
    ].join('\n');
}

/**
 * Creates a staged mutation for the PCI power management udev rule.
 *
 * Stages a udev rule file that configures automatic power management
 * for NVIDIA discrete GPUs. Returns a `StagedMutation` with the diff
 * for user review before applying.
 *
 * @returns A StagedMutation with the staged rule file and diff
 */
export function stageUdevPowerRule(): StagedMutation {
    const newContent = generateUdevRuleContent();

    let originalContent = '';
    try {
        originalContent = readFileSync(UDEV_RULE_PATH, 'utf-8');
    } catch {
        try {
            originalContent = runElevated(`cat '${UDEV_RULE_PATH}'`);
        } catch {
            /** File doesn't exist yet */
        }
    }

    const stagedPath = stageFile(newContent, 'udev-gpu-pm-');
    const diff = generateDiff(originalContent, newContent);

    return {
        stagedPath,
        targetPath: UDEV_RULE_PATH,
        diff,
    };
}

/**
 * Reloads udev rules after applying new rule files.
 * Executes `udevadm control --reload-rules && udevadm trigger`.
 *
 * @throws If the udevadm commands fail
 */
export function reloadUdevRules(): void {
    console.log(pc.cyan('Reloading udev rules...'));
    runElevated('udevadm control --reload-rules && udevadm trigger');
    console.log(pc.green('Udev rules reloaded.'));
}

/**
 * Determines which Stage 7 services are applicable to the system.
 *
 * @param profile - The SystemProfile from discovery
 * @returns Object indicating which services are available
 */
export function getAvailableServices(profile: SystemProfile): {
    nvidiaPersistence: boolean;
    udevPowerManagement: boolean;
} {
    const hasNvidia = profile.gpus.some(g => g.vendor === 'NVIDIA');

    return {
        nvidiaPersistence: hasNvidia,
        udevPowerManagement: hasNvidia && profile.isHybrid,
    };
}
