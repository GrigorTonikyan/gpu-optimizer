import { existsSync, readFileSync } from 'node:fs';

export function detectImmutability(): { isImmutable: boolean; immutableType?: 'ostree' | 'steamos' | 'nixos' } {
    /** 1. Check ostree (Fedora Silverblue, Kinoite, Bazzite) */
    if (existsSync('/run/ostree-booted')) {
        return { isImmutable: true, immutableType: 'ostree' };
    }

    /** 2. Check NixOS */
    if (existsSync('/etc/NIXOS') || existsSync('/run/current-system')) {
        return { isImmutable: true, immutableType: 'nixos' };
    }

    /** 3. Check SteamOS */
    if (existsSync('/etc/os-release')) {
        try {
            const osRelease = readFileSync('/etc/os-release', 'utf-8');
            if (osRelease.includes('ID="steamos"') || osRelease.includes('ID=steamos')) {
                return { isImmutable: true, immutableType: 'steamos' };
            }
        } catch (e) {
            /** Ignore error */
        }
    }

    return { isImmutable: false };
}
