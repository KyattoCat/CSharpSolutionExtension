# Drag & Drop 文件/文件夹移动 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目树中支持拖拽 `file` 和 `dirFolder` 节点到同项目的其他文件夹或项目根，自动移动物理文件并更新 .csproj。

**Architecture:** 新建 `DragDropController` 实现 VS Code 的 `TreeDragAndDropController` 接口，`FileService` 新增 `moveFile` 方法来执行单个文件移动，`ProjectTreeProvider` 暴露 `allProjects` 属性供 controller 查询。

**Tech Stack:** TypeScript, VS Code Extension API (TreeView dragAndDropController), Node.js fs API

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/tree/ProjectTreeProvider.ts` | 修改 | `allProjects` private → public（暴露给 DragDropController） |
| `src/services/FileService.ts` | 修改 | 新增 `moveFile` 静态方法 |
| `src/test/FileService.test.ts` | 修改 | 新增 `moveFile` 测试用例 |
| `src/tree/DragDropController.ts` | 新建 | 实现 `TreeDragAndDropController<ProjectNode>` |
| `src/extension.ts` | 修改 | 创建 DragDropController 实例并传入 TreeView |

---

### Task 1: 暴露 ProjectTreeProvider.allProjects

**Files:**
- Modify: `src/tree/ProjectTreeProvider.ts:13`

- [ ] **Step 1: 将 allProjects 从 private 改为 public**

```typescript
// 第 13 行，将：
private allProjects: CsprojProject[] = [];

// 改为：
public allProjects: CsprojProject[] = [];
```

- [ ] **Step 2: 验证编译通过**

Run: `pnpm run compile`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add src/tree/ProjectTreeProvider.ts
git commit -m "refactor: make allProjects public for DragDropController access"
```

---

### Task 2: 添加 FileService.moveFile 方法

**Files:**
- Modify: `src/services/FileService.ts`
- Modify: `src/test/FileService.test.ts`

- [ ] **Step 1: 在 FileService 中新增 moveFile 方法**

在 `src/services/FileService.ts` 的 `deleteFile` 方法之后（第 116 行附近），新增：

```typescript
/**
 * 将文件从 oldRelPath 移动到 newRelPath。
 * 移动物理文件，对非 SDK 项目同步更新 .csproj 中的 Compile Include 路径。
 */
static async moveFile(
    projectPath: string,
    oldRelPath: string,
    newRelPath: string
): Promise<void> {
    const projectDir = path.dirname(projectPath);
    const oldAbsPath = path.join(projectDir, oldRelPath);
    const newAbsPath = path.join(projectDir, newRelPath);

    // 1. 验证源文件存在
    try {
        await fs.promises.access(oldAbsPath);
    } catch {
        throw new Error(`Source file not found: ${oldRelPath}`);
    }

    // 2. 安全检查 —— 目标文件不应存在（上层已做冲突检测）
    try {
        await fs.promises.access(newAbsPath);
        throw new Error(`Target file already exists: ${newRelPath}`);
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Target file already exists')) {
            throw err;
        }
        // 文件不存在 → 正常，继续
    }

    // 3. 确保目标目录存在
    const targetDir = path.dirname(newAbsPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    // 4. 读取 .csproj 判断是否为 SDK 项目
    const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
    const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);

    // 5. 移动物理文件
    await fs.promises.rename(oldAbsPath, newAbsPath);

    // 6. 更新 .csproj（非 SDK 项目）
    if (!isSdk) {
        const updatedContent = CsprojSerializer.updateCompilePath(
            csprojContent,
            oldRelPath,
            newRelPath
        );

        if (updatedContent === csprojContent) {
            // 回滚文件移动
            await fs.promises.rename(newAbsPath, oldAbsPath);
            throw new Error(`Path not found in csproj: ${oldRelPath}`);
        }

        await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');
    }
}
```

需要在文件顶部新增 import `CsprojSerializer`（如果尚未导入的话——当前 FileService 已导入 `CsprojSerializer`，确认无误）。

- [ ] **Step 2: 编译验证**

Run: `pnpm run compile`
Expected: 编译成功，无错误

- [ ] **Step 3: 编写测试 —— 基本移动**

在 `src/test/FileService.test.ts` 的末尾（在最后一个测试之后、`});` 闭合之前），新增：

```typescript
test('moveFile 移动文件到子目录并更新 .csproj', async () => {
    // 创建源文件
    await fs.promises.writeFile(
        path.join(tmpDir, 'OldFile.cs'),
        'namespace Test { public class OldFile { } }',
        'utf-8'
    );

    // 更新 csproj 引用
    const csprojWithFile = csprojContent.replace('OldName.cs', 'OldFile.cs');
    await fs.promises.writeFile(projectPath, csprojWithFile, 'utf-8');

    await FileService.moveFile(projectPath, 'OldFile.cs', 'SubDir/OldFile.cs');

    // 验证旧文件已删除
    try {
        await fs.promises.access(path.join(tmpDir, 'OldFile.cs'));
        assert.fail('old file should be deleted');
    } catch { /* expected */ }

    // 验证新文件存在
    await fs.promises.access(path.join(tmpDir, 'SubDir', 'OldFile.cs'));

    // 验证 .csproj 已更新
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.ok(csproj.includes('SubDir/OldFile.cs'));
    assert.ok(!csproj.includes('OldFile.cs'));
});
```

