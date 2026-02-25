
import { writeFileSync, mkdirSync } from 'node:fs';
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
        /** We use sh -c and proper escaping to allow complex elevated commands */
        const safeCmd = cmd.replace(/'/g, "'\\''");
        const { stdout, stderr, success } = Bun.spawnSync(['sudo', 'sh', '-c', safeCmd]);
        if (!success) {
            throw new Error(stderr.toString().trim() || 'Unknown elevated command error');
        }
        return stdout.toString().trim();
    } catch (e: any) {
        console.error(pc.red(`\nFailed to execute elevated command: sudo ${cmd}`));
        throw new Error(`Elevated command failed: ${cmd}\n${e.message}`);
    }
}

/**
 * Safely writes content to a protected file using sudo tee.
 */
export function writeElevated(path: string, content: string): void {
    try {
        /** Base64 encoding avoids quotes/newline escaping complexities when echoing into tee */
        const base64Content = Buffer.from(content, 'utf-8').toString('base64');
        const safePath = path.replace(/'/g, "'\\''");

        const { success, stderr } = Bun.spawnSync(['sh', '-c', `echo "${base64Content}" | base64 -d | sudo tee '${safePath}' > /dev/null`]);
        if (!success) {
            throw new Error(stderr.toString().trim() || 'Unknown write error');
        }
    } catch (e: any) {
        console.error(pc.red(`\nCould not write to ${path}. Do you have sudo rights?`));
        throw new Error(`Write elevated failed for ${path}\n${e.message}`);
    }
}

/**
 * Generates a unique temporary file in /tmp for staging edits before applying them.
 */
export function stageFile(content: string, prefix = 'gpu-opt-'): string {
    const baseTempDir = join(tmpdir(), 'gpu-optimizer-staging');

    try {
        mkdirSync(baseTempDir, { recursive: true });
    } catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
    }

    const uniqueId = crypto.randomUUID().slice(0, 12);
    const filePath = join(baseTempDir, `${prefix}${uniqueId}.tmp`);

    writeFileSync(filePath, content, 'utf-8');

    return filePath;
}