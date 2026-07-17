# 技术债清理 — 实现计划（子项目 A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理四项技术债（isSdk 提取、deleteFolder 回滚、dragDropLogic 提取+单测、extension.ts 拆分），全程不改变外部行为。

**Architecture:** 逐项小步提交。`CsprojSerializer.isSdk` 统一 SDK 检测；`deleteFolder` 物理删除失败回滚 csproj；DragDropController 纯逻辑迁入无 vscode 依赖的 `dragDropLogic.ts` 并补单测；`extension.ts` 按领域拆为 4 个 commands 模块。

**Tech Stack:** TypeScript, VS Code Extension API, Mocha

**重构纪律：所有代码搬移必须逐字原样，禁止顺手修改逻辑。行为变更是子项目 B 的事。**

---

## 文件结构

| 文件 | 操作 |
|------|------|
| `src/serialization/CsprojSerializer.ts` | 修改：新增 `isSdk` 静态方法 |
| `src/services/FileService.ts` | 修改：5 处正则替换为 `CsprojSerializer.isSdk`；deleteFolder 回滚 |
| `src/test/CsprojSerializer.test.ts` | 修改：+isSdk 测试 |
| `src/test/FileService.test.ts` | 修改：+deleteFolder 回滚测试 |
| `src/tree/dragDropLogic.ts` | 新建：纯函数模块 |
| `src/test/dragDropLogic.test.ts` | 新建：~10 个用例 |
| `src/tree/DragDropController.ts` | 修改：改用 dragDropLogic |
| `src/commands/fileCommands.ts` | 新建 |
| `src/commands/projectCommands.ts` | 新建 |
| `src/commands/navCommands.ts` | 新建 |
| `src/commands/watchers.ts` | 新建 |
| `src/extension.ts` | 修改：只留组装（<80 行） |

---

### Task 1: 提取 CsprojSerializer.isSdk

**Files:**
- Modify: `src/serialization/CsprojSerializer.ts`
- Modify: `src/services/FileService.ts`
- Test: `src/test/CsprojSerializer.test.ts`

- [ ] **Step 1: 写测试**

在 `src/test/CsprojSerializer.test.ts` 末尾（suite 闭合前）新增：

```typescript
test('isSdk 识别 SDK 风格项目', () => {
    assert.strictEqual(CsprojSerializer.isSdk('<Project Sdk="Microsoft.NET.Sdk">'), true);
    assert.strictEqual(CsprojSerializer.isSdk('<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">'), false);
    assert.strictEqual(CsprojSerializer.isSdk(''), false);
});
```

- [ ] **Step 2: 编译验证失败**

Run: `pnpm run compile`
Expected: 编译错误 —— `isSdk` 不存在

- [ ] **Step 3: 实现 isSdk 并替换所有调用点**

在 `src/serialization/CsprojSerializer.ts` 的 `parse` 方法之前新增：

```typescript
/** 判断是否为 SDK 风格项目（<Project Sdk="...">） */
static isSdk(xml: string): boolean {
    return /<Project\s+Sdk="[^"]*"/.test(xml);
}
```

`parse` 内部（第 14 行）改为：

```typescript
const isSdk = this.isSdk(xml);
```

`src/services/FileService.ts` 中 5 处（renameFile:34 / deleteFile:92 / moveFile:151 / deleteFolder:225 / renameFolder:307）：

```typescript
// 将：
const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);
// 替换为：
const isSdk = CsprojSerializer.isSdk(csprojContent);
```

替换后确认 FileService 中不再有 `<Project\s+Sdk` 字面正则（用 Grep 验证）。

- [ ] **Step 4: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（74 + 1 = 75）

- [ ] **Step 5: Commit**

```bash
git add src/serialization/CsprojSerializer.ts src/services/FileService.ts src/test/CsprojSerializer.test.ts
git commit -m "refactor: extract CsprojSerializer.isSdk, replace 6 duplicated regexes"
```

---

### Task 2: deleteFolder 物理删除失败回滚 csproj

