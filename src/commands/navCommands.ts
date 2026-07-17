// src/commands/navCommands.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectNode } from '../models/ProjectNode';
import { ProjectTreeProvider } from '../tree/ProjectTreeProvider';
import { ProjectDiscovery } from '../services/ProjectDiscovery';
import { GitStatusService } from '../services/GitStatusService';
import { SvnStatusService } from '../services/SvnStatusService';

/** 注册导航类命令：刷新 / 资源管理器显示 / 集成终端 / 编辑器→树联动 */
export function registerNavCommands(
    context: vscode.ExtensionContext,
    treeProvider: ProjectTreeProvider,
    treeView: vscode.TreeView<ProjectNode>
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
            let gitStatusMap: Map<string, string> = new Map();
            if (vcs === 'git') {
                gitStatusMap = rootPath ? await GitStatusService.getStatus(rootPath) : new Map();
            } else if (vcs === 'svn') {
                gitStatusMap = rootPath ? await SvnStatusService.getStatus(rootPath) : new Map();
            }
            treeProvider.refresh({
                solutions: result.solutions,
                standaloneProjects: result.standaloneProjects,
                allProjects: result.allProjects,
                gitStatusMap,
            });
            treeView.message = (result.solutions.length === 0 && result.standaloneProjects.length === 0) ? '未发现 C# 项目' : undefined;
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
