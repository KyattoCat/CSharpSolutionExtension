// src/commands/fileCommands.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectNode } from '../models/ProjectNode';
import { ProjectTreeProvider } from '../tree/ProjectTreeProvider';
import { CsprojService } from '../services/CsprojService';
import { FileTemplateService, TypeKind } from '../services/FileTemplateService';
import { FileService } from '../services/FileService';
import { DragNodeData, dedupeDragData, isLinkedPath } from '../tree/dragDropLogic';

/** 注册文件级命令：添加类 / 删除 / 重命名 / 添加现有文件 / 移除包 */
export function registerFileCommands(
    context: vscode.ExtensionContext,
    treeProvider: ProjectTreeProvider,
    treeView: vscode.TreeView<ProjectNode>
): void {
    // --- 新增文件（类/接口/枚举/结构体）---
    const registerAddType = (commandId: string, kind: TypeKind, label: string) => {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, async (node: ProjectNode) => {
                if (!node || (node.type !== 'project' && node.type !== 'folder')) return;
                if (node.type === 'folder' && isLinkedPath(node.relPath)) return;

                const projectPath = node.type === 'project' ? node.project.path : node.projectPath;
                const dirPath = node.type === 'folder' ? node.relPath : '';
                const projectName = path.basename(projectPath, '.csproj');

                const name = await vscode.window.showInputBox({
                    prompt: `请输入${label}名`,
                    placeHolder: kind === 'interface' ? 'INewInterface' : `New${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
                    validateInput: (value) => {
                        if (!FileTemplateService.isValidClassName(value)) {
                            if (!value.trim()) return `${label}名不能为空`;
                            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
                                return `${label}名必须为合法的 C# 标识符`;
                            }
                            return `"${value}" 是 C# 关键字，不能用作${label}名`;
                        }
                        return null;
                    },
                });
                if (!name) return;

                try {
                    const config = vscode.workspace.getConfiguration('csharpsolution');
                    const defaultNs = config.get<string>('defaultNamespace', '') || projectName;
                    await CsprojService.addType(projectPath, dirPath, name, kind, defaultNs);
                    vscode.window.showInformationMessage(`已创建${label}: ${name}.cs`);
                    vscode.commands.executeCommand('csharpsolution.refresh');
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `添加${label}失败: ${err instanceof Error ? err.message : String(err)}`
                    );
                }
            })
        );
    };
    registerAddType('csharpsolution.addClass', 'class', '类');
    registerAddType('csharpsolution.addInterface', 'interface', '接口');
    registerAddType('csharpsolution.addEnum', 'enum', '枚举');
    registerAddType('csharpsolution.addStruct', 'struct', '结构体');

    // --- 新建文件夹 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addFolder', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'folder')) return;
            if (node.type === 'folder' && isLinkedPath(node.relPath)) return;

            const projectPath = node.type === 'project' ? node.project.path : node.projectPath;
            const parentDir = node.type === 'folder' ? node.relPath : '';

            const folderName = await vscode.window.showInputBox({
                prompt: '请输入文件夹名',
                validateInput: (value) => {
                    const trimmed = value.trim();
                    if (!trimmed) return '文件夹名不能为空';
                    if (/[/\\:*?"<>|]/.test(trimmed)) return '文件夹名包含非法字符';
                    if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(trimmed)) return '文件夹名是 Windows 保留名称';
                    if (/[. ]$/.test(trimmed)) return '文件夹名不能以点或空格结尾';
                    return null;
                },
            });
            if (!folderName?.trim()) return;

            try {
                await CsprojService.addFolder(projectPath, parentDir, folderName.trim());
                vscode.window.showInformationMessage(`已创建文件夹: ${folderName.trim()}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `新建文件夹失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 删除文件/文件夹（支持多选批量）---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.deleteFile', async (node?: ProjectNode, nodes?: ProjectNode[]) => {
            const targets = collectBatchNodes(node, nodes, treeView, { excludeLinked: true });
            if (targets.length === 0) return;

            const project = treeProvider.allProjects.find(p => p.path === targets[0].projectPath);
            if (!project) {
                vscode.window.showErrorMessage('未找到项目，请刷新后重试');
                return;
            }

            // --- 单目标：保留原有确认语 ---
            if (targets.length === 1) {
                const t = targets[0];
                if (t.type === 'file') {
                    const fileName = path.basename(t.compile.include);
                    const confirm = await vscode.window.showWarningMessage(
                        `确定要删除 "${fileName}" 吗？\n文件将移至回收站，并从项目中移除。`,
                        { modal: true },
                        '确定删除'
                    );
                    if (confirm !== '确定删除') return;
                    try {
                        await FileService.deleteFile(t.projectPath, t.compile);
                        vscode.window.showInformationMessage(`已删除: ${fileName}`);
                        vscode.commands.executeCommand('csharpsolution.refresh');
                    } catch (err) {
                        vscode.window.showErrorMessage(
                            `删除失败: ${err instanceof Error ? err.message : String(err)}`
                        );
                    }
                    return;
                }

                const folderName = path.basename(t.relPath);
                const normalizedFolder = t.relPath.replace(/\\/g, '/');
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
                    await FileService.deleteFolder(t.projectPath, t.relPath, project.compiles);
                    vscode.window.showInformationMessage(`已删除文件夹: ${folderName}`);
                    vscode.commands.executeCommand('csharpsolution.refresh');
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `删除失败: ${err instanceof Error ? err.message : String(err)}`
                    );
                }
                return;
            }

            // --- 批量 ---
            const fileCount = targets.filter(t => t.type === 'file').length;
            const folderCount = targets.filter(t => t.type === 'folder').length;
            const parts: string[] = [];
            if (fileCount > 0) parts.push(`${fileCount} 个文件`);
            if (folderCount > 0) parts.push(`${folderCount} 个文件夹`);

            const confirm = await vscode.window.showWarningMessage(
                `确定要删除选中的 ${parts.join('和')} 吗？\n将移至回收站，并从项目中移除。`,
                { modal: true },
                '确定删除'
            );
            if (confirm !== '确定删除') return;

            let ok = 0;
            let fail = 0;
            for (const t of targets) {
                try {
                    if (t.type === 'file') {
                        await FileService.deleteFile(t.projectPath, t.compile);
                    } else {
                        await FileService.deleteFolder(t.projectPath, t.relPath, project.compiles);
                    }
                    ok++;
                } catch (err) {
                    fail++;
                    vscode.window.showErrorMessage(
                        `删除失败: ${t.type === 'file' ? t.compile.include : t.relPath}\n` +
                        `${err instanceof Error ? err.message : String(err)}`
                    );
                }
            }
            if (ok > 0) {
                vscode.window.showInformationMessage(
                    `已删除 ${ok} 个项目${fail > 0 ? `，失败 ${fail} 个` : ''}`
                );
                vscode.commands.executeCommand('csharpsolution.refresh');
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
            if (isLinkedPath(node.type === 'file' ? node.compile.include : node.relPath)) return;

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

    // --- 从项目排除（不删除物理文件，支持多选）---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.excludeFromProject', async (node?: ProjectNode, nodes?: ProjectNode[]) => {
            const targets = collectBatchNodes(node, nodes, treeView, { excludeLinked: false });
            if (targets.length === 0) return;

            const project = treeProvider.allProjects.find(p => p.path === targets[0].projectPath);
            if (!project) {
                vscode.window.showErrorMessage('未找到项目，请刷新后重试');
                return;
            }

            // 展开：文件 → include；文件夹 → 前缀匹配收集条目
            const includes: string[] = [];
            const seen = new Set<string>();
            const push = (include: string) => {
                const key = include.replace(/\\/g, '/');
                if (!seen.has(key)) {
                    seen.add(key);
                    includes.push(include);
                }
            };
            for (const t of targets) {
                if (t.type === 'file') {
                    push(t.compile.include);
                } else {
                    const nf = t.relPath.replace(/\\/g, '/');
                    const prefix = nf + '/';
                    for (const c of project.compiles) {
                        const p = c.include.replace(/\\/g, '/');
                        if (p === nf || p.startsWith(prefix)) {
                            push(c.include);
                        }
                    }
                }
            }
            if (includes.length === 0) {
                vscode.window.showInformationMessage('没有可排除的条目');
                return;
            }

            const sdkNote = project.isSdk
                ? '\n（SDK 项目通过 Compile Remove 排除，重新包含需手动编辑 .csproj）'
                : '';
            const confirm = await vscode.window.showWarningMessage(
                `将从项目排除 ${includes.length} 个条目（不删除物理文件）？${sdkNote}`,
                { modal: true },
                '确定排除'
            );
            if (confirm !== '确定排除') return;

            try {
                const n = await CsprojService.excludeFiles(project.path, includes);
                vscode.window.showInformationMessage(`已排除 ${n} 个条目`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `排除失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 复制文件路径 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.copyFilePath', async (node: ProjectNode) => {
            if (!node || node.type !== 'file') return;

            const projectDir = path.dirname(node.projectPath);
            const absPath = path.join(projectDir, node.compile.include);
            await vscode.env.clipboard.writeText(absPath);
            vscode.window.showInformationMessage(`已复制: ${path.basename(absPath)}`);
        })
    );
}

type FileOrFolderNode = ProjectNode & ({ type: 'file' } | { type: 'folder' });

/**
 * 收集批量操作的目标节点：
 * 右键多选时 VS Code 传 (clicked, selection[])，优先 nodes；键盘触发回退 treeView.selection。
 * 过滤为 file/folder；以首个有效节点的 projectPath 为准过滤跨项目节点；
 * 可选剔除 linked 节点；后代去重（复用 dedupeDragData）。
 */
function collectBatchNodes(
    node: ProjectNode | undefined,
    nodes: ProjectNode[] | undefined,
    treeView: vscode.TreeView<ProjectNode>,
    options: { excludeLinked: boolean }
): FileOrFolderNode[] {
    const raw: ProjectNode[] = (nodes && nodes.length > 0)
        ? nodes
        : (node ? [node] : [...treeView.selection]);

    let targets = raw.filter(
        (n): n is FileOrFolderNode => n.type === 'file' || n.type === 'folder'
    );
    if (targets.length === 0) return [];

    const projectPath = targets[0].projectPath;
    targets = targets.filter(n => n.projectPath === projectPath);

    if (options.excludeLinked) {
        targets = targets.filter(
            n => !isLinkedPath(n.type === 'file' ? n.compile.include : n.relPath)
        );
    }

    // 后代去重：文件夹与其子项同选时只保留文件夹
    const asDrag: DragNodeData[] = targets.map(n => ({
        type: n.type,
        projectPath: n.projectPath,
        nodePath: n.type === 'file' ? n.compile.include : n.relPath,
    }));
    const keep = new Set(
        dedupeDragData(asDrag).map(d => `${d.type}:${d.nodePath.replace(/\\/g, '/')}`)
    );
    return targets.filter(n => {
        const p = (n.type === 'file' ? n.compile.include : n.relPath).replace(/\\/g, '/');
        return keep.has(`${n.type}:${p}`);
    });
}
