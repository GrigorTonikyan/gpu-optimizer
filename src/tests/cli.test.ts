import { expect, test, describe } from 'bun:test';
import pc from 'picocolors';
import { formatBytes, formatBoolean } from '../cli/formatters';

describe('CLI Formatters', () => {
    test('formatBytes should format 0 bytes correctly', () => {
        expect(formatBytes(0)).toBe('0 B');
    });

    test('formatBytes should format KB, MB, GB correctly', () => {
        expect(formatBytes(1024)).toBe('1.00 KB');
        expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
        expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
    });

    test('formatBoolean should return colored strings', () => {
        expect(formatBoolean(true)).toBe(pc.green('Yes'));
        expect(formatBoolean(false)).toBe(pc.dim('No'));
    });
});
