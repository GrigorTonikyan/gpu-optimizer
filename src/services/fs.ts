import { homedir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { Glob } from 'bun';

/**
 * Standardized service for all filesystem operations.
 * Migrates away from node:fs to Bun native APIs where possible.
 */
export class FsService {
    /**
     * Resolves an XDG base directory path.
     * 
     * @param envVar - The XDG environment variable (e.g., XDG_CONFIG_HOME)
     * @param fallback - Fallback relative to $HOME (e.g., .config)
     * @param segments - Optional sub-segments
     * @returns Resolved absolute path
     */
    static resolveXdgPath(envVar: string, fallback: string, ...segments: string[]): string {
        const home = homedir() || '/tmp';
        const base = Bun.env[envVar] || join(home, fallback);
        return join(base, 'gpu-optimizer', ...segments);
    }

    /**
     * Checks if a file or directory exists.
     * 
     * @param path - Absolute path to check
     * @returns True if exists
     */
    static async exists(path: string): Promise<boolean> {
        return await Bun.file(path).exists();
    }

    /**
     * Creates a directory recursively.
     * 
     * @param path - Absolute path to create
     */
    static async ensureDir(path: string): Promise<void> {
        // Bun.spawnSync can be used for mkdir -p if needed, 
        // but for now we follow the mandate of using Bun's native implementations.
        // Node's mkdirSync with recursive is still safe enough until Bun provides a direct async native alternative for mkdir.
        const { mkdirSync } = await import('node:fs');
        mkdirSync(path, { recursive: true });
    }

    /**
     * Traverses a directory and returns entries matching a prefix.
     * Used for real-time TUI path autocompletion.
     * 
     * @param basePath - The directory to search in
     * @param prefix - Filter entries starting with this prefix
     * @param directoriesOnly - Whether to only return directories
     * @returns Array of matching entry names
     */
    static async traverse(basePath: string, prefix = '', directoriesOnly = true): Promise<string[]> {
        try {
            const { readdir, stat } = await import('node:path').then(() => import('node:fs/promises'));
            const entries = await readdir(basePath);

            const results: string[] = [];
            for (const name of entries) {
                if (prefix && !name.startsWith(prefix)) continue;

                if (directoriesOnly) {
                    try {
                        const stats = await stat(join(basePath, name));
                        if (stats.isDirectory()) {
                            results.push(name);
                        }
                    } catch {
                        // Skip unreadable
                    }
                } else {
                    results.push(name);
                }
            }

            return results.sort();
        } catch {
            return [];
        }
    }

    /**
     * Reads a JSON file and parses it into a typed object.
     * 
     * @param path - Path to the JSON file
     * @returns Parsed object or null if failed
     */
    static async readJson<T>(path: string): Promise<T | null> {
        try {
            const file = Bun.file(path);
            if (!(await file.exists())) return null;
            return await file.json();
        } catch {
            return null;
        }
    }

    /**
     * Writes an object to a file as JSON.
     * 
     * @param path - Path to write to
     * @param data - Object to serialize
     */
    static async writeJson(path: string, data: any): Promise<void> {
        const dir = dirname(path);
        await this.ensureDir(dir);
        await Bun.write(path, JSON.stringify(data, null, 2));
    }
}
