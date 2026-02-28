import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pc from 'picocolors';

/**
 * Runs a command in user-space and returns the stdout.
 */
export function runUser(cmd: string): string {
    try {
        const { stdout, stderr, success } = Bun.spawnSync(['sh', '-c', cmd]);
        if (!success) {
            throw new Error(stderr.toString().trim() || 'Unknown command error');
        }
        return stdout.toString().trim();
    } catch (e: any) {
        throw new Error(`Command failed: ${cmd}\n${e.message}`);
    }
}

/**
 * Wraps a command in sudo and executes it safely.
 */
export function runElevated(cmd: string): string {
    try {
        const safeCmd = cmd.replace(/'/g, "'\\''");
        // Using 'inherit' for stdin/stderr to allow sudo password prompt to go to the TTY
        // while still capturing stdout for output processing.
        const { stdout, success } = Bun.spawnSync(['sudo', 'sh', '-c', safeCmd], {
            stdio: ['inherit', 'pipe', 'inherit']
        });
        if (!success) {
            return '';
        }
        return stdout.toString().trim();
    } catch (e: any) {
        return '';
    }
}

/**
 * Safely writes content to a protected file using sudo tee.
 */
export async function writeElevated(path: string, content: string): Promise<void> {
    try {
        const base64Content = Buffer.from(content, 'utf-8').toString('base64');
        const safePath = path.replace(/'/g, "'\\''");

        const { success } = Bun.spawnSync(['sh', '-c', `echo "${base64Content}" | base64 -d | sudo tee '${safePath}' > /dev/null`], {
            stdio: ['inherit', 'pipe', 'inherit']
        });
        if (!success) {
            throw new Error('Sudo tee failed');
        }
    } catch (e: any) {
        throw new Error(`Write elevated failed for ${path}\n${e.message}`);
    }
}

/**
 * Generates a unique temporary file in /tmp for staging edits before applying them.
 */
export async function stageFile(content: string, prefix = 'gpu-opt-'): Promise<string> {
    const baseTempDir = join(tmpdir(), 'gpu-optimizer-staging');

    // Use Bun native for directory creation check indirectly via a write attempt or just use import
    const { mkdirSync } = await import('node:fs');
    mkdirSync(baseTempDir, { recursive: true });

    const uniqueId = crypto.randomUUID().slice(0, 12);
    const filePath = join(baseTempDir, `${prefix}${uniqueId}.tmp`);

    await Bun.write(filePath, content);
    return filePath;
}