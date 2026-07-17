# Drag & Drop 文件/文件夹移动 — 设计文档

> 日期：2026-07-17 | 状态：设计完成

## 1. 概述

在 VS Code 扩展的「项目管理」树视图中，为 `file` 和 `dirFolder` 节点添加拖拽移动支持。用户可将文件或文件夹拖放到同一项目的其他文件夹（或项目根节点）来移动它们，扩展自动更新非 SDK 项目的 `.csproj` 文件。

## 2. 范围与约束

| 维度 | 决定 |
|------|------|
| 移动范围 | 仅限同一项目内（project-internal） |
| 可拖拽节点 | `file`、`dirFolder` |
| 放落目标 | `dirFolder`、`project`（根目录） |
| 文件夹冲突 | 逐个文件询问用户（跳过 / 覆盖 / 取消全部） |
| .csproj 策略 | 非 SDK 项目更新路径；SDK 项目仅移动物理文件 |
| VCS 集成 | 不做自动处理 |
| 操作反馈 | 完成后显示信息提示（已移动 N 个文件） |

## 3. 架构

```
src/
├── tree/
│   ├── ProjectTreeProvider.ts   ← 少量修改：暴露查询方法
│   └── DragDropController.ts    ← 新建：拖拽控制器
├── services/
│   └── FileService.ts           ← 新增 moveFile 方法
└── extension.ts                 ← 传入 dragAndDropController
```

| 组件 | 职责 |
|------|------|
| `DragDropController` | 实现 `TreeDragAndDropController<ProjectNode>`，处理拖拽序列化/反序列化、验证、冲突询问、编排移动 |
| `FileService.moveFile` | 执行单个文件的物理移动 + .csproj 路径更新 |
| `ProjectTreeProvider` | 暴露数据查询接口（查找项目、获取文件夹内所有文件） |

### 数据流

```
拖拽节点 → handleDrag(序列化) → 放到目标 → handleDrop(解析→验证→冲突检测→执行移动) → 刷新树
```

## 4. DragDropController

### 文件

`src/tree/DragDropController.ts` — 新建，实现 `vscode.TreeDragAndDropController<ProjectNode>`。

### MIME 类型

```typescript
dropMimeTypes = ['application/vnd.code.tree.csharpsolution-projects'];
dragMimeTypes = ['application/vnd.code.tree.csharpsolution-projects'];
```

### handleDrag

将 `ProjectNode[]` 序列化为 JSON 存入 `dataTransfer`。每个节点仅保留必要字段：
- `type`
- `projectPath`
- `relPath`（folder）或 `compile.include`（file）

### handleDrop

核心流程：

1. **解析** — 从 `dataTransfer` 反序列化源节点列表，读取 target 节点
2. **验证**（任一不通过则放弃操作）：
   - target 必须是 `folder` 或 `project` 类型
   - 所有源节点与 target 属于同一 `projectPath`
   - 不能将文件夹拖入其自身或其子目录（防止循环嵌套）
   - 源路径 ≠ 目标路径（无操作则忽略）
3. **计算目标目录**：
   - `target.type === 'folder'` → `target.relPath`
   - `target.type === 'project'` → `''`（项目根）
4. **展开文件列表** — 递归展开文件夹节点为文件清单，保持 `oldRelPath` → `newRelPath` 映射
5. **冲突检测** — 对每个目标文件路径检查文件系统中是否已存在（`fs.promises.access`）：
   - 无冲突 → 直接移动
   - 有冲突 → 逐个弹出 QuickPick（跳过 / 覆盖 / 取消全部）
6. **执行移动** — 依次调用 `FileService.moveFile`
7. **汇总结果** — `vscode.window.showInformationMessage`

### 依赖

- `ProjectTreeProvider` — 查询项目数据（`allProjects`、`getFolderChildren` 逻辑）
- `FileService.moveFile` — 执行实际文件移动

## 5. FileService.moveFile

### 方法签名

```typescript
static async moveFile(
    projectPath: string,    // .csproj 绝对路径
    oldRelPath: string,     // 原相对路径，如 "Models/User.cs"
    newRelPath: string      // 新相对路径，如 "Entities/User.cs"
): Promise<void>
```

### 执行步骤

1. 验证源文件存在（`fs.promises.access`），不存在则抛错
2. 安全检查目标文件是否已存在（抛错，由上层冲突检测先行处理）
3. 读取 .csproj 内容，判断是否为 SDK 项目（`/<Project\s+Sdk="[^"]*"/`）
4. **SDK 项目**：
   - 仅移动物理文件（`fs.promises.rename`），先确保目标目录存在
   - 跳过 .csproj 修改
5. **非 SDK 项目**：
   - 确保目标目录存在
   - 移动物理文件
   - 读取 .csproj 内容
   - 复用现有 `CsprojSerializer.updateCompilePath(xml, oldRelPath, newRelPath)` 更新 .csproj（该方法已支持全路径替换，非仅文件名）
   - 写入 .csproj

> 与 `renameFile` 不同，`moveFile` 不需要 `syncCode`（类名同步）—— 移动不改变类名。

## 6. 冲突处理 & 用户交互

### 冲突对话框

每个冲突文件弹出 QuickPick：

- **"跳过"** — 跳过当前文件，继续处理后续文件
- **"覆盖"** — 删除目标文件后移动源文件
- **"取消全部"** — 终止整个操作，已移动的文件不回滚

### 完成提示

| 结果 | 消息 |
|------|------|
| 全部成功 | `已移动 N 个文件到 "FolderName"` |
| 部分跳过 | `已移动 N 个文件到 "FolderName"，跳过 M 个冲突文件` |
| 全部取消 | 不提示 |
| 异常失败 | `vscode.window.showErrorMessage` |

## 7. 边界情况

| 场景 | 行为 |
|------|------|
| 拖拽到同一目录 | 静默忽略（源路径 = 目标路径） |
| 拖拽文件夹到自己的子目录 | 阻止，提示"不能将文件夹移动到其子目录中" |
| 目标目录不存在于文件系统 | 自动 `mkdir` 创建 |
| SDK 项目 | 仅移动物理文件，跳过 .csproj 修改 |
| 拖拽到非 folder/project 节点 | VS Code 不允许放落（从 MIME 类型层面限制） |
| 源节点中包含非 file/folder 类型 | handleDrag 阶段过滤，仅序列化 file 和 folder |

## 8. ProjectTreeProvider 修改

- `allProjects` 属性从 `private` 改为 `public`（或新增 `getProject(path: string)` 方法），供 DragDropController 查询项目数据
- 可选：新增 `getAllCompilesInFolder(projectPath: string, folderRelPath: string)` 公共方法，递归展开文件夹内所有文件

## 9. extension.ts 修改

在创建 `TreeView` 时传入 `dragAndDropController`：

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

## 9. 测试要点

- 单文件移动到子文件夹
- 文件夹整体移动（含多层嵌套）
- 移动文件夹到自身 → 阻止
- 移动文件夹到其子目录 → 阻止
- 文件/文件夹移动到项目根
- 目标存在同名文件 → 冲突提示
- SDK 项目仅移动物理文件
- 非 SDK 项目同步更新 .csproj
- 源文件不存在（异常路径）
