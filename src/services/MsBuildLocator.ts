import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * msbuild.exe 定位器。
 * 定位链：msbuildPath 配置（显式，不缓存）→ vswhere 探测 → PATH，探测结果会话内缓存。
 */
export class MsBuildLocator {

    /** undefined = 未探测；null = 已探测未找到；string = 已找到 */
    private static cached: string | null | undefined;

    /**
     * 定位 msbuild。
     * configuredPath 非空时：文件存在 → 直接返回；不存在 → 抛错（显式配置错误必须暴露，不降级）。
     * 否则走 vswhere → PATH 探测（结果缓存，reset 后重探）。
     * 返回 null 表示未找到。
     */
    static async locate(configuredPath: string): Promise<string | null> {
        if (configuredPath) {
            try {
                await fs.promises.access(configuredPath);
                return configuredPath;
            } catch {
                throw new Error(`配置的 msbuildPath 不存在: ${configuredPath}`);
            }
        }

        if (this.cached !== undefined) {
            return this.cached;
        }

        this.cached = this.findViaVswhere() ?? this.findInPath();
        return this.cached;
    }

    /** 清除探测缓存（buildTool/msbuildPath 配置变更时调用） */
    static reset(): void {
        this.cached = undefined;
    }

    /** 通过 vswhere 查询 VS/Build Tools 安装的 MSBuild */
    private static findViaVswhere(): string | null {
        const programFilesX86 = process.env['ProgramFiles(x86)'];
        if (!programFilesX86) return null;

        const vswhere = path.join(
            programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'
        );
        if (!fs.existsSync(vswhere)) return null;

        try {
            const result = cp.spawnSync(vswhere, [
                '-latest',
                '-requires', 'Microsoft.Component.MSBuild',
                '-find', 'MSBuild\\**\\Bin\\MSBuild.exe',
            ], { encoding: 'utf-8' });
            if (result.status !== 0 || !result.stdout) return null;

            const first = result.stdout.split(/\r?\n/).find(line => line.trim());
            return first ? first.trim() : null;
        } catch {
            return null;
        }
    }

    /** PATH 中的 msbuild（VS 开发者命令行 / Mono 环境） */
    private static findInPath(): string | null {
        try {
            const result = cp.spawnSync('msbuild', ['-version'], { shell: true });
            return result.status === 0 ? 'msbuild' : null;
        } catch {
            return null;
        }
    }
}
