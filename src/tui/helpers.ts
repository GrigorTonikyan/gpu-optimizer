import pc from 'picocolors';

/**
 * Formats a byte count into a human-readable string (KB, MB, GB).
 *
 * @param bytes - Number of bytes to format
 * @returns Formatted string like "8.00 GB"
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(2)} ${units[i]}`;
}

/**
 * Formats a temperature value with a color-coded indicator.
 *
 * @param temp - Temperature in °C, or undefined
 * @returns Colored string like "45°C" or "N/A"
 */
export function formatTemp(temp?: number): string {
    if (temp === undefined) return pc.dim('N/A');
    if (temp >= 80) return pc.red(`${temp}°C`);
    if (temp >= 60) return pc.yellow(`${temp}°C`);
    return pc.green(`${temp}°C`);
}

/**
 * Formats a percentage value with color coding.
 *
 * @param percent - Percentage (0-100)
 * @returns Colored string like "75%"
 */
export function formatPercent(percent: number): string {
    const str = `${percent}%`;
    if (percent >= 80) return pc.red(str);
    if (percent >= 50) return pc.yellow(str);
    return pc.green(str);
}

/**
 * TUI color theme constants for consistent styling.
 */
export const THEME = {
    header: pc.bold,
    title: pc.cyan,
    label: pc.white,
    value: pc.bold,
    dimmed: pc.dim,
    success: pc.green,
    warning: pc.yellow,
    error: pc.red,
    accent: pc.magenta,
    separator: pc.dim('─'.repeat(50)),
    dryBadge: pc.bold(pc.bgYellow(pc.black(' DRY MODE '))),
} as const;

/**
 * Pads or truncates a string to a fixed column width.
 *
 * @param text - The text to pad
 * @param width - Target column width
 * @returns Padded string
 */
export function padColumn(text: string, width: number): string {
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    if (stripped.length >= width) return text;
    return text + ' '.repeat(width - stripped.length);
}

/**
 * Creates a labeled row for status displays.
 *
 * @param label - The field label
 * @param value - The field value
 * @param labelWidth - Width of the label column (default 20)
 * @returns Formatted row string
 */
export function statusRow(label: string, value: string, labelWidth = 20): string {
    return `  ${padColumn(pc.dim(label), labelWidth + 10)}${value}`;
}
