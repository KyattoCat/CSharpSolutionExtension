// src/services/ProjectDiscovery.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojProject } from '../models/CsprojModel';
import { CsprojSerializer } from '../serialization/CsprojSerializer';
import { PackagesConfigSerializer } from '../serialization/PackagesConfigSerializer';

export class ProjectDiscovery {

    /** 默认排除目录 */
    private static readonly DEFAULT_EXCLUDE = [
        '**/node_modules/**',
        '**/bin/**',
        '**/obj/**',
    ];

    /**
     * 扫描工作区中所有 .csproj 文件，解析后返回 CsprojProject 数组。
     * @param extraExcludes 用户配置的额外排除模式
     */
    static async scan(extraExcludes: string[] = []): Promise<CsprojProject[]> {
        const allExcludes = [...this.DEFAULT_EXCLUDE, ...extraExcludes];

        // 查找所有 .csproj 文件
        const uris = await vscode.workspace.findFiles('**/*.csproj', `{${allExcludes.join(',')}}`);

        const projects: CsprojProject[] = [];

        for (const uri of uris) {
            try {
                const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
                const project = CsprojSerializer.parse(content, uri.fsPath);

                // 尝试读取 packages.config
                const pkgConfigPath = path.join(path.dirname(uri.fsPath), 'packages.config');
                try {
                    const pkgContent = await fs.promises.readFile(pkgConfigPath, 'utf-8');
                    project.packages = PackagesConfigSerializer.parse(pkgContent);
                } catch {
                    // packages.config 不存在，保持空数组
                }

                projects.push(project);
            } catch (err) {
                vscode.window.showErrorMessage(
                    `解析项目失败: ${uri.fsPath} — ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }

        return projects;
    }

    /** 获取 packages.config 的文件路径 */
    static getPackagesConfigPath(projectPath: string): string {
        return path.join(path.dirname(projectPath), 'packages.config');
    }
}
