import type { GPUDevice, OptimizationRule, OptimizationPlan, SystemProfile } from '../types';

/**
 * Generates Intel-specific optimization rules based on the active driver.
 *
 * For the legacy `i915` driver: enables GuC/HuC submission and framebuffer
 * compression via modprobe options.
 *
 * For systems where the user may want to transition from `i915` to the
 * modern `xe` driver on supported hardware, provides force_probe kernel
 * parameters using the device's PCI ID.
 *
 * @param gpu - The detected Intel GPU device
 * @param profile - The full system profile for context (hybrid checks, etc.)
 * @returns Array of optimization rules for this Intel GPU
 */
function getIntelRules(gpu: GPUDevice, profile: SystemProfile): OptimizationRule[] {
    const rules: OptimizationRule[] = [];

    if (gpu.activeDriver === 'i915') {
        rules.push({
            id: 'intel-guc-huc-fbc',
            vendor: 'Intel',
            description: 'Enable GuC/HuC firmware submission and FrameBuffer Compression for i915',
            target: 'modprobe',
            value: 'options i915 enable_guc=3 enable_fbc=1',
            severity: 'recommended',
        });

        /**
         * For systems where xe driver migration is desired:
         * The PCI ID is needed to force_probe the xe driver while
         * simultaneously blocking i915 from claiming the device.
         * This is offered as optional since xe support varies by hardware generation.
         */
        if (gpu.pciId) {
            rules.push({
                id: 'intel-xe-force-probe',
                vendor: 'Intel',
                description: `Force modern xe driver for Intel GPU (PCI: ${gpu.pciId}), replacing legacy i915`,
                target: 'kernel-param',
                value: `i915.force_probe=!${gpu.pciId} xe.force_probe=${gpu.pciId}`,
                severity: 'optional',
            });
        }
    }

    if (gpu.activeDriver === 'xe') {
        /**
         * When xe is already the active driver, no force_probe is needed.
         * GuC/HuC are enabled by default on xe, so no modprobe override required.
         */
        rules.push({
            id: 'intel-xe-active',
            vendor: 'Intel',
            description: 'Intel xe driver is active — GuC/HuC enabled by default, no additional tuning needed',
            target: 'modprobe',
            value: 'options xe',
            severity: 'optional',
        });
    }

    return rules;
}

/**
 * Generates NVIDIA-specific optimization rules.
 *
 * Always recommends `nvidia-drm.modeset=1` for DRM kernel modesetting.
 * On Wayland systems, additionally suggests `nvidia-drm.fbdev=1` for
 * the 550+ proprietary drivers to fix flickering issues.
 *
 * @param gpu - The detected NVIDIA GPU device
 * @param profile - The full system profile (used for display server detection)
 * @returns Array of optimization rules for this NVIDIA GPU
 */
function getNvidiaRules(gpu: GPUDevice, profile: SystemProfile): OptimizationRule[] {
    const rules: OptimizationRule[] = [];

    rules.push({
        id: 'nvidia-drm-modeset',
        vendor: 'NVIDIA',
        description: 'Enable DRM kernel modesetting for NVIDIA (required for Wayland, improves X11)',
        target: 'kernel-param',
        value: 'nvidia-drm.modeset=1',
        severity: 'recommended',
    });

    if (profile.displayServer === 'Wayland') {
        rules.push({
            id: 'nvidia-drm-fbdev',
            vendor: 'NVIDIA',
            description: 'Enable framebuffer device for NVIDIA on Wayland (fixes flickering on 550+ drivers)',
            target: 'kernel-param',
            value: 'nvidia-drm.fbdev=1',
            severity: 'optional',
        });
    }

    return rules;
}

/**
 * Generates AMD-specific optimization rules.
 *
 * For all AMD GPUs: offers OverDrive/undervolting unlock via ppfeaturemask.
 * For RDNA3+ (Navi 3x) or as a safe default: disables Scatter/Gather display
 * and Trusted Memory Zone to prevent fence timeouts and freezes.
 *
 * @param gpu - The detected AMD GPU device
 * @returns Array of optimization rules for this AMD GPU
 */
function getAmdRules(gpu: GPUDevice): OptimizationRule[] {
    const rules: OptimizationRule[] = [];

    rules.push({
        id: 'amd-ppfeaturemask',
        vendor: 'AMD',
        description: 'Unlock OverDrive/undervolting capabilities (ppfeaturemask) for tools like CoreCtrl',
        target: 'kernel-param',
        value: 'amdgpu.ppfeaturemask=0xffffffff',
        severity: 'optional',
    });

    rules.push({
        id: 'amd-sg-display',
        vendor: 'AMD',
        description: 'Disable Scatter/Gather display to prevent flickering under memory pressure (RDNA3 stability)',
        target: 'kernel-param',
        value: 'amdgpu.sg_display=0',
        severity: 'recommended',
    });

    rules.push({
        id: 'amd-tmz',
        vendor: 'AMD',
        description: 'Disable Trusted Memory Zone to prevent fence timeout freezes (RDNA3 stability)',
        target: 'kernel-param',
        value: 'amdgpu.tmz=0',
        severity: 'recommended',
    });

    return rules;
}

/**
 * Generates memory optimization rules.
 *
 * When zram is present and zswap is also enabled, they compete for swap
 * resources. Disabling zswap is recommended since zram is generally superior
 * for compressed in-memory swap.
 *
 * @param memory - The memory profile from system discovery
 * @returns Array of memory-related optimization rules
 */
function getMemoryRules(memory: SystemProfile['memory']): OptimizationRule[] {
    const rules: OptimizationRule[] = [];

    if (memory.hasZram && memory.hasZswap) {
        rules.push({
            id: 'memory-zswap-disable',
            vendor: 'system',
            description: 'Disable zswap when zram is present (they compete for swap, zram is preferred)',
            target: 'kernel-param',
            value: 'zswap.enabled=0',
            severity: 'recommended',
        });
    }

    return rules;
}

/**
 * Generates a complete optimization plan based on the discovered system profile.
 *
 * Iterates over all detected GPUs and memory configuration to build
 * a list of kernel parameters and modprobe options that should be applied.
 *
 * Rules are generated regardless of immutability status — the mutation
 * engine is responsible for checking immutability at apply-time and
 * providing distro-specific instructions when writes are not possible.
 *
 * @param profile - The complete system profile from the discovery engine
 * @returns An optimization plan with kernel parameters and modprobe options
 */
export function generateOptimizationPlan(profile: SystemProfile): OptimizationPlan {
    const allRules: OptimizationRule[] = [];

    for (const gpu of profile.gpus) {
        switch (gpu.vendor) {
            case 'Intel':
                allRules.push(...getIntelRules(gpu, profile));
                break;
            case 'NVIDIA':
                allRules.push(...getNvidiaRules(gpu, profile));
                break;
            case 'AMD':
                allRules.push(...getAmdRules(gpu));
                break;
        }
    }

    allRules.push(...getMemoryRules(profile.memory));

    return {
        kernelParams: allRules.filter(r => r.target === 'kernel-param'),
        modprobeOptions: allRules.filter(r => r.target === 'modprobe'),
    };
}
