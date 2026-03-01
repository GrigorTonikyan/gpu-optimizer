import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pc from 'picocolors';
import { Logger } from './logger';

/**
 * Runs a command in user-space and returns the stdout.
 */
export function runUser(cmd: string): string {
    Logger.trace(`Executing user command: ${cmd}`);
    try {
        const { stdout, stderr, success } = Bun.spawnSync(['sh', '-c', cmd]);
        if (!success) {
            const error = stderr.toString().trim() || 'Unknown command error';
            Logger.debug(`User command failed [${cmd}]: ${error}`);
            throw new Error(error);
        }
        return stdout.toString().trim();
    } catch (e: any) {
        Logger.error(`Command failed: ${cmd}`, e);
        throw new Error(`Command failed: ${cmd}\n${e.message}`);
    }
}

/**
 * Wraps a command in sudo and executes it safely.
 */
export function runElevated(cmd: string): string {
    Logger.debug(`Executing elevated command: ${cmd}`);
    try {
        const safeCmd = cmd.replace(/'/g, "'\\''");
        // Using 'inherit' for stdin/stderr to allow sudo password prompt to go to the TTY
        // while still capturing stdout for output processing.
        const { stdout, success, exitCode } = Bun.spawnSync(['sudo', 'sh', '-c', safeCmd], {
            stdio: ['inherit', 'pipe', 'inherit']
        });

        if (!success) {
            Logger.warn(`Elevated command failed (Exit ${exitCode}): ${cmd}`);
            return '';
        }

        const out = stdout.toString().trim();
        Logger.trace(`Elevated command success. Output length: ${out.length}`);
        return out;
    } catch (e: any) {
        Logger.error(`Elevated command execution crashed: ${cmd}`, e);
        return '';
    }
}

/**
 * Safely writes content to a protected file using sudo tee.
 */
export async function writeElevated(path: string, content: string): Promise<void> {
    Logger.info(`Writing elevated content to: ${path}`);
    try {
        const base64Content = Buffer.from(content, 'utf-8').toString('base64');
        const safePath = path.replace(/'/g, "'\\''");

        const { success, exitCode } = Bun.spawnSync(['sh', '-c', `echo "${base64Content}" | base64 -d | sudo tee '${safePath}' > /dev/null`], {
            stdio: ['inherit', 'pipe', 'inherit']
        });
        if (!success) {
            Logger.error(`Sudo tee failed for ${path} (Exit ${exitCode})`);
            throw new Error('Sudo tee failed');
        }
        Logger.debug(`Successfully wrote elevated file: ${path}`);
    } catch (e: any) {
        Logger.error(`Write elevated failed for ${path}`, e);
        throw new Error(`Write elevated failed for ${path}\n${e.message}`);
    }
}

/**
 * Generates a unique temporary file in /tmp for staging edits before applying them.
 */
export async function stageFile(content: string, prefix = 'gpu-opt-'): Promise<string> {
    const baseTempDir = join(tmpdir(), 'gpu-optimizer-staging');
    Logger.trace(`Staging file to temp directory: ${baseTempDir}`);

    const { mkdirSync } = await import('node:fs');
    mkdirSync(baseTempDir, { recursive: true });

    const uniqueId = crypto.randomUUID().slice(0, 12);
    const filePath = join(baseTempDir, `${prefix}${uniqueId}.tmp`);

    await Bun.write(filePath, content);
    Logger.trace(`File staged at: ${filePath}`);
    return filePath;
}