import type { SystemProfile } from '../types';
import { detectGPUs, detectDisplayServer, getKernelVersion } from './hardware';
import { detectBootloader } from './boot';
import { detectInitramfs } from './initramfs';
import { detectMemory } from './memory';
import { detectImmutability } from './immutability';

export async function discoverSystem(): Promise<SystemProfile> {
    const { gpus, isHybrid } = detectGPUs();
    const displayServer = detectDisplayServer();
    const kernelVersion = getKernelVersion();
    const bootloader = detectBootloader(kernelVersion);
    const initramfs = detectInitramfs();
    const memory = detectMemory();
    const { isImmutable, immutableType } = detectImmutability();

    return {
        gpus,
        isHybrid,
        displayServer,
        isImmutable,
        immutableType,
        kernelVersion,
        bootloader,
        initramfs,
        memory,
    };
}
