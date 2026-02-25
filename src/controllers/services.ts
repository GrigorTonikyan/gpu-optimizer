import type { SystemProfile, StagedMutation } from '../types';
import {
    getAvailableServices as engineGetAvailableServices,
    enableNvidiaPersistence,
    stageUdevPowerRule,
    reloadUdevRules,
} from '../engine/services';
import { applyStaged } from '../engine/mutate';

/**
 * Service availability flags returned by the services controller.
 */
export interface ServiceAvailability {
    nvidiaPersistence: boolean;
    udevPowerManagement: boolean;
}

/**
 * Determines which system services are available for the given profile.
 *
 * @param profile - The discovered SystemProfile
 * @returns Flags indicating available services
 */
export function getAvailableServices(profile: SystemProfile): ServiceAvailability {
    return engineGetAvailableServices(profile);
}

/**
 * Enables the NVIDIA persistence daemon via systemd.
 * @throws If the systemctl command fails
 */
export function applyNvidiaPersistence(): void {
    enableNvidiaPersistence();
}

/**
 * Stages, applies, and activates the PCI power management udev rule.
 *
 * @returns The staged mutation for review/logging purposes
 */
export function applyUdevPowerRule(): StagedMutation {
    const mutation = stageUdevPowerRule();
    applyStaged(mutation);
    reloadUdevRules();
    return mutation;
}
