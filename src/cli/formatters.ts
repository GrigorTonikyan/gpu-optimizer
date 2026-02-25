import pc from 'picocolors';

/**
 * Formats bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Formats a given value based on its boolean state into a colored string
 * for CLI output.
 */
export function formatBoolean(val: boolean): string {
    return val ? pc.green('Yes') : pc.dim('No');
}
