// src/commands/navCommands.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { Solution } from '../models/CsprojModel';
import { ProjectNode } from '../models/ProjectNode';
import { ProjectTreeProvider } from '../tree/ProjectTreeProvider';
import { ProjectDiscovery } from '../services/ProjectDiscovery';
import { SvnStatusService } from '../services/SvnStatusService';
import { StatusDecorationProvider } from '../services/StatusDecorationProvider';

/** 当前选中的解决方案路径（模块级状态，跨 refresh 保持） */
let currentSolutionPath: string | undefined;

/** 弹出解决方案选择器，返回用户选中的方案路径；取消则返回 undefined */
async function pickSolution(solutions: Solution[]): Promise<string | undefined> {
    const items = solutions.map(s => ({
        label: s.name,
        description: `$(project) ${s.projects.length} 个项目`,
        detail: s.path,
        solutionPath: s.path,
    }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: '检测到多个解决方案，请选择一个打开',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    return picked?.solutionPath;
}

/** 根据选中的方案路径过滤方案列表。如未选中且存在多个，弹出选择器 */
async function resolveSolutions(solutions: Solution[]): Promise<Solution[]> {
    if (solutions.length <= 1) {
        currentSolutionPath = solutions[0]?.path;
        return solutions;
    }

    // 已有选中项，验证其是否仍然存在
    if (currentSolutionPath) {
        const stillExists = solutions.some(s => s.path === currentSolutionPath);
        if (stillExists) {
            return solutions.filter(s => s.path === currentSolutionPath);
        }
        // 选中项已不存在，清除并重新选择
        currentSolutionPath = undefined;
    }

    // 弹出选择器
    const picked = await pickSolution(solutions);
    if (picked) {
        currentSolutionPath = picked;
        return solutions.filter(s => s.path === picked);
    }

    // 用户取消了选择，默认显示第一个（避免界面空白）
    currentSolutionPath = solutions[0].path;
    return solutions.slice(0, 1);
}

/** 注册导航类命令：刷新 / 资源管理器显示 / 集成终端 / 编辑器→树联动 */
export function registerNavCommands(
    context: vscode.ExtensionContext,
    treeProvider: ProjectTreeProvider,
    treeView: vscode.TreeView<ProjectNode>,
    statusDecorationProvider: StatusDecorationProvider
): void {
    // --- 刷新面板 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.refresh', async () => {
            treeView.message = '扫描中...';
            const config = vscode.workspace.getConfiguration('csharpsolution');
            const excludes = config.get<string[]>('excludePatterns', []);
            const result = await ProjectDiscovery.scan(excludes);
            const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const vcs = config.get<string>('vcs', 'git');
            // Git: VS Code 内置 Git 扩展通过 resourceUri 自动装饰，无需手动收集
            // SVN: 收集状态后交给 StatusDecorationProvider 渲染彩色角标（并启用文件变更自动刷新）
            if (vcs === 'svn' && rootPath) {
                const svnStatusMap = await SvnStatusService.getStatus(rootPath);
                statusDecorationProvider.enable(rootPath, svnStatusMap);
            } else if (vcs !== 'svn') {
                statusDecorationProvider.clear();
            }
            const activeSolutions = await resolveSolutions(result.solutions);
            const hasSolution = activeSolutions.length > 0;
            // 有解决方案时只显示方案内的项目，不显示独立项目
            treeView.description = result.solutions.length > 1
                ? `$(folder) ${activeSolutions[0]?.name || '无'}`
                : undefined;
            treeProvider.refresh({
                solutions: activeSolutions,
                standaloneProjects: hasSolution ? [] : result.standaloneProjects,
                allProjects: result.allProjects,
            });
            treeView.message = (!hasSolution && result.standaloneProjects.length === 0) ? '未发现 C# 项目' : undefined;
        })
    );

    // --- 切换当前显示的解决方案 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.switchSolution', async () => {
            const config = vscode.workspace.getConfiguration('csharpsolution');
            const excludes = config.get<string[]>('excludePatterns', []);
            const result = await ProjectDiscovery.scan(excludes);
            if (result.solutions.length <= 1) {
                vscode.window.showInformationMessage('工作区中只有一个解决方案');
                return;
            }
            const picked = await pickSolution(result.solutions);
            if (picked) {
                currentSolutionPath = picked;
            }
            // 切换后立即刷新（如果取消则保持当前选中）
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 在文件资源管理器中显示 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.revealInExplorer', async (node: ProjectNode) => {
            if (!node) return;

            let filePath: string | undefined;
            switch (node.type) {
                case 'project':
                    filePath = node.project.path;
                    break;
                case 'solution':
                    filePath = node.solution.path;
                    break;
                case 'file':
                    filePath = path.join(path.dirname(node.projectPath), node.compile.include);
                    break;
                case 'folder':
                    filePath = path.join(path.dirname(node.projectPath), node.relPath);
                    break;
            }

            if (filePath) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
            }
        })
    );

    // --- 在集成终端中打开 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.openInTerminal', async (node?: ProjectNode) => {
            node = node ?? treeView.selection[0];
            if (!node) return;

            let cwd: string | undefined;
            switch (node.type) {
                case 'project':
                    cwd = path.dirname(node.project.path);
                    break;
                case 'solution':
                    cwd = path.dirname(node.solution.path);
                    break;
                case 'folder':
                    cwd = path.join(path.dirname(node.projectPath), node.relPath);
                    break;
                case 'file':
                    cwd = path.dirname(path.join(path.dirname(node.projectPath), node.compile.include));
                    break;
            }

            if (cwd) {
                vscode.window.createTerminal({ cwd, name: path.basename(cwd) }).show();
            }
        })
    );

    // --- 编辑项目文件 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.editProjectFile', async (node: ProjectNode) => {
            if (!node) return;

            let filePath: string | undefined;
            if (node.type === 'project') {
                filePath = node.project.path;
            } else if (node.type === 'solution') {
                filePath = node.solution.path;
            }
            if (filePath) {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    // --- 切换标签页时自动选中对应文件节点（仅面板可见时生效） ---
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor?.document.uri.scheme === 'file' && treeView.visible) {
                const node = treeProvider.findNodeByUri(editor.document.uri);
                if (node) {
                    treeView.reveal(node, { select: true, focus: false, expand: true });
                }
            }
        })
    );
}
