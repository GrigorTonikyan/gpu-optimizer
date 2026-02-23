import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pc from 'picocolors';

/**
 * Runs a command in user-space and returns the stdout.
 */
export function runUser(cmd: string): string {
    try {
        return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
        return execSync(`sudo sh -c '${safeCmd}'`, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] }).trim();
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

        execSync(`echo "${base64Content}" | base64 -d | sudo tee '${safePath}' > /dev/null`, { stdio: 'inherit' });
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

    const uniqueId = randomBytes(6).toString('hex');
    const filePath = join(baseTempDir, `${prefix}${uniqueId}.tmp`);

    writeFileSync(filePath, content, 'utf-8');

    return filePath;
}