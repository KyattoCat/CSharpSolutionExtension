import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojProject } from '../models/CsprojModel';
import { ProjectNode } from '../models/ProjectNode';
import { FileService } from '../services/FileService';
import { ProjectTreeProvider } from './ProjectTreeProvider';
import { DragNodeData, MoveTask, dedupeDragData, detectCycle, expandMoves, isLinkedPath } from './dragDropLogic';

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
                if (isLinkedPath(node.compile.include)) continue;
                dragData.push({
                    type: 'file',
                    projectPath: node.projectPath,
                    nodePath: node.compile.include,
                });
            } else if (node.type === 'folder') {
                if (isLinkedPath(node.relPath)) continue;
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

        const rawDragData: DragNodeData[] = transferItem.value;
        if (!rawDragData || rawDragData.length === 0) return;

        // --- 验证 ---

        const targetProjectPath =
            target.type === 'folder' ? target.projectPath : target.project.path;

        // 源节点必须都属于同一个项目
        for (const item of rawDragData) {
            if (item.projectPath !== targetProjectPath) {
                return; // 跨项目移动不在范围内，静默忽略
            }
        }

        // 多选去重：移除重复项及已被其他拖拽文件夹包含的后代节点
        const dragData = dedupeDragData(rawDragData);

        // 计算目标目录（相对路径，POSIX 风格）
        const targetDir = target.type === 'folder'
            ? target.relPath.replace(/\\/g, '/')
            : '';

        // 检测循环：不能将文件夹拖入其自身或子目录
        const cycle = detectCycle(dragData, targetDir);
        if (cycle === 'self') return; // 放到自身 → 静默忽略
        if (cycle === 'descendant') {
            vscode.window.showWarningMessage('不能将文件夹移动到其子目录中');
            return;
        }

        // 查找项目数据
        const project = this.treeProvider.allProjects.find(
            p => p.path === targetProjectPath
        );
        if (!project) return;

        // --- 展开文件列表 ---

        const moves: MoveTask[] = expandMoves(dragData, targetDir, project.compiles);

        if (moves.length === 0) return; // 全部是 no-op

        const projectDir = path.dirname(targetProjectPath);
        const targetDisplayName = targetDir || path.basename(targetProjectPath, '.csproj');

        // --- 冲突检测 ---

        const { safe, conflicts } = await this.detectConflicts(moves, projectDir);

        // --- 处理冲突（仅收集决策，不产生副作用）---

        let skippedCount = 0;
        let overwrites: MoveTask[] = [];
        if (conflicts.length > 0) {
            const result = await this.resolveConflicts(conflicts);
            if (result === null) return; // 用户取消全部 —— 此时无任何副作用
            skippedCount = result.skippedCount;
            overwrites = result.overwrites;
        }

        // --- 执行移动 ---

        const tasks = [...safe, ...overwrites];

        let movedCount = 0;
        let anyChange = false;

        for (const move of tasks) {
            if (move.overwrite) {
                // 覆盖：先移除目标文件（及其 csproj 条目），失败则跳过该文件
                try {
                    await this.removeTarget(project, targetProjectPath, projectDir, move.newRelPath);
                    anyChange = true;
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `覆盖目标失败，已跳过: ${move.newRelPath}\n` +
                        `${err instanceof Error ? err.message : String(err)}`
                    );
                    skippedCount++;
                    continue;
                }
            }
            try {
                await FileService.moveFile(
                    targetProjectPath,
                    move.oldRelPath,
                    move.newRelPath
                );
                movedCount++;
                anyChange = true;
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
        } else if (movedCount === 0 && skippedCount > 0) {
            vscode.window.showInformationMessage(`已跳过 ${skippedCount} 个文件`);
        }

        if (anyChange) {
            this.onDidMove();
        }
    }

    // --- Private helpers ---

    /** 按目标文件是否已存在，将移动任务分为安全组（safe）和冲突组（conflicts） */
    private async detectConflicts(
        moves: MoveTask[],
        projectDir: string
    ): Promise<{ safe: MoveTask[]; conflicts: MoveTask[] }> {
        const safe: MoveTask[] = [];
        const conflicts: MoveTask[] = [];

        for (const move of moves) {
            const targetAbs = path.join(projectDir, move.newRelPath);
            try {
                await fs.promises.access(targetAbs);
                conflicts.push(move); // 目标文件存在 → 冲突
            } catch {
                safe.push(move); // 目标文件不存在 → 安全
            }
        }

        return { safe, conflicts };
    }

    /**
     * 对冲突文件逐个询问用户。仅收集决策，不产生任何副作用
     * （目标文件的删除延迟到执行阶段，确保「取消全部」真正无副作用）。
     * 返回覆盖任务列表和跳过数量，或 null 表示用户取消全部。
     */
    private async resolveConflicts(
        conflicts: MoveTask[]
    ): Promise<{ overwrites: MoveTask[]; skippedCount: number } | null> {
        const overwrites: MoveTask[] = [];
        let skippedCount = 0;

        for (const move of conflicts) {
            const choice = await vscode.window.showQuickPick(
                [
                    { label: '跳过', description: '跳过此文件，不移动' },
                    { label: '覆盖', description: '将目标文件移至回收站后移动源文件' },
                    { label: '取消全部', description: '终止整个操作' },
                ],
                { placeHolder: `目标已存在同名文件: ${move.newRelPath}` }
            );

            if (!choice || choice.label === '取消全部') {
                return null; // 尚未产生任何副作用，直接取消
            }

            if (choice.label === '跳过') {
                skippedCount++;
                continue;
            }

            // 覆盖：仅标记，删除动作延迟到执行阶段
            overwrites.push({ ...move, overwrite: true });
        }

        return { overwrites, skippedCount };
    }

    /**
     * 覆盖前移除目标：若目标路径存在于项目的 Compile 列表中，
     * 使用 FileService.deleteFile 同时移除 csproj 条目与物理文件（避免移动后产生重复条目）；
     * 否则仅将物理文件移至回收站。
     */
    private async removeTarget(
        project: CsprojProject,
        projectPath: string,
        projectDir: string,
        newRelPath: string
    ): Promise<void> {
        const normalizedTarget = newRelPath.replace(/\\/g, '/');
        const targetCompile = project.compiles.find(
            c => c.include.replace(/\\/g, '/') === normalizedTarget
        );

        if (targetCompile) {
            await FileService.deleteFile(projectPath, targetCompile);
        } else {
            await vscode.workspace.fs.delete(
                vscode.Uri.file(path.join(projectDir, newRelPath)),
                { useTrash: true }
            );
        }
    }
}
