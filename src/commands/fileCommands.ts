// src/commands/fileCommands.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectNode } from '../models/ProjectNode';
import { ProjectTreeProvider } from '../tree/ProjectTreeProvider';
import { CsprojService } from '../services/CsprojService';
import { FileTemplateService } from '../services/FileTemplateService';
import { FileService } from '../services/FileService';

/** 注册文件级命令：添加类 / 删除 / 重命名 / 添加现有文件 / 移除包 */
export function registerFileCommands(
    context: vscode.ExtensionContext,
    treeProvider: ProjectTreeProvider,
    treeView: vscode.TreeView<ProjectNode>
): void {
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
                const template = config.get<string[]>('classTemplate') || DEFAULT_CLASS_TEMPLATE;

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

    // --- 删除文件/文件夹 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.deleteFile', async (node?: ProjectNode) => {
            node = node ?? treeView.selection[0];
            if (!node || (node.type !== 'file' && node.type !== 'folder')) return;

            if (node.type === 'file') {
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
                return;
            }

            // folder 节点
            const project = treeProvider.allProjects.find(p => p.path === node.projectPath);
            if (!project) {
                vscode.window.showErrorMessage('未找到项目，请刷新后重试');
                return;
            }

            const folderName = path.basename(node.relPath);
            const normalizedFolder = node.relPath.replace(/\\/g, '/');
            const prefix = normalizedFolder + '/';
            const fileCount = project.compiles.filter(c => {
                const p = c.include.replace(/\\/g, '/');
                return p === normalizedFolder || p.startsWith(prefix);
            }).length;

            const confirm = await vscode.window.showWarningMessage(
                `确定要删除文件夹 "${folderName}" 及其中 ${fileCount} 个文件吗？\n文件夹将移至回收站，并从项目中移除。`,
                { modal: true },
                '确定删除'
            );
            if (confirm !== '确定删除') return;

            try {
                await FileService.deleteFolder(node.projectPath, node.relPath, project.compiles);
                vscode.window.showInformationMessage(`已删除文件夹: ${folderName}`);
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

    // --- 重命名文件/文件夹 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.renameFile', async (node?: ProjectNode) => {
            node = node ?? treeView.selection[0];
            if (!node || (node.type !== 'file' && node.type !== 'folder')) return;

            if (node.type === 'file') {
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
                return;
            }

            // folder 节点
            const oldFolderName = path.basename(node.relPath);
            const newFolderName = await vscode.window.showInputBox({
                prompt: '请输入新文件夹名',
                value: oldFolderName,
                validateInput: (value) => {
                    const trimmed = value.trim();
                    if (!trimmed) return '文件夹名不能为空';
                    if (/[/\\:*?"<>|]/.test(trimmed)) return '文件夹名包含非法字符';
                    if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(trimmed)) return '文件夹名是 Windows 保留名称';
                    if (/[. ]$/.test(trimmed)) return '文件夹名不能以点或空格结尾';
                    if (trimmed === oldFolderName) return '新文件夹名与旧文件夹名相同';
                    return null;
                },
            });
            if (!newFolderName?.trim()) return;
            const trimmedFolderName = newFolderName.trim();

            try {
                await FileService.renameFolder(node.projectPath, node.relPath, trimmedFolderName);
                vscode.window.showInformationMessage(`已重命名文件夹: ${oldFolderName} → ${trimmedFolderName}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `重命名失败: ${err instanceof Error ? err.message : String(err)}`
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
}

const DEFAULT_CLASS_TEMPLATE = [
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
