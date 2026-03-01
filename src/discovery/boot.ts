import { existsSync, readdirSync, readFileSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { runElevated } from '../utils/shell';
import { FsService } from '../services/fs';
import { Logger } from '../utils/logger';
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
    } catch (e) {
        Logger.trace(`Lenient execution failed [${cmd}]: ${e}`);
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
    Logger.trace('Checking if systemd-boot is active...');
    const isInstalled = runLenient('bootctl is-installed 2>/dev/null');
    if (isInstalled === 'yes') {
        Logger.debug('systemd-boot is installed (via bootctl is-installed)');
        return true;
    }

    const status = runLenient('bootctl status 2>/dev/null');
    const isActive = status.includes('systemd-boot');
    if (isActive) Logger.debug('systemd-boot detected in bootctl status');
    return isActive;
}

/**
 * Extracts the current entry filename or ID from bootctl status output.
 */
export function getSystemdBootCurrentEntry(): string {
    const status = runLenient('bootctl status 2>/dev/null');
    Logger.trace('Parsing bootctl status for current entry...');

    for (const line of status.split('\n')) {
        if (line.includes('ID:') || line.includes('Current Entry:')) {
            const parts = line.split(/ID:|Current Entry:/);
            const entry = parts[parts.length - 1]?.trim();
            if (entry) {
                Logger.debug(`Found current systemd-boot entry ID: ${entry}`);
                return entry;
            }
        }
    }
    return '';
}

/**
 * Extracts the active configuration source path from bootctl status.
 * This is the most reliable way to find the config file.
 */
export function getSystemdBootConfigSource(): string {
    const status = runLenient('bootctl status 2>/dev/null');
    Logger.trace('Searching for Source path in bootctl status...');

    for (const line of status.split('\n')) {
        if (line.includes('Source:')) {
            const source = line.split('Source:')[1]?.trim();
            if (source) {
                Logger.debug(`Detected systemd-boot config source: ${source}`);
                return source;
            }
        }
    }
    return '';
}

/**
 * Gets the ESP path as reported by bootctl.
 */
export function getSystemdBootEspPath(): string {
    const path = runLenient('bootctl --print-esp-path 2>/dev/null');
    if (path) {
        Logger.debug(`ESP path from bootctl: ${path}`);
        return path;
    }
    // Fallback: check /boot and /efi
    if (existsSync('/boot/loader/loader.conf')) return '/boot';
    if (existsSync('/efi/loader/loader.conf')) return '/efi';
    if (existsSync('/boot/efi/loader/loader.conf')) return '/boot/efi';

    Logger.trace('Could not determine ESP path');
    return '';
}

/**
 * Resolves the active systemd-boot entry config path by searching
 * candidate directories for `.conf` files matching the running kernel.
 * @param kernelVersion - The currently running kernel version string
 * @returns The resolved config path, or empty string if not found
 */
function resolveSystemdBootConfig(kernelVersion: string): string {
    // 0. Priority: Check Source if reported by bootctl and readable
    const source = getSystemdBootConfigSource();
    if (source && isReadableDir(join(source, '..'))) {
        Logger.info(`Using bootctl reported Source (unprivileged): ${source}`);
        return source;
    }

    const espPath = getSystemdBootEspPath();
    const candidateDirs = [
        join(espPath, 'loader/entries'),
        '/boot/loader/entries',
        '/efi/loader/entries',
        '/boot/efi/loader/entries'
    ];

    Logger.trace(`Searching for systemd-boot config in candidates (unprivileged): ${candidateDirs.join(', ')}`);

    const currentEntryName = getSystemdBootCurrentEntry();

    for (const dir of candidateDirs) {
        if (!isReadableDir(dir)) {
            Logger.trace(`Directory not readable (skipping): ${dir}`);
            continue;
        }

        try {
            const entries = readdirSync(dir).filter(f => f.endsWith('.conf'));
            if (entries.length === 0) {
                Logger.trace(`No .conf files in ${dir}`);
                continue;
            }

            // 1. Try exact match from bootctl
            if (currentEntryName) {
                const exact = entries.find(f => f === currentEntryName || f === `${currentEntryName}.conf`);
                if (exact) {
                    const res = join(dir, exact);
                    Logger.info(`Resolved systemd-boot config via exact match: ${res}`);
                    return res;
                }
            }

            // 2. Try matching by kernel version in content
            const activeConfig = entries.find(f => {
                const content = readFileSync(join(dir, f), 'utf-8');
                return content.includes(kernelVersion);
            });
            if (activeConfig) {
                const res = join(dir, activeConfig);
                Logger.info(`Resolved systemd-boot config via kernel match: ${res}`);
                return res;
            }

            // 3. Fallback: pick any non-fallback entry, or the first entry
            const fallback = entries.find(f => !f.includes('fallback') && !f.includes('rescue')) ?? entries[0];
            if (fallback) {
                const res = join(dir, fallback);
                Logger.info(`Resolved systemd-boot config via fallback: ${res}`);
                return res;
            }
        } catch (e) {
            Logger.trace(`Error reading entries from ${dir}: ${e}`);
            continue;
        }
    }

    Logger.debug('Unprivileged systemd-boot config resolution failed');
    return '';
}

