# 集成终端 / Delete 删除 / F2 重命名 — 设计文档

> 日期：2026-07-17 | 状态：设计完成

## 1. 概述

为项目树补充三个小功能：

1. **在集成终端中打开** — 右键菜单新命令，在节点对应目录打开 VS Code 集成终端
2. **Delete 键删除** — 键盘快捷键触发删除，同时将删除能力扩展到文件夹（右键菜单同步）
3. **F2 键重命名** — 键盘快捷键触发重命名，同时将重命名能力扩展到文件夹（右键菜单同步）

## 2. 范围与约束

| 维度 | 决定 |
|------|------|
| 终端打开节点 | `project` / `solutionProject` / `solution` / `dirFolder` / `file`（文件取父目录） |
| Delete 键范围 | `file` + `dirFolder`；其他节点类型按下无反应 |
| F2 键范围 | `file` + `dirFolder`；其他节点类型按下无反应 |
| 文件夹删除 | 新能力：csproj 移除文件夹下全部条目 + 目录进回收站；右键菜单同步加「删除」 |
| 文件夹重命名 | 新能力：目录改名 + 批量更新 csproj 路径；右键菜单同步加「重命名」；不做类名/命名空间同步 |
| 实现策略 | 目录级操作 + 批量 csproj 更新（单次读写，内存中循环调用已有的单条转换方法） |

## 3. package.json 贡献点

### 新增命令

```json
{ "command": "csharpsolution.openInTerminal", "title": "在集成终端中打开" }
```

### 右键菜单变更（view/item/context）

| 命令 | 新增到的节点 | 分组 |
|------|------------|------|
| `openInTerminal` | `project`, `solutionProject`, `solution`, `dirFolder`, `file` | `group4@2` |
| `deleteFile` | `dirFolder`（原有 `file` 保留） | `navigation@2` |
| `renameFile` | `dirFolder`（原有 `file` 保留） | `navigation@1` |

### 新增 keybindings 贡献点

```json
"keybindings": [
  { "command": "csharpsolution.deleteFile", "key": "delete", "when": "focusedView == csharpsolution-projects" },
  { "command": "csharpsolution.renameFile", "key": "f2", "when": "focusedView == csharpsolution-projects" }
]
```

`focusedView` 条件保证只在项目树获得焦点时生效。

## 4. extension.ts 命令处理器改造

### 键盘触发的参数回退

快捷键触发命令时不传节点参数，`deleteFile` 和 `renameFile` 处理器开头统一加：

```typescript
node = node ?? treeView.selection[0];
if (!node || (node.type !== 'file' && node.type !== 'folder')) return;
```

`treeView` 已在 `activate()` 作用域内，处理器直接闭包引用。

### deleteFile 命令分流

- `file` 节点 → 现有流程不变
- `folder` 节点 → 从当前项目的 `compiles` 前缀匹配统计文件数 N，确认框显示「将删除文件夹 "X" 及其中 N 个文件」→ 调用 `FileService.deleteFolder`。项目数据从 `treeProvider.allProjects` 按 `node.projectPath` 查找。

### renameFile 命令分流

- `file` 节点 → 现有流程不变（含 `syncCode` 类名同步）
- `folder` 节点 → InputBox 预填当前文件夹名，校验：
  - 非空
  - 不含非法字符 `/ \ : * ? " < > |`
  - 与当前名不同
  → 调用 `FileService.renameFolder`。不做类名/命名空间同步（重命名文件夹不改类名；命名空间与目录联动超出范围）。同级目录重名由 `renameFolder` 内部的目标存在性检查兜底报错。

### openInTerminal 命令

```typescript
// 各节点类型 → cwd 的映射
project / solutionProject → path.dirname(node.project.path)
solution                  → path.dirname(node.solution.path)
folder                    → path.join(path.dirname(node.projectPath), node.relPath)
file                      → path.dirname(path.join(path.dirname(node.projectPath), node.compile.include))

vscode.window.createTerminal({ cwd }).show();
```

