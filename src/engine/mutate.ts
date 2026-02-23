import { readFileSync } from 'node:fs';
import pc from 'picocolors';
import type { InitramfsType, OptimizationRule, StagedMutation } from '../types';
import { stageFile, writeElevated, runElevated } from '../utils/shell';

/**
 * Deduplicates kernel parameters by key.
 * Parameters are split by spaces, and for `key=value` pairs only the
 * last occurrence of a given key is kept. Bare flags are always kept.
 *
 * @param existing - Space-separated string of existing parameters
 * @param toAdd - Array of new parameter strings to merge in
 * @returns Merged, deduplicated parameter string
 */
function mergeParams(existing: string, toAdd: string[]): string {
    const existingParts = existing.split(/\s+/).filter(Boolean);
    const merged = new Map<string, string>();

    for (const part of existingParts) {
        const key = part.split('=')[0]!;
        merged.set(key, part);
    }

    for (const param of toAdd) {
        const parts = param.split(/\s+/).filter(Boolean);
        for (const part of parts) {
            const key = part.split('=')[0]!;
            merged.set(key, part);
        }
    }

    return Array.from(merged.values()).join(' ');
}

/**
 * Generates a color-coded unified diff between two text contents.
 * Lines present only in the original are shown in red (prefixed with `-`),
 * lines present only in the modified are shown in green (prefixed with `+`),
 * and unchanged lines are shown with a space prefix.
 *
 * @param original - The original file content
 * @param modified - The modified file content
 * @returns A string suitable for terminal display with ANSI color codes
 */
export function generateDiff(original: string, modified: string): string {
    const oldLines = original.split('\n');
    const newLines = modified.split('\n');
    const output: string[] = [];

    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];

        if (oldLine === newLine) {
            output.push(`  ${oldLine ?? ''}`);
        } else {
            if (oldLine !== undefined) {
                output.push(pc.red(`- ${oldLine}`));
            }
            if (newLine !== undefined) {
                output.push(pc.green(`+ ${newLine}`));
            }
        }
    }

    return output.join('\n');
}

/**
 * Injects kernel parameters into a GRUB configuration file.
 *
 * Parses `/etc/default/grub`, locates the `GRUB_CMDLINE_LINUX_DEFAULT` line,
 * appends the given parameters (deduplicating by key), writes the result
 * to a staging file, and returns a `StagedMutation` with the diff.
 *
 * @param params - Array of kernel parameter strings to inject (e.g., `["nvidia-drm.modeset=1"]`)
 * @param configPath - Absolute path to the GRUB config file (usually `/etc/default/grub`)
 * @returns A StagedMutation with the staged file path, target path, and diff
 * @throws If the config file cannot be read or the GRUB_CMDLINE_LINUX_DEFAULT line is not found
 */
export function injectGrub(params: string[], configPath: string): StagedMutation {
    let content: string;
    try {
        content = readFileSync(configPath, 'utf-8');
    } catch {
        content = runElevated(`cat '${configPath.replace(/'/g, "'\\''")}'`);
    }

    const lines = content.split('\n');
    let modified = false;

    const updatedLines = lines.map(line => {
        const match = line.match(/^(GRUB_CMDLINE_LINUX_DEFAULT\s*=\s*)"(.*)"(.*)$/);
        if (match) {
            modified = true;
            const prefix = match[1]!;
            const existingParams = match[2]!;
            const suffix = match[3] ?? '';
            const merged = mergeParams(existingParams, params);
            return `${prefix}"${merged}"${suffix}`;
        }
        return line;
    });

    if (!modified) {
        throw new Error(`Could not find GRUB_CMDLINE_LINUX_DEFAULT in ${configPath}`);
    }

    const newContent = updatedLines.join('\n');
    const stagedPath = stageFile(newContent, 'grub-');
    const diff = generateDiff(content, newContent);

    return { stagedPath, targetPath: configPath, diff };
}

/**
 * Injects kernel parameters into a systemd-boot entry configuration file.
 *
 * Parses the `.conf` file, locates the `options` line, appends the given
 * parameters (deduplicating by key), writes the result to a staging file,
 * and returns a `StagedMutation` with the diff.
 *
 * @param params - Array of kernel parameter strings to inject
 * @param configPath - Absolute path to the systemd-boot entry `.conf` file
 * @returns A StagedMutation with the staged file path, target path, and diff
 * @throws If the config file cannot be read or no `options` line is found
 */
export function injectSystemdBoot(params: string[], configPath: string): StagedMutation {
    let content: string;
    try {
        content = readFileSync(configPath, 'utf-8');
    } catch {
        content = runElevated(`cat '${configPath.replace(/'/g, "'\\''")}'`);
    }

    const lines = content.split('\n');
    let modified = false;

    const updatedLines = lines.map(line => {
        const match = line.match(/^(options\s+)(.*)$/);
        if (match) {
            modified = true;
            const prefix = match[1]!;
            const existingParams = match[2]!;
            const merged = mergeParams(existingParams, params);
            return `${prefix}${merged}`;
        }
        return line;
    });

    if (!modified) {
        throw new Error(`Could not find 'options' line in ${configPath}`);
    }

    const newContent = updatedLines.join('\n');
    const stagedPath = stageFile(newContent, 'sdboot-');
    const diff = generateDiff(content, newContent);

    return { stagedPath, targetPath: configPath, diff };
}

