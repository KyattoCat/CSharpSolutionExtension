import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectNode } from '../models/ProjectNode';
import { FileService } from '../services/FileService';
import { ProjectTreeProvider } from './ProjectTreeProvider';

/** handleDrag 时序列化的轻量节点数据 */
interface DragNodeData {
    type: 'file' | 'folder';
    projectPath: string;
    /** folder: relPath; file: compile.include */
    nodePath: string;
}

interface MoveTask {
    oldRelPath: string;
    newRelPath: string;
}

export class DragDropController implements vscode.TreeDragAndDropController<ProjectNode> {

    dropMimeTypes = ['application/vnd.code.tree.csharpsolution-projects'];
    dragMimeTypes = ['application/vnd.code.tree.csharpsolution-projects'];

    constructor(
        private treeProvider: ProjectTreeProvider,
        private onDidMove: () => void
    ) { }

    async handleDrag(
        source: readonly ProjectNode[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const dragData: DragNodeData[] = [];
        for (const node of source) {
            if (node.type === 'file') {
                dragData.push({
                    type: 'file',
                    projectPath: node.projectPath,
                    nodePath: node.compile.include,
                });
            } else if (node.type === 'folder') {
                dragData.push({
                    type: 'folder',
                    projectPath: node.projectPath,
                    nodePath: node.relPath,
                });
            }
            // 忽略其他类型节点（reference、package 等）
        }
        dataTransfer.set(
            'application/vnd.code.tree.csharpsolution-projects',
            new vscode.DataTransferItem(dragData)
        );
    }

    async handleDrop(
        target: ProjectNode | undefined,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // 目标必须存在且为 folder 或 project
        if (!target) return;
        if (target.type !== 'folder' && target.type !== 'project') return;

        const transferItem = dataTransfer.get('application/vnd.code.tree.csharpsolution-projects');
        if (!transferItem) return;

        const dragData: DragNodeData[] = transferItem.value;
        if (!dragData || dragData.length === 0) return;

        // --- 验证 ---

        const targetProjectPath =
            target.type === 'folder' ? target.projectPath : target.project.path;

        // 源节点必须都属于同一个项目
        for (const item of dragData) {
            if (item.projectPath !== targetProjectPath) {
                return; // 跨项目移动不在范围内，静默忽略
            }
        }

        // 计算目标目录（相对路径，POSIX 风格）
        const targetDir = target.type === 'folder'
            ? target.relPath.replace(/\\/g, '/')
            : '';

        // 检测循环：不能将文件夹拖入其自身或子目录
        for (const item of dragData) {
            if (item.type === 'folder') {
                const normalizedSrc = item.nodePath.replace(/\\/g, '/');
                if (normalizedSrc === targetDir) return; // 放到自身
                if (targetDir.startsWith(normalizedSrc + '/')) return; // 放到子目录
            }
        }

        // 查找项目数据
        const project = this.treeProvider.allProjects.find(
            p => p.path === targetProjectPath
        );
        if (!project) return;

        // --- 展开文件列表 ---

        const moves: MoveTask[] = this.expandMoves(dragData, targetDir, project);

        if (moves.length === 0) return; // 全部是 no-op

        const projectDir = path.dirname(targetProjectPath);
        const targetDisplayName = targetDir || path.basename(targetProjectPath, '.csproj');

        // --- 冲突检测 ---

        const { safeFiles, conflictCount } = await this.detectConflicts(moves, projectDir);
        if (conflictCount === 0 && safeFiles.length === 0) return;

        // --- 处理冲突 ---

        let skippedCount = 0;
        if (conflictCount > 0) {
            const result = await this.resolveConflicts(
                moves, projectDir, safeFiles, targetDisplayName
            );
            if (result === null) return; // 用户取消
            skippedCount = result;
        }

        // --- 执行移动 ---

        if (safeFiles.length === 0) return; // 全部跳过

        let movedCount = 0;
        for (const move of safeFiles) {
            try {
                await FileService.moveFile(
                    targetProjectPath,
                    move.oldRelPath,
                    move.newRelPath
                );
                movedCount++;
            } catch (err) {
                vscode.window.showErrorMessage(
                    `移动失败: ${move.oldRelPath} → ${move.newRelPath}\n` +
                    `${err instanceof Error ? err.message : String(err)}`
                );
            }
        }

        // --- 汇总消息 ---

        if (movedCount > 0 && skippedCount === 0) {
            vscode.window.showInformationMessage(
                `已移动 ${movedCount} 个文件到 "${targetDisplayName}"`
            );
        } else if (movedCount > 0 && skippedCount > 0) {
            vscode.window.showInformationMessage(
                `已移动 ${movedCount} 个文件到 "${targetDisplayName}"，跳过 ${skippedCount} 个冲突文件`
            );
        }

        this.onDidMove();
    }

    // --- Private helpers ---

    /** 将拖拽节点展开为 oldRelPath → newRelPath 的移动任务列表 */
    private expandMoves(
        dragData: DragNodeData[],
        targetDir: string,
        project: { compiles: { include: string }[] }
    ): MoveTask[] {
        const moves: MoveTask[] = [];

        for (const item of dragData) {
            if (item.type === 'file') {
                const fileName = path.basename(item.nodePath);
                const newRelPath = targetDir
                    ? path.posix.join(targetDir, fileName)
                    : fileName;
                const normalizedOld = item.nodePath.replace(/\\/g, '/');
                if (normalizedOld === newRelPath) continue; // no-op
                moves.push({ oldRelPath: item.nodePath, newRelPath });
            } else if (item.type === 'folder') {
                const normalizedSrc = item.nodePath.replace(/\\/g, '/');
                const folderName = path.posix.basename(normalizedSrc);
                const prefix = normalizedSrc + '/';

                for (const compile of project.compiles) {
                    const compilePath = compile.include.replace(/\\/g, '/');
                    if (compilePath === normalizedSrc || compilePath.startsWith(prefix)) {
                        const relativePart = compilePath.slice(normalizedSrc.length + 1);
                        const newRelPath = targetDir
                            ? path.posix.join(targetDir, folderName, relativePart)
                            : path.posix.join(folderName, relativePart);
                        const normalizedNew = newRelPath;
                        if (compilePath !== normalizedNew) {
                            moves.push({
                                oldRelPath: compile.include,
                                newRelPath,
                            });
                        }
                    }
                }
            }
        }

        return moves;
    }

    /**
     * 检测文件冲突。
     * 返回已分类的安全文件和冲突文件数量。
     * safeFiles 被原地修改：添加无冲突的文件。
     */
    private async detectConflicts(
        moves: MoveTask[],
        projectDir: string
    ): Promise<{ safeFiles: MoveTask[]; conflictCount: number }> {
        const safeFiles: MoveTask[] = [];
        let conflictCount = 0;

        for (const move of moves) {
            const targetAbs = path.join(projectDir, move.newRelPath);
            try {
                await fs.promises.access(targetAbs);
                conflictCount++; // 目标文件存在 → 冲突
            } catch {
                safeFiles.push(move); // 目标文件不存在 → 安全
            }
        }

        return { safeFiles, conflictCount };
    }

    /**
     * 对存在冲突的文件逐个询问用户。
     * 返回跳过的文件数量，或 null 表示用户取消全部。
     * safeFiles 被原地修改：添加用户选择覆盖的文件。
     */
    private async resolveConflicts(
        moves: MoveTask[],
        projectDir: string,
        safeFiles: MoveTask[],
        targetDisplayName: string
    ): Promise<number | null> {
        let skippedCount = 0;

        for (const move of moves) {
            // 检查是否有冲突（再次确认目标文件存在）
            const targetAbs = path.join(projectDir, move.newRelPath);
            try {
                await fs.promises.access(targetAbs);
            } catch {
                // 无冲突的文件已在 detectConflicts 中加入 safeFiles，此处跳过避免重复添加
                continue;
            }

            const choice = await vscode.window.showQuickPick(
                [
                    { label: '跳过', description: '跳过此文件，不移动' },
                    { label: '覆盖', description: '将目标文件移至回收站后移动源文件' },
                    { label: '取消全部', description: '终止整个操作' },
                ],
                { placeHolder: `目标已存在同名文件: ${move.newRelPath}` }
            );

            if (!choice || choice.label === '取消全部') {
                // 此时尚未执行任何移动，直接返回 null 终止操作
                return null;
            }

            if (choice.label === '跳过') {
                skippedCount++;
                continue;
            }

            if (choice.label === '覆盖') {
                await vscode.workspace.fs.delete(
                    vscode.Uri.file(targetAbs),
                    { useTrash: true }
                );
                safeFiles.push(move);
            }
        }

        return skippedCount;
    }
}
