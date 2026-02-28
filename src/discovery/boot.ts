import { existsSync, readdirSync, readFileSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { runElevated } from '../utils/shell';
import type { BootloaderType } from '../types';

/**
 * Checks if a directory exists AND is readable by the current user.
 * Unlike `existsSync`, this distinguishes between "not found" and "permission denied".
 * @param dirPath - Absolute path to the directory to check
 * @returns `true` if the directory exists and is readable
 */
function isReadableDir(dirPath: string): boolean {
    try {
        accessSync(dirPath, constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Executes a command and returns its stdout, even if the command exits
 * with a non-zero code. This is necessary for tools like `bootctl` that
 * may print valid output but exit non-zero due to ESP permission errors.
 * @param cmd - The shell command to execute
 * @returns Trimmed stdout output, or empty string on total failure
 */
function runLenient(cmd: string): string {
    try {
        const { stdout } = Bun.spawnSync(['sh', '-c', cmd]);
        return stdout.toString().trim();
    } catch {
        return '';
    }
}

/**
 * Attempts to detect systemd-boot by running `bootctl status`.
 * This works even when `/boot/loader/entries/` is not readable by the current user.
 * Uses lenient execution because `bootctl` often exits non-zero when it
 * encounters permission errors on the ESP, but still outputs useful data.
 * @returns `true` if bootctl confirms systemd-boot is the active boot loader
 */
function isSystemdBootActive(): boolean {
    const isInstalled = runLenient('bootctl is-installed 2>/dev/null');
    if (isInstalled === 'yes') return true;

    const status = runLenient('bootctl status 2>/dev/null');
    return status.includes('systemd-boot');
}

/**
 * Extracts the current entry filename from bootctl status output.
 */
export function getSystemdBootCurrentEntry(): string {
    const status = runLenient('bootctl status 2>/dev/null');
    const match = status.match(/Current Entry:\s+(.+)$/m);
    return match ? match[1]!.trim() : '';
}

/**
 * Gets the ESP path as reported by bootctl.
 */
export function getSystemdBootEspPath(): string {
    const path = runLenient('bootctl --print-esp-path 2>/dev/null');
    return path || '/boot';
}

/**
 * Resolves the active systemd-boot entry config path by searching
 * candidate directories for `.conf` files matching the running kernel.
 * @param kernelVersion - The currently running kernel version string
 * @returns The resolved config path, or empty string if not found
 */
function resolveSystemdBootConfig(kernelVersion: string): string {
    const espPath = getSystemdBootEspPath();
    const candidateDirs = [
        join(espPath, 'loader/entries'),
        '/boot/loader/entries',
        '/efi/loader/entries',
        '/boot/efi/loader/entries'
    ];

    const currentEntryName = getSystemdBootCurrentEntry();

    for (const dir of candidateDirs) {
        if (!isReadableDir(dir)) continue;

        try {
            const entries = readdirSync(dir).filter(f => f.endsWith('.conf'));
            if (entries.length === 0) continue;

            // 1. Try exact match from bootctl
            if (currentEntryName && entries.includes(currentEntryName)) {
                return join(dir, currentEntryName);
            }

            // 2. Try matching by kernel version in content
            const activeConfig = entries.find(f => {
                const content = readFileSync(join(dir, f), 'utf-8');
                return content.includes(kernelVersion);
            });
            if (activeConfig) return join(dir, activeConfig);

            // 3. Fallback: pick any non-fallback entry, or the first entry
            const fallback = entries.find(f => !f.includes('fallback') && !f.includes('rescue')) ?? entries[0];
            if (fallback) return join(dir, fallback);
        } catch {
            continue;
        }
    }

    return '';
}

/**
 * Elevated version of resolveSystemdBootConfig that uses sudo to list and read entries.
 * Called only when injection is requested and initial discovery failed due to permissions.
 */
export function resolveSystemdBootConfigElevated(kernelVersion: string): string {
    const espPath = getSystemdBootEspPath();
    const candidateDirs = [
        join(espPath, 'loader/entries'),
        '/boot/loader/entries',
        '/efi/loader/entries',
        '/boot/efi/loader/entries'
    ];

    const currentEntryName = getSystemdBootCurrentEntry();

    for (const dir of candidateDirs) {
        try {
            // Use sudo to list files in the directory
            const filesOutput = runElevated(`ls '${dir}'`)
                .split('\n')
                .map(f => f.trim())
                .filter(f => f.endsWith('.conf'));

            if (filesOutput.length === 0) continue;

            // 1. Try exact match from bootctl
            if (currentEntryName && filesOutput.includes(currentEntryName)) {
                return join(dir, currentEntryName);
            }

            // 2. Try matching by kernel version in content (using elevated cat)
            for (const file of filesOutput) {
                const fullPath = join(dir, file);
                const content = runElevated(`cat '${fullPath}'`);
                if (content.includes(kernelVersion)) {
                    return fullPath;
                }
            }

            // 3. Fallback: pick any non-fallback entry, or the first entry
            const bestMatch = filesOutput.find(f => !f.includes('fallback') && !f.includes('rescue')) ?? filesOutput[0];
            if (bestMatch) return join(dir, bestMatch);
        } catch {
            continue;
        }
    }

    return '';
}

/**
 * Detects the active bootloader on the system by probing for GRUB
 * and systemd-boot configurations. Uses both filesystem checks and
 * `bootctl` as a fallback when boot directories require elevated permissions.
 * @param kernelVersion - The currently running kernel version from `uname -r`
 * @returns An object with the detected bootloader type and its config path
 */
export function detectBootloader(kernelVersion: string): { type: BootloaderType; configPath: string } {
    if (existsSync('/etc/default/grub')) {
        return {
            type: 'GRUB',
            configPath: '/etc/default/grub',
        };
    }

    // Try normal resolution first
    const configPath = resolveSystemdBootConfig(kernelVersion);
    if (configPath) {
        return { type: 'systemd-boot', configPath };
    }

    // If resolution failed, check if systemd-boot is active at all
    if (isSystemdBootActive()) {
        return {
            type: 'systemd-boot',
            configPath: '', // Will be resolved with elevation during mutation staging
        };
    }

    return {
        type: 'Unknown',
        configPath: ''
    };
}