**Files:**
- Modify: `src/services/FileService.ts`（deleteFolder 的 try/catch）
- Test: `src/test/FileService.test.ts`

- [ ] **Step 1: 写测试**

在 `src/test/FileService.test.ts` 末尾（suite 闭合前）新增：

```typescript
test('deleteFolder 物理删除失败时回滚 csproj', async () => {
    // csproj 有条目，但物理目录不存在 → workspace.fs.delete 抛 FileNotFound
    const csprojGhost = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="GhostDir/G.cs" />
    <Compile Include="Stay.cs" />
  </ItemGroup>
</Project>`;
    await fs.promises.writeFile(projectPath, csprojGhost, 'utf-8');
    await fs.promises.writeFile(path.join(tmpDir, 'Stay.cs'), 'class Stay { }', 'utf-8');
    // 注意：不创建 GhostDir 物理目录

    const compiles = [
        { include: 'GhostDir/G.cs' },
        { include: 'Stay.cs' },
    ];

    await assert.rejects(
        () => FileService.deleteFolder(projectPath, 'GhostDir', compiles),
        /Failed to delete folder/
    );

    // csproj 已回滚为原内容
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.strictEqual(csproj, csprojGhost);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm run compile && pnpm test`
Expected: 新测试 FAIL —— 当前实现抛错但 csproj 未回滚，`strictEqual` 断言失败

- [ ] **Step 3: 实现回滚**

`src/services/FileService.ts` 的 `deleteFolder` 中，将物理删除的 try/catch（第 236-245 行）改为：

```typescript
// 整个目录进回收站；物理删除失败时回滚 csproj 并抛错，由上层如实报告
try {
    await vscode.workspace.fs.delete(vscode.Uri.file(dirAbsResolved), {
        recursive: true,
        useTrash: true,
    });
} catch (err) {
    if (!isSdk && targets.length > 0) {
        // 回滚 csproj 为原内容；回滚自身失败不掩盖原始错误
        try {
            await fs.promises.writeFile(projectPath, csprojContent, 'utf-8');
        } catch { /* ignore */ }
    }
    throw new Error(
        `Failed to delete folder: ${normalizedFolder} (${err instanceof Error ? err.message : String(err)})`
    );
}
```

- [ ] **Step 4: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（75 + 1 = 76）

- [ ] **Step 5: Commit**

```bash
git add src/services/FileService.ts src/test/FileService.test.ts
git commit -m "fix: roll back csproj when deleteFolder physical delete fails"
```

---

### Task 3: 提取 dragDropLogic 纯函数模块 + 单测

**Files:**
- Create: `src/tree/dragDropLogic.ts`
- Create: `src/test/dragDropLogic.test.ts`
- Modify: `src/tree/DragDropController.ts`

- [ ] **Step 1: 创建 dragDropLogic.ts**

新建 `src/tree/dragDropLogic.ts`（逻辑从 DragDropController 逐字迁移，仅去掉 `private`/`this`）：

```typescript
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
```

- [ ] **Step 2: 创建测试（锁定现有行为）**

新建 `src/test/dragDropLogic.test.ts`：

```typescript
import * as assert from 'assert';
import { dedupeDragData, detectCycle, expandMoves, DragNodeData } from '../tree/dragDropLogic';

const P = 'C:/proj/Test.csproj';
const file = (nodePath: string): DragNodeData => ({ type: 'file', projectPath: P, nodePath });
const folder = (nodePath: string): DragNodeData => ({ type: 'folder', projectPath: P, nodePath });

