import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

interface TemplateInfo {
    id: string;
    label: string;
    description: string;
}

export class SlnService {

    static async addProject(slnPath: string, csprojPath: string): Promise<void> {
        await this.runDotnet(['sln', slnPath, 'add', csprojPath], 'add project');
    }

    static async removeProject(slnPath: string, csprojPath: string): Promise<void> {
        await this.runDotnet(['sln', slnPath, 'remove', csprojPath], 'remove project');
    }

    static async createProject(
        slnPath: string, projectDir: string, template: string, projectName: string
    ): Promise<void> {
        const csprojDir = path.join(projectDir, projectName);
        await this.runDotnet(['new', template, '-n', projectName, '-o', csprojDir], 'create project');
        const csprojPath = path.join(csprojDir, `${projectName}.csproj`);
        await this.addProject(slnPath, csprojPath);
    }

    static async getTemplates(): Promise<TemplateInfo[]> {
        try {
            const result = cp.spawnSync('dotnet', ['new', 'list'], { shell: true, encoding: 'utf-8' });
            if (result.status === 0) {
                const parsed = this.parseTemplateList(result.stdout);
                if (parsed.length > 0) return parsed;
            }
        } catch { /* fallback */ }
        return this.getDefaultTemplates();
    }

    // --- Test helpers ---

    static getAddArgs(slnPath: string, csprojPath: string): string[] {
        return ['sln', slnPath, 'add', csprojPath];
    }

    static getRemoveArgs(slnPath: string, csprojPath: string): string[] {
        return ['sln', slnPath, 'remove', csprojPath];
    }

    static getNewArgs(template: string, name: string, dir: string): string[] {
        return ['new', template, '-n', name, '-o', path.join(dir, name)];
    }

    static getDefaultTemplates(): TemplateInfo[] {
        return [
            { id: 'classlib', label: '类库 (classlib)', description: 'C# 类库项目' },
            { id: 'console', label: '控制台应用 (console)', description: 'C# 控制台应用程序' },
            { id: 'web', label: 'Web 项目 (web)', description: 'ASP.NET Core Web 应用程序' },
            { id: 'mvc', label: 'MVC 项目 (mvc)', description: 'ASP.NET Core MVC 应用' },
            { id: 'webapi', label: 'Web API (webapi)', description: 'ASP.NET Core Web API' },
            { id: 'wpf', label: 'WPF 应用 (wpf)', description: 'Windows Presentation Foundation' },
            { id: 'winforms', label: 'WinForms 应用 (winforms)', description: 'Windows Forms 应用' },
        ];
    }

    // --- Private ---

    private static async runDotnet(args: string[], label: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const proc = cp.spawn('dotnet', args, { shell: true });
            let stderr = '';

            proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

            proc.on('close', (code: number | null) => {
                if (code === 0) resolve();
                else reject(new Error(`${label} failed (exit ${code}): ${stderr.trim()}`));
            });

            proc.on('error', (err: Error) => {
                reject(new Error(`dotnet not found: ${err.message}`));
            });
        });
    }

    private static parseTemplateList(stdout: string): TemplateInfo[] {
        // dotnet new list output is complex; use built-in templates as fallback for reliability
        return [];
    }
}
