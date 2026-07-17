import * as path from 'path';
import { CompileItem } from '../models/CsprojModel';

/** handleDrag 时序列化的轻量节点数据 */
export interface DragNodeData {
    type: 'file' | 'folder';
    projectPath: string;
    /** folder: relPath; file: compile.include */
    nodePath: string;
}

export interface MoveTask {
    oldRelPath: string;
    newRelPath: string;
    /** 覆盖模式：执行阶段先移除目标文件（及其 csproj 条目）再移动 */
    overwrite?: boolean;
}

/** 多选去重：移除重复项，以及已被另一拖拽文件夹包含的后代节点（后代随文件夹整体移动） */
export function dedupeDragData(dragData: DragNodeData[]): DragNodeData[] {
    const folderPaths = dragData
        .filter(d => d.type === 'folder')
        .map(d => d.nodePath.replace(/\\/g, '/'));

    const seen = new Set<string>();
    return dragData.filter(item => {
        const itemPath = item.nodePath.replace(/\\/g, '/');
        const key = `${item.type}:${itemPath}`;
        if (seen.has(key)) return false; // 重复项
        seen.add(key);
        // 位于某个被拖拽文件夹之内 → 过滤，避免产生重复移动任务
        return !folderPaths.some(fp => fp !== itemPath && itemPath.startsWith(fp + '/'));
    });
}

/**
 * 检测循环：文件夹拖入其自身返回 'self'（调用方静默忽略），
 * 拖入其子目录返回 'descendant'（调用方警告并阻止），否则 null。
 */
export function detectCycle(dragData: DragNodeData[], targetDir: string): 'self' | 'descendant' | null {
    for (const item of dragData) {
        if (item.type === 'folder') {
            const normalizedSrc = item.nodePath.replace(/\\/g, '/');
            if (normalizedSrc === targetDir) return 'self';
            if (targetDir.startsWith(normalizedSrc + '/')) return 'descendant';
        }
    }
    return null;
}

/** 判断是否为链接路径（指向项目目录之外）：POSIX 归一化后等于 '..' 或以 '../' 开头 */
export function isLinkedPath(relPath: string): boolean {
    const p = relPath.replace(/\\/g, '/');
    return p === '..' || p.startsWith('../');
}

/** 将拖拽节点展开为 oldRelPath → newRelPath 的移动任务列表 */
export function expandMoves(
    dragData: DragNodeData[],
    targetDir: string,
    compiles: CompileItem[]
): MoveTask[] {
    const moves: MoveTask[] = [];
    const seenOldPaths = new Set<string>();

    // 安全网：按 oldRelPath 去重；新路径分隔符风格与源条目保持一致，
    // 避免传统反斜杠 csproj 漂移为混合风格（比较始终用 POSIX 风格）
    const pushMove = (oldRelPath: string, newPosixRelPath: string) => {
        const normalizedOld = oldRelPath.replace(/\\/g, '/');
        if (seenOldPaths.has(normalizedOld)) return;
        seenOldPaths.add(normalizedOld);
        const newRelPath = oldRelPath.includes('\\')
            ? newPosixRelPath.replace(/\//g, '\\')
            : newPosixRelPath;
        moves.push({ oldRelPath, newRelPath });
    };

    for (const item of dragData) {
        if (item.type === 'file') {
            const normalizedOld = item.nodePath.replace(/\\/g, '/');
            const fileName = path.posix.basename(normalizedOld);
            const newRelPath = targetDir
                ? path.posix.join(targetDir, fileName)
                : fileName;
            if (normalizedOld === newRelPath) continue; // no-op
            pushMove(item.nodePath, newRelPath);
        } else if (item.type === 'folder') {
            const normalizedSrc = item.nodePath.replace(/\\/g, '/');
            const folderName = path.posix.basename(normalizedSrc);
            const prefix = normalizedSrc + '/';

            for (const compile of compiles) {
                const compilePath = compile.include.replace(/\\/g, '/');
                if (compilePath === normalizedSrc || compilePath.startsWith(prefix)) {
                    const relativePart = compilePath.slice(normalizedSrc.length + 1);
                    const newRelPath = targetDir
                        ? path.posix.join(targetDir, folderName, relativePart)
                        : path.posix.join(folderName, relativePart);
                    if (compilePath !== newRelPath) {
                        pushMove(compile.include, newRelPath);
                    }
                }
            }
        }
    }

    return moves;
}