suite('dragDropLogic', () => {

    suite('dedupeDragData', () => {
        test('移除完全重复项', () => {
            const result = dedupeDragData([file('A.cs'), file('A.cs')]);
            assert.strictEqual(result.length, 1);
        });

        test('移除被拖拽文件夹包含的子文件', () => {
            const result = dedupeDragData([folder('Models'), file('Models/User.cs')]);
            assert.deepStrictEqual(result.map(r => r.nodePath), ['Models']);
        });

        test('移除被拖拽文件夹包含的子文件夹', () => {
            const result = dedupeDragData([folder('A'), folder('A/B')]);
            assert.deepStrictEqual(result.map(r => r.nodePath), ['A']);
        });

        test('文件夹不会过滤自身', () => {
            const result = dedupeDragData([folder('A'), folder('B')]);
            assert.strictEqual(result.length, 2);
        });

        test('同名前缀的兄弟不误过滤', () => {
            const result = dedupeDragData([folder('A'), file('AB/x.cs')]);
            assert.strictEqual(result.length, 2);
        });
    });

    suite('detectCycle', () => {
        test('文件夹拖入自身返回 self', () => {
            assert.strictEqual(detectCycle([folder('A')], 'A'), 'self');
        });

        test('文件夹拖入子目录返回 descendant', () => {
            assert.strictEqual(detectCycle([folder('A')], 'A/B/C'), 'descendant');
        });

        test('正常目标返回 null', () => {
            assert.strictEqual(detectCycle([folder('A')], 'B'), null);
        });

        test('文件节点不参与循环检测', () => {
            assert.strictEqual(detectCycle([file('A/x.cs')], 'A'), null);
        });
    });

    suite('expandMoves', () => {
        test('单文件移动到目标目录', () => {
            const moves = expandMoves([file('User.cs')], 'Models', []);
            assert.deepStrictEqual(moves, [{ oldRelPath: 'User.cs', newRelPath: 'Models/User.cs' }]);
        });

        test('文件移到自身所在目录为 no-op', () => {
            const moves = expandMoves([file('Models/User.cs')], 'Models', []);
            assert.strictEqual(moves.length, 0);
        });

        test('文件夹递归展开所有子条目', () => {
            const compiles = [
                { include: 'Src/A.cs' },
                { include: 'Src/Sub/B.cs' },
                { include: 'Other/C.cs' },
            ];
            const moves = expandMoves([folder('Src')], 'Dst', compiles);
            assert.deepStrictEqual(moves, [
                { oldRelPath: 'Src/A.cs', newRelPath: 'Dst/Src/A.cs' },
                { oldRelPath: 'Src/Sub/B.cs', newRelPath: 'Dst/Src/Sub/B.cs' },
            ]);
        });

        test('移动到项目根（targetDir 为空）', () => {
            const moves = expandMoves([file('Models/User.cs')], '', []);
            assert.deepStrictEqual(moves, [{ oldRelPath: 'Models/User.cs', newRelPath: 'User.cs' }]);
        });

        test('反斜杠条目的新路径跟随反斜杠风格', () => {
            const compiles = [{ include: 'Src\\A.cs' }];
            const moves = expandMoves([folder('Src')], 'Dst', compiles);
            assert.deepStrictEqual(moves, [
                { oldRelPath: 'Src\\A.cs', newRelPath: 'Dst\\Src\\A.cs' },
            ]);
        });

        test('相同 oldRelPath 只产生一个任务', () => {
            const compiles = [{ include: 'Src/A.cs' }];
            // 同一文件夹拖两次（dedupe 之外的安全网）
            const moves = expandMoves([folder('Src'), folder('Src')], 'Dst', compiles);
            assert.strictEqual(moves.length, 1);
        });
    });
});
```

- [ ] **Step 3: 编译并运行新测试（验证提取的逻辑与原实现一致）**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（76 + 15 = 91）。此时 DragDropController 还未改动，新旧逻辑并存。

- [ ] **Step 4: DragDropController 改用 dragDropLogic**

修改 `src/tree/DragDropController.ts`：

1. 顶部 import 改为：

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojProject } from '../models/CsprojModel';
import { ProjectNode } from '../models/ProjectNode';
import { FileService } from '../services/FileService';
import { ProjectTreeProvider } from './ProjectTreeProvider';
import { DragNodeData, MoveTask, dedupeDragData, detectCycle, expandMoves } from './dragDropLogic';
```

