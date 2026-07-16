import * as cp from 'child_process';

export type StatusMap = Map<string, string>;

export class SvnStatusService {

    static async getStatus(repoDir: string): Promise<StatusMap> {
        const map = new Map<string, string>();

        try {
            const result = cp.spawnSync('svn', ['status'], {
                cwd: repoDir,
                encoding: 'utf-8',
                timeout: 3000,
            });

            if (result.status !== 0 || !result.stdout) return map;

            for (const line of result.stdout.trim().split('\n')) {
                // Format: "X       path/file"
                if (line.length < 8) continue;
                const statusChar = line[0];
                const filePath = line.slice(8).trim();
                map.set(filePath, statusChar);
            }
        } catch {
            // svn not available
        }

        return map;
    }

    static async isAvailable(): Promise<boolean> {
        try {
            const result = cp.spawnSync('svn', ['--version'], { timeout: 3000 });
            return result.status === 0;
        } catch {
            return false;
        }
    }
}
