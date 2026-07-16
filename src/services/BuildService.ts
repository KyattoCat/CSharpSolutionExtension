import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export class BuildService {

    private static channel: vscode.OutputChannel | undefined;

    private static getChannel(): vscode.OutputChannel {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel('C# Build');
        }
        return this.channel;
    }

    static async build(projectPath: string, projectName: string): Promise<void> {
        await this.runDotnet('build', projectPath, projectName, '生成');
    }

    static async clean(projectPath: string, projectName: string): Promise<void> {
        await this.runDotnet('clean', projectPath, projectName, '清理');
    }

    static async rebuild(projectPath: string, projectName: string): Promise<void> {
        const cleanOk = await this.runDotnet('clean', projectPath, projectName, '清理');
        if (!cleanOk) return;
        await this.runDotnet('build', projectPath, projectName, '生成');
    }

    // Test helpers
    static getBuildArgs(projectPath: string): string[] {
        return ['build', projectPath];
    }

    static getCleanArgs(projectPath: string): string[] {
        return ['clean', projectPath];
    }

    private static async runDotnet(
        command: string,
        projectPath: string,
        projectName: string,
        label: string
    ): Promise<boolean> {
        const available = await this.isDotnetAvailable();
        if (!available) {
            vscode.window.showErrorMessage('未找到 .NET SDK。请安装 .NET SDK 后重试。');
            return false;
        }

        const channel = this.getChannel();
        channel.clear();
        channel.show(true);

        const timestamp = new Date().toLocaleTimeString();
        channel.appendLine(`[${timestamp}] ${label} ${projectName}...`);
        channel.appendLine(`dotnet ${command} "${projectPath}"`);
        channel.appendLine('');

        return new Promise<boolean>((resolve) => {
            const projectDir = path.dirname(projectPath);
            const proc = cp.spawn('dotnet', [command, projectPath], {
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
                channel.appendLine(`❌ 启动 dotnet 失败: ${err.message}`);
                vscode.window.showErrorMessage(`启动 dotnet 失败: ${err.message}`);
                resolve(false);
            });
        });
    }

    private static async isDotnetAvailable(): Promise<boolean> {
        try {
            const result = cp.spawnSync('dotnet', ['--version'], { shell: true });
            return result.status === 0;
        } catch {
            return false;
        }
    }
}
