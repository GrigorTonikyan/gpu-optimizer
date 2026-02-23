import { runUser } from '../utils/shell';
import type { InitramfsType } from '../types';

export function detectInitramfs(): InitramfsType {
    const checkCommand = (cmd: string): boolean => {
        try {
            const stdout = runUser(`which ${cmd}`);
            return stdout.trim().length > 0;
        } catch (e) {
            return false;
        }
    };

    if (checkCommand('mkinitcpio')) return 'mkinitcpio';
    if (checkCommand('dracut')) return 'dracut';
    if (checkCommand('update-initramfs')) return 'update-initramfs';

    return 'Unknown';
}
