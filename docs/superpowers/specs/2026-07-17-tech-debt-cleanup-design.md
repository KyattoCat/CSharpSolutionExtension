# 技术债清理 — 设计文档（子项目 A）

> 日期：2026-07-17 | 状态：设计完成
> 系列：技术债清理（A）→ 文件管理增强（B）→ MSBuild 支持（C）

## 1. 概述

清理四项已知技术债，全部为重构，**不改变任何外部行为**。为后续子项目 B（文件管理增强，依赖 commands 模块结构和 dragDropLogic）和 C（MSBuild 支持）打地基。

## 2. 范围

| # | 债 | 来源 |
|---|-----|------|
| 1 | `isSdk` 正则在 FileService 5 处 + CsprojSerializer.parse 1 处重复 | 多轮 code review 标记 |
| 2 | `deleteFolder` 先更新 csproj 后物理删除，删除失败无回滚 | Task 4 review 标记 |
| 3 | DragDropController 纯逻辑（去重/展开）无单测 | 拖拽功能 final review 标记 |
| 4 | `extension.ts` 约 530 行、15 个命令注册，职责过载 | Task 4 review 标记 |

非目标：不改任何用户可见行为；不动 package.json；不重构 FileService 的其他方法。

## 3. 执行策略

逐项小步提交：每项债一个独立 commit（extension.ts 拆分可按模块分 2-3 个 commit），每步后运行全量测试（当前 74 个）保持常绿。顺序：1 → 2 → 3 → 4（从小到大）。

## 4. 目标文件结构

```
src/
├── extension.ts                 ← 只留 activate 组装（目标 <80 行）
├── commands/
│   ├── fileCommands.ts          ← addClass / deleteFile / renameFile / addExistingFile / removePackage
│   ├── projectCommands.ts       ← build / clean / rebuild / addNewProject / addExistingProject / removeProjectFromSolution
│   ├── navCommands.ts           ← revealInExplorer / openInTerminal / refresh / 编辑器→树 reveal 联动
│   └── watchers.ts              ← csproj/sln/slnx 文件监听 + 500ms 防抖
├── tree/
│   ├── DragDropController.ts    ← 变薄：UI 编排（DataTransfer、QuickPick、消息、执行循环）
│   └── dragDropLogic.ts         ← 纯函数模块，不 import vscode
└── test/
    └── dragDropLogic.test.ts    ← 新增
```

## 5. 各项债的设计

### 债 1：isSdk 提取

`CsprojSerializer` 新增：

```typescript
/** 判断是否为 SDK 风格项目（<Project Sdk="...">） */
static isSdk(xml: string): boolean {
    return /<Project\s+Sdk="[^"]*"/.test(xml);
}
```

替换 6 处调用点：`FileService.renameFile` / `deleteFile` / `moveFile` / `deleteFolder` / `renameFolder` 内的正则，以及 `CsprojSerializer.parse` 内部的判断。

### 债 2：deleteFolder 回滚

物理删除（`vscode.workspace.fs.delete`）失败时，catch 中先将 csproj 恢复为原内容（`csprojContent` 局部变量已持有）再抛错，与 `moveFile` / `renameFolder` 的回滚惯例一致：

```typescript
try {
    await vscode.workspace.fs.delete(...);
} catch (err) {
    if (!isSdk && targets.length > 0) {
        await fs.promises.writeFile(projectPath, csprojContent, 'utf-8'); // 回滚
    }
    throw new Error(`Failed to delete folder: ...`);
}
```

测试：物理目录不存在时 `workspace.fs.delete` 会抛错——用「csproj 有条目但物理目录不存在」的 fixture 触发失败路径，断言抛错且 csproj 内容恢复原样。

### 债 3：dragDropLogic 提取

新建 `src/tree/dragDropLogic.ts`，从 DragDropController 迁出纯逻辑（函数签名保持现有语义）：

```typescript
export interface DragNodeData { type: 'file' | 'folder'; projectPath: string; nodePath: string; }
export interface MoveTask { oldRelPath: string; newRelPath: string; overwrite?: boolean; }

/** 去重：移除完全重复项和已被其他拖拽文件夹覆盖的后代项 */
export function dedupeDragData(dragData: DragNodeData[]): DragNodeData[];

/** 将拖拽节点展开为移动任务列表（含 no-op 过滤、oldRelPath 去重、分隔符风格跟随） */
export function expandMoves(dragData: DragNodeData[], targetDir: string, compiles: CompileItem[]): MoveTask[];

/** 检测循环：文件夹拖入自身（返回 'self'）或其子目录（返回 'descendant'），否则 null */
export function detectCycle(dragData: DragNodeData[], targetDir: string): 'self' | 'descendant' | null;
```

- `DragNodeData` / `MoveTask` 接口移到该模块导出，DragDropController 从这里导入
- 循环检测逻辑现在内联在 handleDrop 中，提取为 `detectCycle`（区分 self/descendant 以便 controller 决定静默或警告）
- 冲突检测（`detectConflicts`）依赖 `fs`，不属于纯函数模块，留在 controller

测试 `dragDropLogic.test.ts`（纯 mocha，无 vscode 依赖）约 8-10 个用例：
- dedupe：完全重复、文件夹+其子文件、文件夹+其子文件夹、自身不误过滤
- expandMoves：单文件、文件夹递归、移到根、no-op 过滤、反斜杠条目跟随风格、同 oldRelPath 去重
- detectCycle：拖入自身、拖入子目录、正常目标

### 债 4：extension.ts 拆分

每个模块导出注册函数，依赖显式传入：

```typescript
// commands/fileCommands.ts
export function registerFileCommands(
    context: vscode.ExtensionContext,
    treeProvider: ProjectTreeProvider,
    treeView: vscode.TreeView<ProjectNode>
): void;

// commands/projectCommands.ts
export function registerProjectCommands(context: vscode.ExtensionContext): void;

// commands/navCommands.ts —— 含 refresh 命令注册和编辑器联动
export function registerNavCommands(
    context: vscode.ExtensionContext,
    treeProvider: ProjectTreeProvider,
    treeView: vscode.TreeView<ProjectNode>
): void;

// commands/watchers.ts
export function registerWatchers(context: vscode.ExtensionContext): void;
```

- 命令处理器代码**原样搬移**，不做逻辑修改（诱惑再大也不改，行为变更留给子项目 B）
- `DEFAULT_CLASS_TEMPLATE` 常量随 addClass 迁入 fileCommands.ts
- refresh 命令被多处 `executeCommand('csharpsolution.refresh')` 引用——字符串解耦，无需处理
- treeView.message 的设置在 refresh 处理器内，随 navCommands 迁移；activate 中初始的「扫描中...」留在 extension.ts
- 拆分按 3 个 commit：① fileCommands ② projectCommands ③ navCommands + watchers

拆分后 `extension.ts` 仅含：创建 treeProvider/dragDropController/treeView、调用 4 个 register 函数、初始 refresh。

## 6. 验证

- 每步：`pnpm run compile && pnpm test` 全绿（74 + 新增）
- 债 4 完成后 F5 手动抽查：refresh、添加类、删除、重命名、拖拽、构建、终端各一次
- 最终 `extension.ts` 行数 <80

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 搬移时手滑改了逻辑 | 每 commit 只搬一个模块，diff 审查「只有位移无修改」 |
| dragDropLogic 提取时语义漂移 | 先写测试锁定现有行为（从现实现反推用例），再提取 |
| deleteFolder 回滚测试路径难触发 | 用「物理目录不存在」fixture 稳定触发 delete 失败 |