/**
 * Writes modprobe optimization rules to a staged config file.
 *
 * Creates a `/etc/modprobe.d/gpu-optimizer.conf` staging file containing
 * all modprobe-type rules. Each rule's value is written as a line in the file.
 *
 * @param rules - Array of OptimizationRules where target === 'modprobe'
 * @returns A StagedMutation with the staged file path, target path, and diff
 */
export function writeModprobeConfig(rules: OptimizationRule[]): StagedMutation {
    const targetPath = '/etc/modprobe.d/gpu-optimizer.conf';

    const header = [
        '# GPU Optimizer — Auto-generated modprobe configuration',
        '# Managed by universal-gpu-optimizer. Do not edit manually.',
        '',
    ];

    const ruleLines = rules.map(r => r.value);
    const newContent = [...header, ...ruleLines, ''].join('\n');

    let originalContent = '';
    try {
        originalContent = readFileSync(targetPath, 'utf-8');
    } catch {
        try {
            originalContent = runElevated(`cat '${targetPath}'`);
        } catch {
            /** File doesn't exist yet — that's fine, diff will show all-new content */
        }
    }

    const stagedPath = stageFile(newContent, 'modprobe-');
    const diff = generateDiff(originalContent, newContent);

    return { stagedPath, targetPath, diff };
}

/**
 * Applies a staged mutation by writing the staged file to its target path
 * using elevated privileges.
 *
 * @param staged - The StagedMutation to apply
 */
export function applyStaged(staged: StagedMutation): void {
    const content = readFileSync(staged.stagedPath, 'utf-8');
    writeElevated(staged.targetPath, content);
}

/**
 * Prints a Boot Rescue Guide to the terminal.
 *
 * This MUST be shown before any initramfs rebuild to inform the user
 * how to recover if a kernel parameter causes a boot failure.
 *
 * @param bootloaderType - The detected bootloader type for tailored instructions
 */
function printBootRescueGuide(bootloaderType: string): void {
    console.log('');
    console.log(pc.bold(pc.yellow('━━━ BOOT RESCUE GUIDE ━━━')));
    console.log('');
    console.log(pc.yellow('If your system fails to boot after these changes:'));
    console.log('');

    if (bootloaderType === 'GRUB') {
        console.log(pc.white('  1. At the GRUB menu, press ') + pc.bold('e') + pc.white(' to edit the boot entry'));
        console.log(pc.white('  2. Find the line starting with ') + pc.bold('linux'));
        console.log(pc.white('  3. Remove the parameters that were just added'));
        console.log(pc.white('  4. Press ') + pc.bold('F10') + pc.white(' to boot with the temporary changes'));
        console.log(pc.white('  5. Once booted, run this tool again and use ') + pc.bold('Rollback') + pc.white(' to undo'));
    } else if (bootloaderType === 'systemd-boot') {
        console.log(pc.white('  1. At the systemd-boot menu, press ') + pc.bold('e') + pc.white(' to edit the boot entry'));
        console.log(pc.white('  2. Remove the parameters that were just added from the ') + pc.bold('options') + pc.white(' line'));
        console.log(pc.white('  3. Press ') + pc.bold('Enter') + pc.white(' to boot with the temporary changes'));
        console.log(pc.white('  4. Once booted, run this tool again and use ') + pc.bold('Rollback') + pc.white(' to undo'));
    } else {
        console.log(pc.white('  1. Access your bootloader menu during startup'));
        console.log(pc.white('  2. Edit the boot entry and remove recently added kernel parameters'));
        console.log(pc.white('  3. Boot with the temporary changes'));
        console.log(pc.white('  4. Once booted, run this tool again and use ') + pc.bold('Rollback') + pc.white(' to undo'));
    }

    console.log('');
    console.log(pc.bold(pc.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━')));
    console.log('');
}

/**
 * Triggers an initramfs rebuild using the system's detected generator.
 *
 * Prints a Boot Rescue Guide before executing the rebuild command.
 * The rebuild is executed with elevated privileges via `runElevated`.
 *
 * @param initramfs - The detected initramfs generator type
 * @param bootloaderType - The bootloader type (for rescue guide instructions)
 * @throws If the initramfs type is unknown or the rebuild command fails
 */
export function triggerRebuild(initramfs: InitramfsType, bootloaderType = 'Unknown'): void {
    printBootRescueGuide(bootloaderType);

    const commands: Record<string, string> = {
        'mkinitcpio': 'mkinitcpio -P',
        'dracut': 'dracut --force',
        'update-initramfs': 'update-initramfs -u',
    };

    const cmd = commands[initramfs];

    if (!cmd) {
        throw new Error(`Unknown initramfs generator: ${initramfs}. Cannot trigger rebuild.`);
    }

    console.log(pc.cyan(`Rebuilding initramfs using ${initramfs}...`));
    runElevated(cmd);
    console.log(pc.green('Initramfs rebuild complete.'));
}
