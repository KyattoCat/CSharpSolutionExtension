import * as cp from 'child_process';

export type GitStatusMap = Map<string, string>;

export class GitStatusService {

    /** 在指定目录运行 git status --porcelain，返回 相对路径→状态字 的映射 */
    static async getStatus(repoDir: string): Promise<GitStatusMap> {
        const map = new Map<string, string>();

        try {
            const result = cp.spawnSync('git', ['status', '--porcelain'], {
                cwd: repoDir,
                encoding: 'utf-8',
                timeout: 3000,
            });

            if (result.status !== 0 || !result.stdout) return map;

            for (const line of result.stdout.trim().split('\n')) {
                // Format: "XY path"  or  "XY orig -> new" (renamed)
                if (line.length < 3) continue;
                const statusChar = line[1] !== ' ' ? line[1] : line[0];
                let filePath = line.slice(3);
                // Handle renamed files: "R  old -> new"
                const arrowIdx = filePath.indexOf(' -> ');
                if (arrowIdx > 0) {
                    filePath = filePath.slice(arrowIdx + 4);
                }
                map.set(filePath, statusChar);
            }
        } catch {
            // git not available, return empty
        }

        return map;
    }
}
