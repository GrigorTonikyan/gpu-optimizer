import { describe, it, expect } from 'bun:test';

/**
 * Tests for the point-in-time telemetry collector.
 * These tests run against the actual host system — results will
 * vary but must always return structurally valid data.
 */
describe('Telemetry — CPU Info', () => {
    it('collectCpuInfo returns valid CPU telemetry', async () => {
        const { collectCpuInfo } = await import('../discovery/telemetry');
        const info = collectCpuInfo();

        expect(typeof info.model).toBe('string');
        expect(info.model.length).toBeGreaterThan(0);
        expect(typeof info.cores).toBe('number');
        expect(info.cores).toBeGreaterThanOrEqual(1);
        expect(typeof info.usagePercent).toBe('number');
        expect(info.usagePercent).toBeGreaterThanOrEqual(0);
        expect(info.usagePercent).toBeLessThanOrEqual(100);
    });
});

describe('Telemetry — Memory Stats', () => {
    it('collectMemoryStats returns valid memory data', async () => {
        const { collectMemoryStats } = await import('../discovery/telemetry');
        const stats = collectMemoryStats();

        expect(typeof stats.total).toBe('number');
        expect(typeof stats.used).toBe('number');
        expect(typeof stats.free).toBe('number');
        expect(stats.total).toBeGreaterThan(0);
        expect(stats.used).toBeGreaterThanOrEqual(0);
        expect(stats.free).toBeGreaterThanOrEqual(0);
    });
});

describe('Telemetry — GPU Stats', () => {
    it('collectGpuStats returns stats or undefined without crashing', async () => {
        const { collectGpuStats } = await import('../discovery/telemetry');
        const { detectGPUs } = await import('../discovery/hardware');

        const { gpus } = detectGPUs();

        for (const gpu of gpus) {
            const stats = collectGpuStats(gpu);
            if (stats !== undefined) {
                if (stats.temperature !== undefined) {
                    expect(typeof stats.temperature).toBe('number');
                }
                if (stats.utilization !== undefined) {
                    expect(typeof stats.utilization).toBe('number');
                }
                if (stats.vramTotal !== undefined) {
                    expect(typeof stats.vramTotal).toBe('number');
                }
                if (stats.vramUsed !== undefined) {
                    expect(typeof stats.vramUsed).toBe('number');
                }
            }
        }
    });
});
