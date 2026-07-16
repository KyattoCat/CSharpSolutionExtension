// src/extension.ts
import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/ProjectTreeProvider';
import { ProjectDiscovery } from './services/ProjectDiscovery';
import { CsprojService } from './services/CsprojService';
import { FileTemplateService } from './services/FileTemplateService';
import { FileService } from './services/FileService';
import { BuildService } from './services/BuildService';
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
            treeProvider.refresh({
                solutions: result.solutions,
                standaloneProjects: result.standaloneProjects,
                allProjects: result.allProjects,
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

    // --- 生成 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.build', async (node: ProjectNode) => {
            if (!node || node.type !== 'project') return;
            await BuildService.build(node.project.path, node.project.name);
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 清理 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.clean', async (node: ProjectNode) => {
            if (!node || node.type !== 'project') return;
            await BuildService.clean(node.project.path, node.project.name);
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 重新生成 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.rebuild', async (node: ProjectNode) => {
            if (!node || node.type !== 'project') return;
            await BuildService.rebuild(node.project.path, node.project.name);
            vscode.commands.executeCommand('csharpsolution.refresh');
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
