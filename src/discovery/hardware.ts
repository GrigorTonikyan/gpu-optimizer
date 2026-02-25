import { runUser } from '../utils/shell';
import type { GPUDevice, GPUVendor } from '../types';

export function getKernelVersion(): string {
    try {
        return runUser('uname -r');
    } catch {
        return 'Unknown';
    }
}

export function detectDisplayServer(): 'Wayland' | 'X11' | 'Unknown' {
    const sessionType = Bun.env.XDG_SESSION_TYPE?.toLowerCase();
    if (sessionType === 'wayland') return 'Wayland';
    if (sessionType === 'x11') return 'X11';

    /** Fallback checks (e.g. WAYLAND_DISPLAY) */
    if (Bun.env.WAYLAND_DISPLAY) return 'Wayland';
    if (Bun.env.DISPLAY) return 'X11';

    return 'Unknown';
}

export function detectGPUs(): { gpus: GPUDevice[]; isHybrid: boolean } {
    const gpus: GPUDevice[] = [];

    try {
        /**
         * Output format of lspci -nnk:
         * 00:02.0 VGA compatible controller [0300]: Intel Corporation Alder Lake-P GT2 [Iris Xe Graphics] [8086:46a6] (rev 0c)
         *         Subsystem: Lenovo Device [17aa:22ec]
         *         Kernel driver in use: i915
         */
        const lspciOutput = runUser(`lspci -nnk | grep -iA3 'VGA\\|3D\\|Display'`);

        /** Split by blocks. We assume each GPU block starts with a PCI address like "00:02.0" */
        const blocks = lspciOutput.split(/(?=^[a-f0-9]{2}:[a-f0-9]{2}\.[a-f0-9] )/m).filter(b => b.trim() !== '');

        for (const block of blocks) {
            let vendor: GPUVendor | null = null;
            let pciId = '';
            let activeDriver = '';
            let model = 'Unknown';

            const lines = block.split('\n').map(l => l.trim());
            const headerLine = lines[0];

            if (!headerLine) continue;

            if (headerLine.toLowerCase().includes('intel')) {
                vendor = 'Intel';
            } else if (headerLine.toLowerCase().includes('nvidia')) {
                vendor = 'NVIDIA';
            } else if (headerLine.toLowerCase().includes('amd') || headerLine.toLowerCase().includes('advanced micro devices')) {
                vendor = 'AMD';
            }

            /** Extract PCI ID like [8086:46a6] */
            const pciMatch = headerLine.match(/\[([0-9a-f]{4}:[0-9a-f]{4})\]/i);
            if (pciMatch && pciMatch[1]) {
                pciId = pciMatch[1].toLowerCase();
            }

            /**
             * Extract the GPU model name from the lspci header line.
             * The lspci header has the format:
             *   "VGA compatible controller [0300]: Intel Corporation TigerLake-H GT1 [UHD Graphics] [8086:9a60] (rev 01)"
             * We match from the class code bracket (e.g. [0300]) followed by a colon,
             * then capture everything up to the PCI vendor:device ID bracket.
             */
            const modelMatch = headerLine.match(/\[\d{4}\]:\s*(.+?)\s*\[[\da-f]{4}:[\da-f]{4}\]/i);
            if (modelMatch?.[1]) {
                model = modelMatch[1].trim();
            }

            /** Extract Kernel driver in use */
            const driverLine = lines.find(l => l.startsWith('Kernel driver in use:'));
            if (driverLine) {
                activeDriver = driverLine.split(':')[1]?.trim() || '';
            }

            if (vendor) {
                gpus.push({
                    vendor,
                    model,
                    pciId,
                    activeDriver
                });
            }
        }

    } catch (e) {
        console.error("Failed to detect GPUs:", e);
    }

    /** Determine if hybrid (multiple distinct vendors) */
    const uniqueVendors = new Set(gpus.map(g => g.vendor));
    const isHybrid = uniqueVendors.size > 1;

    return { gpus, isHybrid };
}
