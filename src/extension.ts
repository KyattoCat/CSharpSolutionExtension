// src/extension.ts
import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/ProjectTreeProvider';
import { ProjectDiscovery } from './services/ProjectDiscovery';
import { CsprojService } from './services/CsprojService';
import { FileTemplateService } from './services/FileTemplateService';
import { FileService } from './services/FileService';
import { BuildService } from './services/BuildService';
import { SlnService } from './services/SlnService';
import { GitStatusService } from './services/GitStatusService';
import { SvnStatusService } from './services/SvnStatusService';
import { ProjectNode } from './models/ProjectNode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('C# Project Manager extension activated');

    const treeProvider = new ProjectTreeProvider();

    const treeView = vscode.window.createTreeView('csharpsolution-projects', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });

    treeView.message = '扫描中...';
    context.subscriptions.push(treeView);

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

    // --- 添加类 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addClass', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'folder')) return;

            const projectPath = node.type === 'project' ? node.project.path : node.projectPath;
            const dirPath = node.type === 'folder' ? node.relPath : '';
            const projectName = path.basename(projectPath, '.csproj');

            const className = await vscode.window.showInputBox({
                prompt: '请输入类名',
                placeHolder: 'NewClass',
                validateInput: (value) => {
                    if (!FileTemplateService.isValidClassName(value)) {
                        if (!value.trim()) return '类名不能为空';
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
                            return '类名必须为合法的 C# 标识符';
                        }
                        return `"${value}" 是 C# 关键字，不能用作类名`;
                    }
                    return null;
                },
            });

            if (!className) return;

            try {
                const config = vscode.workspace.getConfiguration('csharpsolution');
                const defaultNs = config.get<string>('defaultNamespace', '') || projectName;
                const template = config.get<string[]>('classTemplate', getDefaultTemplate());

                await CsprojService.addClass(projectPath, dirPath, className, defaultNs, template);
                vscode.window.showInformationMessage(`已创建类: ${className}.cs`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `添加类失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 删除文件 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.deleteFile', async (node: ProjectNode) => {
            if (!node || node.type !== 'file') return;

            const fileName = path.basename(node.compile.include);
            const confirm = await vscode.window.showWarningMessage(
                `确定要删除 "${fileName}" 吗？\n文件将移至回收站，并从项目中移除。`,
                { modal: true },
                '确定删除'
            );

            if (confirm !== '确定删除') return;

            try {
                await FileService.deleteFile(node.projectPath, node.compile);
                vscode.window.showInformationMessage(`已删除: ${fileName}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `删除失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 添加现有文件 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addExistingFile', async (node: ProjectNode) => {
            if (!node || node.type !== 'project') return;

            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: '选择 C# 文件',
                filters: { 'C# 文件': ['cs'] },
            });

            if (!files || files.length === 0) return;

            try {
                await CsprojService.addExistingFile(node.project.path, files[0]);
                vscode.window.showInformationMessage(
                    `已添加: ${path.basename(files[0].fsPath)}`
                );
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `添加文件失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 重命名文件 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.renameFile', async (node: ProjectNode) => {
            if (!node || node.type !== 'file') return;

            const oldName = path.basename(node.compile.include, '.cs');
            const newName = await vscode.window.showInputBox({
                prompt: '请输入新文件名（不含扩展名）',
                value: oldName,
                validateInput: (value) => {
                    if (!FileTemplateService.isValidClassName(value)) {
                        if (!value.trim()) return '文件名不能为空';
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
                            return '文件名必须为合法的 C# 标识符';
                        }
                        return `"${value}" 是 C# 关键字，不能用作文件名`;
                    }
                    if (value === oldName) return '新文件名与旧文件名相同';
                    return null;
                },
            });

            if (!newName) return;

            try {
                const config = vscode.workspace.getConfiguration('csharpsolution');
                const syncCode = config.get<boolean>('renameSyncCode', true);
                await FileService.renameFile(node.projectPath, node.compile, newName, syncCode);
                vscode.window.showInformationMessage(`已重命名: ${oldName}.cs → ${newName}.cs`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `重命名失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
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

    // --- 移除 NuGet 包 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.removePackage', async (node: ProjectNode) => {
            if (!node || node.type !== 'package') return;

            const confirm = await vscode.window.showWarningMessage(
                `确定要从 packages.config 中移除 "${node.item.id}" 吗？`,
                { modal: true },
                '确定移除'
            );

            if (confirm !== '确定移除') return;

            try {
                await CsprojService.removePackage(node.projectPath, node.item.id);
                vscode.window.showInformationMessage(`已移除包: ${node.item.id}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `移除包失败: ${err instanceof Error ? err.message : String(err)}`
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

    // --- 编辑器切换时自动选中树节点 ---
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor?.document.uri.scheme === 'file') {
                // reveal 接受 resourceUri 对象，通过 resourceUri 匹配树节点
                treeView.reveal({ resourceUri: editor.document.uri } as any, { select: true, focus: false });
            }
        })
    );

    // --- 初始扫描 ---
    vscode.commands.executeCommand('csharpsolution.refresh');
}

export function deactivate() {}

function getDefaultTemplate(): string[] {
    return [
        'using System;',
        '',
        'namespace {namespace}',
        '{',
        '    public class {className}',
        '    {',
        '        ',
        '    }',
        '}',
        '',
    ];
}