2. 删除文件内的 `DragNodeData` / `MoveTask` 接口定义（第 9-22 行）
3. 删除私有方法 `dedupeDragData`（第 199-214 行）、`expandMoves`（第 216-267 行）
4. `handleDrop` 中：
   - `const dragData = this.dedupeDragData(rawDragData);` → `const dragData = dedupeDragData(rawDragData);`
   - 循环检测块（第 97-108 行）替换为：

```typescript
// 检测循环：不能将文件夹拖入其自身或子目录
const cycle = detectCycle(dragData, targetDir);
if (cycle === 'self') return; // 放到自身 → 静默忽略
if (cycle === 'descendant') {
    vscode.window.showWarningMessage('不能将文件夹移动到其子目录中');
    return;
}
```

   - `const moves: MoveTask[] = this.expandMoves(dragData, targetDir, project);` → `const moves: MoveTask[] = expandMoves(dragData, targetDir, project.compiles);`

5. `detectConflicts` / `resolveConflicts` / `removeTarget` 保留在类中不动（依赖 fs/vscode）。

- [ ] **Step 5: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（91 个）

- [ ] **Step 6: Commit**

```bash
git add src/tree/dragDropLogic.ts src/test/dragDropLogic.test.ts src/tree/DragDropController.ts
git commit -m "refactor: extract pure drag-drop logic into dragDropLogic with unit tests"
```

---

### Task 4: 拆分 extension.ts ① fileCommands

**Files:**
- Create: `src/commands/fileCommands.ts`
- Modify: `src/extension.ts`

**搬移纪律：处理器函数体逐字复制，禁止任何逻辑改动。**

- [ ] **Step 1: 创建 fileCommands.ts**

新建 `src/commands/fileCommands.ts`，骨架如下；五个 `registerCommand` 调用块从 `src/extension.ts` **逐字搬移**（行号基于当前 HEAD）：addClass（59-99）、deleteFile（101-160）、addExistingFile（162-187）、renameFile（189-256）、removePackage（442-465），`DEFAULT_CLASS_TEMPLATE` 常量（522-533）也迁入本文件：

```typescript
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
    // --- 添加类 ---（逐字搬移 extension.ts:60-99 的 push 块）

    // --- 删除文件/文件夹 ---（逐字搬移 extension.ts:102-160）

    // --- 添加现有文件 ---（逐字搬移 extension.ts:163-187）

    // --- 重命名文件/文件夹 ---（逐字搬移 extension.ts:190-256）

    // --- 移除 NuGet 包 ---（逐字搬移 extension.ts:443-465）
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
```

- [ ] **Step 2: extension.ts 删除已搬移代码并调用注册函数**

- 删除上述 5 个命令注册块和 `DEFAULT_CLASS_TEMPLATE`
- 删除不再使用的 import（`CsprojService`、`FileTemplateService`、`FileService`）
- 在 treeView 创建之后加：

```typescript
import { registerFileCommands } from './commands/fileCommands';
// ... activate 内：
registerFileCommands(context, treeProvider, treeView);
```

- [ ] **Step 3: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过。用 `git diff --stat` 确认 extension.ts 只减不增（除 import + 一行调用）。

- [ ] **Step 4: Commit**

```bash
git add src/commands/fileCommands.ts src/extension.ts
git commit -m "refactor: move file-level commands into commands/fileCommands"
```

---

### Task 5: 拆分 extension.ts ② projectCommands

**Files:**
- Create: `src/commands/projectCommands.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: 创建 projectCommands.ts**

骨架如下；六个注册块从 extension.ts **逐字搬移**（Task 4 后行号已变化，按命令名定位）：build / clean / rebuild / addExistingProject / addNewProject / removeProjectFromSolution：

```typescript
// src/commands/projectCommands.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectNode } from '../models/ProjectNode';
import { BuildService } from '../services/BuildService';
import { SlnService } from '../services/SlnService';