/**
 * Elevated version of resolveSystemdBootConfig that uses sudo to list and read entries.
 * Called only when injection is requested and initial discovery failed due to permissions.
 */
export function resolveSystemdBootConfigElevated(kernelVersion: string): string {
    Logger.info(`Starting elevated systemd-boot resolution for kernel ${kernelVersion}`);

    // 0. Priority: Check Source if reported by bootctl
    const source = getSystemdBootConfigSource();
    if (source) {
        Logger.info(`Probing bootctl reported Source with elevation: ${source}`);
        const exists = runElevated(`ls '${source}' 2>/dev/null`);
        if (exists) {
            Logger.info(`Resolved systemd-boot config via bootctl Source: ${source}`);
            return source;
        }
    }

    const espPath = getSystemdBootEspPath();
    const candidateDirs = [
        join(espPath, 'loader/entries'),
        '/boot/loader/entries',
        '/efi/loader/entries',
        '/boot/efi/loader/entries'
    ];

    Logger.debug(`Checking candidate directories (elevated): ${candidateDirs.join(', ')}`);

    const currentEntryName = getSystemdBootCurrentEntry();

    for (const dir of candidateDirs) {
        Logger.trace(`Inspecting ${dir} with elevation...`);
        try {
            // Use sudo to list files in the directory
            const rawFiles = runElevated(`ls -1 '${dir}' 2>/dev/null`);
            if (!rawFiles) {
                Logger.trace(`ls failed or returned empty for ${dir}`);
                continue;
            }

            const filesOutput = rawFiles.split('\n')
                .map(f => f.trim())
                .filter(f => f.endsWith('.conf'));

            if (filesOutput.length === 0) {
                Logger.trace(`No .conf files found in ${dir} (elevated)`);
                continue;
            }

            Logger.trace(`Found ${filesOutput.length} entries in ${dir}`);

            // 1. Try exact match from bootctl
            if (currentEntryName) {
                const exact = filesOutput.find(f => f === currentEntryName || f === `${currentEntryName}.conf`);
                if (exact) {
                    const res = join(dir, exact);
                    Logger.info(`Resolved (elevated) exact match: ${res}`);
                    return res;
                }
            }

            // 2. Try matching by kernel version in content (using elevated cat)
            for (const file of filesOutput) {
                const fullPath = join(dir, file);
                const content = runElevated(`cat '${fullPath}' 2>/dev/null`);
                if (content.includes(kernelVersion)) {
                    Logger.info(`Resolved (elevated) kernel match: ${fullPath}`);
                    return fullPath;
                }
            }

            // 3. Fallback: pick any non-fallback entry, or the first entry
            const bestMatch = filesOutput.find(f => !f.includes('fallback') && !f.includes('rescue')) ?? filesOutput[0];
            if (bestMatch) {
                const res = join(dir, bestMatch);
                Logger.info(`Resolved (elevated) fallback match: ${res}`);
                return res;
            }
        } catch (e) {
            Logger.debug(`Elevated inspection of ${dir} failed: ${e}`);
            continue;
        }
    }

    Logger.error('Failed to resolve systemd-boot config even with elevation.');
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
    Logger.debug(`Detecting bootloader (kernel=${kernelVersion})...`);

    if (existsSync('/etc/default/grub')) {
        Logger.info('Detected GRUB at /etc/default/grub');
        return {
            type: 'GRUB',
            configPath: '/etc/default/grub',
        };
    }

    // Try normal resolution first
    Logger.trace('Attempting unprivileged systemd-boot resolution...');
    const configPath = resolveSystemdBootConfig(kernelVersion);
    if (configPath) {
        return { type: 'systemd-boot', configPath };
    }

    // If resolution failed, check if systemd-boot is active at all
    if (isSystemdBootActive()) {
        Logger.debug('systemd-boot is active but config path resolution requires elevation.');
        return {
            type: 'systemd-boot',
            configPath: '', // Will be resolved with elevation during mutation staging
        };
    }

    Logger.warn('No supported bootloader identified.');
    return {
        type: 'Unknown',
        configPath: ''
    };
}
