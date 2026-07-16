// src/services/ProjectDiscovery.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojProject, Solution } from '../models/CsprojModel';
import { CsprojSerializer } from '../serialization/CsprojSerializer';
import { PackagesConfigSerializer } from '../serialization/PackagesConfigSerializer';
import { SlnParser } from '../serialization/SlnParser';

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
    static async scan(extraExcludes: string[] = []): Promise<{
        solutions: Solution[];
        standaloneProjects: CsprojProject[];
        allProjects: CsprojProject[];
    }> {
        const allExcludes = [...this.DEFAULT_EXCLUDE, ...extraExcludes];

        // 1. 扫描所有 .csproj
        const allProjUris = await vscode.workspace.findFiles('**/*.csproj', null);
        const projUris = allProjUris.filter(uri => !matchesAny(uri.fsPath, allExcludes));

        const projects: CsprojProject[] = [];
        for (const uri of projUris) {
            try {
                const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
                const project = CsprojSerializer.parse(content, uri.fsPath);

                const pkgConfigPath = path.join(path.dirname(uri.fsPath), 'packages.config');
                try {
                    const pkgContent = await fs.promises.readFile(pkgConfigPath, 'utf-8');
                    project.packages = PackagesConfigSerializer.parse(pkgContent);
                } catch {
                    // packages.config 不存在
                }

                projects.push(project);
            } catch (err) {
                vscode.window.showErrorMessage(
                    `解析项目失败: ${uri.fsPath} — ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }

        // 2. 扫描所有 .sln
        const allSlnUris = await vscode.workspace.findFiles('**/*.sln', null);
        const slnUris = allSlnUris.filter(uri => !matchesAny(uri.fsPath, allExcludes));

        const solutions: Solution[] = [];
        for (const uri of slnUris) {
            try {
                const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
                solutions.push(SlnParser.parse(content, uri.fsPath));
            } catch (err) {
                vscode.window.showErrorMessage(
                    `解析解决方案失败: ${uri.fsPath} — ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }

        // 3. 找出不被任何 .sln 引用的独立项目
        const referencedPaths = new Set<string>();
        for (const solution of solutions) {
            const slnDir = path.dirname(solution.path);
            for (const sp of solution.projects) {
                referencedPaths.add(path.resolve(slnDir, sp.relPath));
            }
        }

        const standaloneProjects = projects.filter(p => !referencedPaths.has(p.path));

        return { solutions, standaloneProjects, allProjects: projects };
    }

    /** 根据方案查找其下的 CsprojProject */
    static findProjectsForSolution(solution: Solution, allProjects: CsprojProject[]): CsprojProject[] {
        const slnDir = path.dirname(solution.path);
        const result: CsprojProject[] = [];

        for (const sp of solution.projects) {
            const absPath = path.resolve(slnDir, sp.relPath);
            const project = allProjects.find(p => p.path === absPath);
            if (project) {
                result.push(project);
            }
        }

        return result;
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
