import type { SystemProfile } from '../types';
import { discoverSystem } from '../discovery';

/**
 * Performs a full system discovery and returns the enriched SystemProfile.
 * Acts as the single entry point for both TUI and CLI layers to obtain
 * system status with telemetry data as a point-in-time snapshot.
 */
export async function getStatusSnapshot(): Promise<SystemProfile> {
    return discoverSystem();
}
