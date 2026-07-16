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

        // 查找所有 .csproj 文件（不依赖 findFiles 的 exclude 参数，改用手动过滤更可靠）
        const allUris = await vscode.workspace.findFiles('**/*.csproj', null);

        // 手动过滤：将每个 exclude 模式转为路径片段匹配
        const uris = allUris.filter(uri => !matchesAny(uri.fsPath, allExcludes));

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

/**
 * 检查路径是否匹配任一排除模式。
 * 将 glob 模式转为简单的路径片段检查：
 *   [star][star]/unity/[star][star] → 路径中包含 /unity/
 *   [star][star]/node_modules/[star][star] → 路径中包含 /node_modules/
 */
function matchesAny(filePath: string, patterns: string[]): boolean {
    // 统一分隔符
    const normalized = filePath.replace(/\\/g, '/');

    for (const pattern of patterns) {
        // 去掉首尾的 **/ 和 /** 得到核心片段名
        let segment = pattern;
        segment = segment.replace(/^\*\*\//, '');   // 去掉开头的 **/
        segment = segment.replace(/\/\*\*$/, '');    // 去掉结尾的 /**
        segment = segment.replace(/\/\*\*\/?/g, ''); // 去掉中间的 **/

        if (!segment) continue;

        // 检查路径中是否包含该片段作为完整目录名
        const dirs = normalized.split('/');
        if (dirs.includes(segment)) {
            return true;
        }
    }

    return false;
}