/** 注册项目/解决方案级命令：生成 / 清理 / 重新生成 / 添加新项目 / 添加已有项目 / 从解决方案移除 */
export function registerProjectCommands(context: vscode.ExtensionContext): void {
    // --- 生成 ---（逐字搬移）
    // --- 清理 ---（逐字搬移）
    // --- 重新生成 ---（逐字搬移）
    // --- 添加已有项目到解决方案 ---（逐字搬移）
    // --- 添加新项目到解决方案 ---（逐字搬移）
    // --- 从解决方案移除项目 ---（逐字搬移）
}
```

- [ ] **Step 2: extension.ts 删除已搬移代码，调用 `registerProjectCommands(context)`，清理 import（`BuildService`、`SlnService`）**

- [ ] **Step 3: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add src/commands/projectCommands.ts src/extension.ts
git commit -m "refactor: move project/solution commands into commands/projectCommands"
```

---

### Task 6: 拆分 extension.ts ③ navCommands + watchers + 收尾

**Files:**
- Create: `src/commands/navCommands.ts`
- Create: `src/commands/watchers.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: 创建 navCommands.ts**

骨架如下；refresh / revealInExplorer / openInTerminal / 编辑器联动四个块**逐字搬移**：

```typescript
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
    // --- 刷新面板 ---（逐字搬移）
    // --- 在文件资源管理器中显示 ---（逐字搬移）
    // --- 在集成终端中打开 ---（逐字搬移）
    // --- 切换标签页时自动选中对应文件节点（仅面板可见时生效） ---（逐字搬移）
}
```

- [ ] **Step 2: 创建 watchers.ts**

三个 watcher + 防抖**逐字搬移**：

```typescript
// src/commands/watchers.ts
import * as vscode from 'vscode';

/** 注册 csproj/sln/slnx 文件监听，变化后防抖 500ms 触发刷新 */
export function registerWatchers(context: vscode.ExtensionContext): void {
    // --- 文件监听（防抖 500ms）---（逐字搬移三个 watcher 块和 debouncedRefresh）
}
```

- [ ] **Step 3: 精简 extension.ts 为组装层**

最终 `src/extension.ts` 完整内容：

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/ProjectTreeProvider';
import { DragDropController } from './tree/DragDropController';
import { registerFileCommands } from './commands/fileCommands';
import { registerProjectCommands } from './commands/projectCommands';
import { registerNavCommands } from './commands/navCommands';
import { registerWatchers } from './commands/watchers';

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

    registerNavCommands(context, treeProvider, treeView);
    registerFileCommands(context, treeProvider, treeView);
    registerProjectCommands(context);
    registerWatchers(context);

    // --- 初始扫描 ---
    vscode.commands.executeCommand('csharpsolution.refresh');
}

export function deactivate() {}
```

- [ ] **Step 4: 编译并测试 + 行数确认**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过

Run: `wc -l src/extension.ts`
Expected: < 80 行

- [ ] **Step 5: Commit**

```bash
git add src/commands/navCommands.ts src/commands/watchers.ts src/extension.ts
git commit -m "refactor: move nav commands and watchers, extension.ts becomes assembly-only"
```

---

### Task 7: 完整验证

- [ ] **Step 1: 全量编译 + 测试 + lint**

Run: `pnpm run compile && pnpm test`
Expected: 91 个测试全部通过，lint 0 error

- [ ] **Step 2: 行为不变手动抽查**

F5 启动扩展开发宿主，逐项验证（每项应与重构前行为完全一致）：

| # | 操作 | 预期 |
|---|------|------|
| 1 | 面板加载 | 项目树正常显示 |
| 2 | 刷新按钮 | 树刷新 |
| 3 | 添加类 | 创建成功 |
| 4 | 文件/文件夹删除（右键 + Delete 键） | 正常 |
| 5 | 文件/文件夹重命名（右键 + F2） | 正常 |
| 6 | 拖拽移动（单文件、文件夹、冲突） | 正常 |
| 7 | 生成/清理/重新生成 | 正常 |
| 8 | 在终端中打开 / 资源管理器显示 | 正常 |
| 9 | 修改 csproj 文件 | 500ms 后自动刷新 |
| 10 | 切换编辑器标签 | 树自动定位 |

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: address issues found in refactor verification"
```
