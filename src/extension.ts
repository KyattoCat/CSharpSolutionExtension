// src/extension.ts
import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/ProjectTreeProvider';
import { ProjectDiscovery } from './services/ProjectDiscovery';
import { BuildService } from './services/BuildService';
import { SlnService } from './services/SlnService';
import { GitStatusService } from './services/GitStatusService';
import { SvnStatusService } from './services/SvnStatusService';
import { ProjectNode } from './models/ProjectNode';
import * as path from 'path';
import { DragDropController } from './tree/DragDropController';
import { registerFileCommands } from './commands/fileCommands';

export function activate(context: vscode.ExtensionContext) {
    console.log('C# Project Manager extension activated');

    const treeProvider = new ProjectTreeProvider();

    const dragDropController = new DragDropController(treeProvider, () => {
        vscode.commands.executeCommand('csharpsolution.refresh');
    });

    const treeView = vscode.window.createTreeView('csharpsolution-projects', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
        dragAndDropController: dragDropController,
    });

    treeView.message = '扫描中...';
    context.subscriptions.push(treeView);

    registerFileCommands(context, treeProvider, treeView);

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

    // --- 生成 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.build', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'solution')) return;
            const targetPath = node.type === 'solution' ? node.solution.path : node.project.path;
            const targetName = node.type === 'solution' ? node.solution.name : node.project.name;
            await BuildService.build(targetPath, targetName);
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 清理 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.clean', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'solution')) return;
            const targetPath = node.type === 'solution' ? node.solution.path : node.project.path;
            const targetName = node.type === 'solution' ? node.solution.name : node.project.name;
            await BuildService.clean(targetPath, targetName);
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 重新生成 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.rebuild', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'solution')) return;
            const targetPath = node.type === 'solution' ? node.solution.path : node.project.path;
            const targetName = node.type === 'solution' ? node.solution.name : node.project.name;
            await BuildService.rebuild(targetPath, targetName);
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 添加已有项目到解决方案 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addExistingProject', async (node: ProjectNode) => {
            if (!node || node.type !== 'solution') return;

            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: '选择项目文件',
                filters: { 'C# 项目': ['csproj'] },
            });

            if (!files || files.length === 0) return;

            try {
                await SlnService.addProject(node.solution.path, files[0].fsPath);
                vscode.window.showInformationMessage(`已添加: ${path.basename(files[0].fsPath)}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `添加失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 添加新项目到解决方案 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addNewProject', async (node: ProjectNode) => {
            if (!node || node.type !== 'solution') return;

            const templates = await SlnService.getTemplates();
            const templateChoice = await vscode.window.showQuickPick(
                templates.map(t => ({ label: t.label, description: t.description, id: t.id })),
                { placeHolder: '选择项目模板' }
            );
            if (!templateChoice) return;

            const projectName = await vscode.window.showInputBox({
                prompt: '请输入项目名称',
                placeHolder: 'MyNewProject',
                validateInput: (value) => {
                    if (!value.trim()) return '项目名不能为空';
                    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(value)) return '项目名包含非法字符';
                    return null;
                },
            });
            if (!projectName) return;

            try {
                const slnDir = path.dirname(node.solution.path);
                await SlnService.createProject(node.solution.path, slnDir, templateChoice.id, projectName);
                vscode.window.showInformationMessage(`已创建项目: ${projectName}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `创建失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 从解决方案移除项目 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.removeProjectFromSolution', async (node: ProjectNode) => {
            if (!node || node.type !== 'project' || !node.solutionPath) return;

            const slnPath = node.solutionPath;
            const projectPath = node.project.path;

            const choice = await vscode.window.showWarningMessage(
                `从解决方案中移除 "${node.project.name}"？`,
                { modal: true },
                '仅移除引用',
                '移除并删除文件'
            );

            if (!choice) return;

            try {
                await SlnService.removeProject(slnPath, projectPath);
                vscode.window.showInformationMessage(`已从解决方案移除: ${node.project.name}`);

                if (choice === '移除并删除文件') {
                    const fileUri = vscode.Uri.file(projectPath);
                    await vscode.workspace.fs.delete(fileUri, { useTrash: true });
                }

                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `移除失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 文件监听（防抖 500ms）---
    const watcher = vscode.workspace.createFileSystemWatcher(
        '**/*.csproj',
        false, false, false
    );

    let debounceTimer: NodeJS.Timeout | undefined;
    const debouncedRefresh = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            vscode.commands.executeCommand('csharpsolution.refresh');
        }, 500);
    };

    watcher.onDidCreate(debouncedRefresh);
    watcher.onDidChange(debouncedRefresh);
    watcher.onDidDelete(debouncedRefresh);
    context.subscriptions.push(watcher);

    const slnWatcher = vscode.workspace.createFileSystemWatcher(
        '**/*.sln',
        false, false, false
    );
    slnWatcher.onDidCreate(debouncedRefresh);
    slnWatcher.onDidChange(debouncedRefresh);
    slnWatcher.onDidDelete(debouncedRefresh);
    context.subscriptions.push(slnWatcher);

    const slnxWatcher = vscode.workspace.createFileSystemWatcher(
        '**/*.slnx',
        false, false, false
    );
    slnxWatcher.onDidCreate(debouncedRefresh);
    slnxWatcher.onDidChange(debouncedRefresh);
    slnxWatcher.onDidDelete(debouncedRefresh);
    context.subscriptions.push(slnxWatcher);

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

    // --- 初始扫描 ---
    vscode.commands.executeCommand('csharpsolution.refresh');
}

export function deactivate() {}
