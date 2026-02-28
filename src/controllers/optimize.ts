import type { SystemProfile, OptimizationRule, OptimizationPlan, StagedMutation } from '../types';
import { generateOptimizationPlan } from '../engine/matrix';
import { enrichRuleStatus } from '../engine/status';
import { injectGrub, injectSystemdBoot, writeModprobeConfig, applyStaged, triggerRebuild } from '../engine/mutate';
import { createSnapshot } from '../engine/backup';
import { getBackupDirectory, loadConfig } from '../config';
import { Logger } from '../utils/logger';

/**
 * Result returned by the optimization analysis phase.
 * Contains the plan and categorized rules for UI presentation.
 */
export interface OptimizationAnalysis {
    plan: OptimizationPlan;
    recommended: OptimizationRule[];
    optional: OptimizationRule[];
    totalRules: number;
}

/**
 * Result returned by the apply phase.
 */
export interface ApplyResult {
    success: boolean;
    appliedMutations: StagedMutation[];
    backupId?: string;
    error?: string;
}

/**
 * Immutable system instructions keyed by distribution type.
 */
const IMMUTABLE_INSTRUCTIONS: Record<string, string> = {
    ostree: 'Use: rpm-ostree kargs --append=<param> to add kernel parameters',
    steamos: 'SteamOS requires unlocking the filesystem first. Proceed with caution.',
    nixos: 'Add kernel parameters to your NixOS configuration.nix and rebuild',
};

/**
 * Checks whether the system is immutable and returns instructions if so.
 *
 * @param profile - The discovered SystemProfile
 * @returns `null` if the system is mutable, or an instruction string if immutable
 */
export function checkImmutability(profile: SystemProfile): string | null {
    if (!profile.isImmutable) return null;
    return IMMUTABLE_INSTRUCTIONS[profile.immutableType ?? '']
        ?? 'Please use your distribution\'s native method to modify kernel parameters.';
}

/**
 * Analyzes the system and generates the optimization plan.
 * Separates rules into recommended (always applied) and optional (user-selectable).
 *
 * @param profile - The discovered SystemProfile
 * @returns The analysis result with categorized rules
 */
export function analyzeOptimizations(profile: SystemProfile): OptimizationAnalysis {
    const plan = generateOptimizationPlan(profile);
    enrichRuleStatus(plan);
    const allRules = [...plan.kernelParams, ...plan.modprobeOptions];
    const recommended = allRules.filter(r => r.severity === 'recommended');
    const optional = allRules.filter(r => r.severity === 'optional');

    return {
        plan,
        recommended,
        optional,
        totalRules: allRules.length,
    };
}

/**
 * Stages the selected optimizations as file mutations.
 * Returns staged mutations with diffs for user review.
 *
 * @param profile - The discovered SystemProfile
 * @param selectedRules - The rules the user chose to apply
 * @returns Array of staged mutations ready for review
 * @throws If staging fails for bootloader or modprobe configs
 */
export async function stageOptimizations(
    profile: SystemProfile,
    selectedRules: OptimizationRule[]
): Promise<{ mutations: StagedMutation[]; warnings: string[] }> {
    const mutations: StagedMutation[] = [];
    const warnings: string[] = [];

    const kernelParams = selectedRules.filter(r => r.target === 'kernel-param').map(r => r.value);
    const modprobeRules = selectedRules.filter(r => r.target === 'modprobe');

    if (kernelParams.length > 0) {
        if (profile.bootloader.type === 'GRUB') {
            mutations.push(await injectGrub(kernelParams, profile.bootloader.configPath));
        } else if (profile.bootloader.type === 'systemd-boot') {
            if (!profile.bootloader.configPath) {
                warnings.push('systemd-boot detected but entry config path not readable. Kernel param injection requires elevated read access.');
            } else {
                mutations.push(await injectSystemdBoot(kernelParams, profile.bootloader.configPath));
            }
        } else {
            warnings.push('Unknown bootloader — cannot inject kernel parameters automatically.');
        }
    }

    if (modprobeRules.length > 0) {
        mutations.push(await writeModprobeConfig(modprobeRules));
    }

    return { mutations, warnings };
}

/**
 * Applies staged mutations to the system.
 * Creates a backup snapshot first, then writes all staged files with elevation.
 *
 * @param mutations - The staged mutations to apply
 * @returns The apply result including backup ID
 */
export async function applyMutations(mutations: StagedMutation[]): Promise<ApplyResult> {
    try {
        const config = await loadConfig();
        const backupRoot = getBackupDirectory(config);
        const filesToBackup = mutations.map(m => m.targetPath);
        const backup = await createSnapshot(filesToBackup, backupRoot, config);

        if (config.dryMode) {
            Logger.info(`[DRY RUN] Simulation complete for ${mutations.length} mutations.`);
            return {
                success: true,
                appliedMutations: mutations,
                backupId: `${backup.id} (SIMULATED)`,
            };
        }

        for (const mut of mutations) {
            applyStaged(mut);
        }

        return {
            success: true,
            appliedMutations: mutations,
            backupId: backup.id,
        };
    } catch (e: any) {
        return {
            success: false,
            appliedMutations: [],
            error: e.message,
        };
    }
}

/**
 * Triggers an initramfs rebuild using the detected generator.
 *
 * @param profile - The SystemProfile with initramfs and bootloader info
 * @throws If the rebuild command fails
 */
export function rebuildInitramfs(profile: SystemProfile): void {
    triggerRebuild(profile.initramfs, profile.bootloader.type);
}