- [ ] **Step 4: 编写测试 —— 移动到项目根（目录变更）**

```typescript
test('moveFile 将子目录文件移到项目根', async () => {
    const subDir = path.join(tmpDir, 'Models');
    await fs.promises.mkdir(subDir, { recursive: true });
    await fs.promises.writeFile(
        path.join(subDir, 'MyModel.cs'),
        'class MyModel { }',
        'utf-8'
    );

    // 更新 csproj 引用子目录文件
    const csprojWithSub = csprojContent.replace('OldName.cs', 'Models/MyModel.cs');
    await fs.promises.writeFile(projectPath, csprojWithSub, 'utf-8');

    await FileService.moveFile(projectPath, 'Models/MyModel.cs', 'MyModel.cs');

    // 验证已移出子目录
    await fs.promises.access(path.join(tmpDir, 'MyModel.cs'));

    // 验证 .csproj 已更新
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.ok(csproj.includes('MyModel.cs'));
    assert.ok(!csproj.includes('Models/MyModel.cs'));
});
```

- [ ] **Step 5: 编写测试 —— 源文件不存在时报错**

```typescript
test('moveFile 源文件不存在时抛出错误', async () => {
    await assert.rejects(
        () => FileService.moveFile(projectPath, 'NonExistent.cs', 'Dest.cs'),
        /Source file not found/
    );
});
```

- [ ] **Step 6: 编译并运行测试**

Run: `pnpm run compile && pnpm test`
Expected: 编译成功，所有测试通过（包括新增的 3 个 moveFile 测试）

- [ ] **Step 7: Commit**

```bash
git add src/services/FileService.ts src/test/FileService.test.ts
git commit -m "feat: add FileService.moveFile for moving files between directories"
```

---

### Task 3: 创建 DragDropController

**Files:**
- Create: `src/tree/DragDropController.ts`

- [ ] **Step 1: 创建 DragDropController 类**

新建 `src/tree/DragDropController.ts`：

```typescript
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
                safeFiles.push(move); // 不存在了（可能被之前的覆盖操作删除）
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
```

- [ ] **Step 2: 编译验证**

Run: `pnpm run compile`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add src/tree/DragDropController.ts
git commit -m "feat: add DragDropController for tree drag-and-drop"
```

---

### Task 4: 在 extension.ts 中接入 DragDropController

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 导入 DragDropController**

在 `src/extension.ts` 顶部新增 import（在第 13 行 `import * as path from 'path';` 之后）：

```typescript
import { DragDropController } from './tree/DragDropController';
```

- [ ] **Step 2: 创建 DragDropController 并传入 TreeView**

将第 20-23 行的：

```typescript
const treeView = vscode.window.createTreeView('csharpsolution-projects', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
});
```

改为：

```typescript
const dragDropController = new DragDropController(treeProvider, () => {
    vscode.commands.executeCommand('csharpsolution.refresh');
});

const treeView = vscode.window.createTreeView('csharpsolution-projects', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    dragAndDropController: dragDropController,
});
```

注意：`dragDropController` 需要添加到 `context.subscriptions`（在第 26 行 `context.subscriptions.push(treeView);` 处）或保持局部变量。DragDropController 本身不持有 disposable 资源，仅 callback 中触发 refresh，故无需额外订阅。

- [ ] **Step 3: 编译验证**

Run: `pnpm run compile`
Expected: 编译成功，无错误

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire DragDropController into TreeView"
```

---

### Task 5: 运行完整测试套件

- [ ] **Step 1: 编译并运行全部测试**

Run: `pnpm run compile && pnpm test`
Expected: 所有测试通过，无回归

- [ ] **Step 2: 手动验证清单**

按 F5 启动扩展开发宿主，验证以下场景：

| # | 场景 | 预期 |
|---|------|------|
| 1 | 拖拽文件到子文件夹 | 文件移动，.csproj 更新，树刷新 |
| 2 | 拖拽文件夹到另一文件夹 | 整个文件夹移动，所有文件路径更新 |
| 3 | 拖拽文件到项目根 | 文件移到项目根目录 |
| 4 | 拖拽文件夹到目标存在同名文件 | 弹出冲突提示 |
| 5 | 选择"跳过" | 跳过该文件，继续处理其余 |
| 6 | 选择"覆盖" | 目标文件进回收站，源文件移入 |
| 7 | 选择"取消全部" | 操作终止 |
| 8 | 拖拽文件夹到自身 | 静默忽略 |
| 9 | 拖拽到非 folder/project 节点 | 不允许放落 |
| 10 | SDK 项目内拖拽 | 仅移动物理文件，不修改 .csproj |

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: address drag-drop issues found in manual testing"
```