## 5. FileService 新方法

### deleteFolder

```typescript
static async deleteFolder(
    projectPath: string,
    folderRelPath: string,      // POSIX 风格，如 "Models/Sub"
    compiles: CompileItem[]     // 该项目的所有 Compile 条目（调用方传入）
): Promise<number>              // 返回移除的条目数
```

1. 前缀匹配（双方 POSIX 归一化比较：`include.replace(/\\/g, '/')` 等于 `folderRelPath` 或以 `folderRelPath + '/'` 开头）筛出文件夹下所有 `CompileItem`
2. 读 .csproj，判断 SDK；非 SDK 项目：内存中循环 `CsprojSerializer.removeCompile(xml, item.include)`（传原始 include 保持分隔符匹配），单次写回
3. 整个目录进回收站：`vscode.workspace.fs.delete(dirUri, { recursive: true, useTrash: true })`
4. 目录删除失败仅 `console.warn`（与 `deleteFile` 现有行为一致）
5. SDK 项目：跳过步骤 2，仅执行步骤 3

### renameFolder

```typescript
static async renameFolder(
    projectPath: string,
    folderRelPath: string,      // "Models/Sub"
    newName: string             // "NewSub" → 新路径 "Models/NewSub"
): Promise<void>
```

1. 计算 `newRelPath` = 同父目录 + `newName`（POSIX join）；校验源目录存在、目标目录不存在（存在则抛错）
2. 读 .csproj，判断 SDK；非 SDK 项目：内存中对每个前缀匹配的条目循环 `CsprojSerializer.updateCompilePath`，沿用 `moveFile` 的分隔符策略——原样尝试，未命中则翻转 `/`→`\` 重试，新路径跟随源条目的分隔符风格
3. **先验证后动盘**（与 `moveFile` 一致）：csproj 更新内容全部计算完成后才动文件系统
4. `fs.promises.rename` 目录 → 写 csproj；写失败则 rename 回滚目录
5. SDK 项目：仅 `fs.promises.rename` 目录

## 6. 边界情况

| 场景 | 行为 |
|------|------|
| Delete/F2 按下时选中非 file/folder 节点 | 静默忽略 |
| Delete/F2 按下时无选中节点 | 静默忽略 |
| renameFolder 目标目录已存在 | 抛错，提示用户，无副作用 |
| renameFolder 新名与旧名相同 | InputBox 校验拦截 |
| deleteFolder 目录物理删除失败 | csproj 已更新，目录残留，`console.warn`（与 deleteFile 一致） |
| SDK 项目 | 两个方法都只动文件系统，不碰 csproj |
| openInTerminal 目录不存在 | VS Code createTerminal 自行处理（回退到默认 cwd） |

## 7. 测试要点

`FileService.test.ts` 新增：

| 用例 | 验证 |
|------|------|
| deleteFolder 基本 | csproj 移除文件夹下全部条目，其他条目保留，返回条目数 |
| deleteFolder 嵌套子目录 | 深层条目也被移除 |
| deleteFolder 反斜杠 csproj | 反斜杠条目正确移除 |
| renameFolder 基本 | 目录改名，csproj 全部路径更新 |
| renameFolder 反斜杠 csproj | 分隔符风格保持 |
| renameFolder 目标已存在 | 报错，无副作用（目录未动、csproj 未变） |
| renameFolder SDK 项目 | 目录改名，csproj 不变 |

`openInTerminal`、keybindings 为 VS Code API 胶水，不写单测，按手动清单验证：

1. 各类型节点右键「在集成终端中打开」→ 终端 cwd 正确
2. 树中选中文件按 Delete → 弹删除确认
3. 树中选中文件夹按 Delete → 弹文件夹删除确认（含文件数）
4. 树中选中文件按 F2 → 弹重命名输入框
5. 树中选中文件夹按 F2 → 弹文件夹重命名输入框
6. 编辑器获得焦点时按 Delete/F2 → 不触发本扩展命令
