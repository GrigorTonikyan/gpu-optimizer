import { existsSync, readdirSync, readFileSync, accessSync, constants } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
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
        return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (e: any) {
        /** execSync attaches stdout to the error when the process exits non-zero */
        if (e.stdout && typeof e.stdout === 'string') {
            return e.stdout.trim();
        }
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
 * Resolves the active systemd-boot entry config path by searching
 * candidate directories for `.conf` files matching the running kernel.
 * @param candidateDirs - Array of directory paths to probe
 * @param kernelVersion - The currently running kernel version string
 * @returns The resolved config path, or empty string if not found
 */
function resolveSystemdBootConfig(candidateDirs: string[], kernelVersion: string): string {
    const readableDir = candidateDirs.find(dir => isReadableDir(dir));

    if (!readableDir) return '';

    try {
        const entries = readdirSync(readableDir).filter(f => f.endsWith('.conf'));

        const activeConfig = entries.find(f => {
            const content = readFileSync(join(readableDir, f), 'utf-8');
            return content.includes(kernelVersion);
        });

        if (activeConfig) return join(readableDir, activeConfig);

        /** Fallback: pick any non-fallback entry, or the first entry */
        const fallback = entries.find(f => !f.includes('fallback') && !f.includes('rescue')) ?? entries[0];
        return fallback ? join(readableDir, fallback) : '';
    } catch {
        return '';
    }
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

    const candidateDirs = [
        '/boot/loader/entries',
        '/efi/loader/entries',
        '/boot/efi/loader/entries'
    ];

    /**
     * First try reading directories directly.
     * If none are readable, fall back to `bootctl` to confirm
     * systemd-boot is installed (common on Arch where /boot is 0700).
     */
    const hasReadableDir = candidateDirs.some(dir => isReadableDir(dir));

    if (hasReadableDir) {
        const configPath = resolveSystemdBootConfig(candidateDirs, kernelVersion);
        if (configPath) {
            return { type: 'systemd-boot', configPath };
        }
    }

    if (isSystemdBootActive()) {
        /**
         * systemd-boot is confirmed but entry dirs are not user-readable.
         * We know it's systemd-boot but can't resolve the exact config
         * path without elevated permissions. The mutation engine will
         * need to use elevated reads when it processes this.
         */
        const configPath = resolveSystemdBootConfig(candidateDirs, kernelVersion);
        return {
            type: 'systemd-boot',
            configPath,
        };
    }

    return {
        type: 'Unknown',
        configPath: ''
    };
}
