import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { MsBuildLocator } from './MsBuildLocator';

type ResolvedTool = { tool: 'dotnet' | 'msbuild'; exe: string };

export class BuildService {

    private static channel: vscode.OutputChannel | undefined;

    private static getChannel(): vscode.OutputChannel {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel('C# Build');
        }
        return this.channel;
    }

    static async build(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void> {
        const resolved = await this.resolveTool(hasLegacyProject);
        if (!resolved) return;
        const args = resolved.tool === 'msbuild'
            ? this.getMsBuildArgs(projectPath, 'Build')
            : this.getBuildArgs(projectPath);
        await this.runTool(resolved.exe, args, projectPath, projectName, '生成');
    }

    static async clean(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void> {
        const resolved = await this.resolveTool(hasLegacyProject);
        if (!resolved) return;
        const args = resolved.tool === 'msbuild'
            ? this.getMsBuildArgs(projectPath, 'Clean')
            : this.getCleanArgs(projectPath);
        await this.runTool(resolved.exe, args, projectPath, projectName, '清理');
    }

    static async rebuild(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void> {
        const resolved = await this.resolveTool(hasLegacyProject);
        if (!resolved) return;
        if (resolved.tool === 'msbuild') {
            // MSBuild 原生 Rebuild target，单次调用
            await this.runTool(resolved.exe, this.getMsBuildArgs(projectPath, 'Rebuild'), projectPath, projectName, '重新生成');
            return;
        }
        const cleanOk = await this.runTool(resolved.exe, this.getCleanArgs(projectPath), projectPath, projectName, '清理');
        if (!cleanOk) return;
        await this.runTool(resolved.exe, this.getBuildArgs(projectPath), projectPath, projectName, '生成');
    }

    // Test helpers
    static getBuildArgs(projectPath: string): string[] {
        return ['build', projectPath];
    }

    static getCleanArgs(projectPath: string): string[] {
        return ['clean', projectPath];
    }

    static getMsBuildArgs(projectPath: string, target: 'Build' | 'Clean' | 'Rebuild'): string[] {
        return [projectPath, `/t:${target}`];
    }

    /**
     * 按 buildTool 配置与项目类型决定构建工具。
     * 返回 null 表示无可用工具（已向用户弹出错误）。
     */
    private static async resolveTool(hasLegacyProject: boolean): Promise<ResolvedTool | null> {
        const config = vscode.workspace.getConfiguration('csharpsolution');
        const buildTool = config.get<string>('buildTool', 'auto');
        const msbuildPath = config.get<string>('msbuildPath', '');

        if (buildTool === 'dotnet') {
            return this.resolveDotnet();
        }

        if (buildTool === 'msbuild') {
            let located: string | null;
            try {
                located = await MsBuildLocator.locate(msbuildPath);
            } catch (err) {
                vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
                return null;
            }
            if (!located) {
                vscode.window.showErrorMessage(
                    '未找到 MSBuild。请安装 Visual Studio/Build Tools 或配置 csharpsolution.msbuildPath。'
                );
                return null;
            }
            return { tool: 'msbuild', exe: located };
        }

        // auto：含传统项目时优先 msbuild，找不到回退 dotnet 并警告
        if (hasLegacyProject) {
            let located: string | null = null;
            try {
                located = await MsBuildLocator.locate(msbuildPath);
            } catch (err) {
                vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
                return null;
            }
            if (located) {
                return { tool: 'msbuild', exe: located };
            }
            this.getChannel().appendLine('⚠ 检测到传统项目但未找到 MSBuild，回退 dotnet');
        }
        return this.resolveDotnet();
    }

    private static resolveDotnet(): ResolvedTool | null {
        if (!this.isDotnetAvailable()) {
            vscode.window.showErrorMessage('未找到 .NET SDK。请安装 .NET SDK 后重试。');
            return null;
        }
        return { tool: 'dotnet', exe: 'dotnet' };
    }

    private static async runTool(
        exe: string,
        args: string[],
        projectPath: string,
        projectName: string,
        label: string
    ): Promise<boolean> {
        const channel = this.getChannel();
        channel.clear();
        channel.show(true);

        const timestamp = new Date().toLocaleTimeString();
        channel.appendLine(`[${timestamp}] ${label} ${projectName}...`);
        channel.appendLine(`${exe} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
        channel.appendLine('');

        return new Promise<boolean>((resolve) => {
            const projectDir = path.dirname(projectPath);
            // shell:true 下参数不会自动引号包裹；exe 与含空格参数显式加引号
            // （vswhere 返回的 MSBuild 路径含 "Program Files"，项目路径也可能含空格）
            const quotedExe = exe.includes(' ') ? `"${exe}"` : exe;
            const quotedArgs = args.map(a => (a.includes(' ') ? `"${a}"` : a));
            const proc = cp.spawn(quotedExe, quotedArgs, {
                cwd: projectDir,
                shell: true,
            });

            proc.stdout?.on('data', (data: Buffer) => {
                channel.appendLine(data.toString().trimEnd());
            });

            proc.stderr?.on('data', (data: Buffer) => {
                const lines = data.toString().trimEnd().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        channel.appendLine(`❌ ${line}`);
                    }
                }
            });

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    channel.appendLine('');
                    channel.appendLine(`✅ ${label}成功`);
                    resolve(true);
                } else {
                    channel.appendLine('');
                    channel.appendLine(`❌ ${label}失败 (exit code: ${code})`);
                    vscode.window.showErrorMessage(`${label}失败，详见输出面板。`);
                    resolve(false);
                }
            });

            proc.on('error', (err: Error) => {
                channel.appendLine(`❌ 启动 ${exe} 失败: ${err.message}`);
                vscode.window.showErrorMessage(`启动 ${exe} 失败: ${err.message}`);
                resolve(false);
            });
        });
    }

    private static isDotnetAvailable(): boolean {
        try {
            const result = cp.spawnSync('dotnet', ['--version'], { shell: true });
            return result.status === 0;
        } catch {
            return false;
        }
    }
}
