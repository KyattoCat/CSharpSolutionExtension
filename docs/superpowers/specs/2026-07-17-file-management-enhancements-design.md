# 文件管理增强 — 设计文档（子项目 B）

> 日期：2026-07-17 | 状态：设计完成
> 系列：技术债清理（A，已完成）→ 文件管理增强（B）→ MSBuild 支持（C）

## 1. 概述

五个文件管理增强功能：

1. **新建文件夹** — 传统项目写入 `<Folder Include="Sub\" />`，SDK 项目建物理目录；空文件夹在树中可见
2. **更多模板** — 新增 接口/枚举/结构体 模板，「新增文件」子菜单收纳
3. **从项目排除** — 移除 csproj 条目不删物理文件；传统项目 removeCompile，SDK 项目写 `<Compile Remove>`
4. **多选批量操作** — `canSelectMany`，批量删除与批量排除
5. **linked 节点** — `..` 路径的文件/文件夹改用 `linkedFile`/`linkedFolder` contextValue，只留导航+排除，拖拽排除

## 2. 决策记录

| 维度 | 决定 |
|------|------|
| 空文件夹显示 | 传统：解析 `<Folder Include>`；SDK：walkDir 顺便收集空目录 |
| 添加文件后的 Folder 条目 | 保留不清理（树节点去重），YAGNI |
| 模板组织 | FileTemplateService 硬编码常量模板（不做文件化/配置化） |
| 菜单结构 | 顶层「新建文件夹」命令 + 「新增文件」子菜单（类/接口/枚举/结构体）；「添加现有文件」保留顶层 |
| 排除范围 | 文件 + 文件夹；传统 + SDK 项目都支持 |
| 多选操作 | 删除 + 排除（重命名单目标；构建不做批量） |
| linkedFolder/linkedFile | 保留 排除/资源管理器/终端；隐藏 删除/重命名/新增；拖拽序列化跳过 |
| Delete/F2 对 linked 节点 | 处理器内 `isLinkedPath` 判断后静默忽略 |

## 3. 数据模型与解析层

### CsprojModel

```typescript
export interface CsprojProject {
    // ...现有字段
    /** 空文件夹列表（POSIX 相对路径）：传统项目来自 <Folder Include>，SDK 项目来自文件系统扫描 */
    folders: string[];
}
```

### CsprojSerializer 新增

```typescript
/** 解析 <Folder Include="Sub\" /> 条目，返回 POSIX 风格、去尾部分隔符的路径列表 */
static parseFolders(xml: string): string[];

/** 向 csproj 添加 <Folder Include="Sub\" /> 条目（反斜杠+尾部分隔符风格，与 VS 一致）。
    已有同路径条目（分隔符归一化比较）则返回原 xml。
    插入策略同 addCompile：找已有 Folder 块之后插入，否则在 </Project> 前新建 ItemGroup */
static addFolder(xml: string, folderRelPath: string): string;

/** SDK 项目排除：添加 <Compile Remove="Sub\File.cs" /> 条目。
    插入策略：找已有 Compile Remove 块之后插入，否则新建 ItemGroup */
static addCompileRemove(xml: string, relPath: string): string;
```

- `parseLegacy` 填充 `folders: this.parseFolders(xml)`
- `parseSdk`：`walkDir` 扩展为同时收集空目录（目录及其子树中无 .cs 文件），填入 `folders`；bin/obj/node_modules 照旧跳过
- SDK 排除后的显示：`globSourceFiles` 已应用 `Compile Remove` 规则，刷新即生效

## 4. 服务层

### FileTemplateService

```typescript
export type TypeKind = 'class' | 'interface' | 'enum' | 'struct';

/** 按类型生成代码；模板为硬编码常量。原 generate(ns, name, template) 保留 */
static generateByKind(namespace: string, name: string, kind: TypeKind): string;
```

模板统一形态（class 沿用现有 DEFAULT_CLASS_TEMPLATE 内容；interface/enum/struct 仅关键字不同）：

```csharp
using System;

namespace {namespace}
{
    public interface {className}
    {
        
    }
}
```

### CsprojService

```typescript
/** 通用新增类型：创建 .cs 文件（generateByKind）+ 注册 csproj（非 SDK）。
    addClass 成为 addType 的 kind='class' 特例（addClass 签名不动，内部委托 addType） */
static addType(
    projectPath: string,
    dirPath: string,
    name: string,
    kind: TypeKind,
    rootNamespace: string
): Promise<vscode.Uri>;

/** 新建文件夹：物理 mkdir + 非 SDK 项目写入 Folder 条目；SDK 仅 mkdir。
    校验：合法目录名（复用 renameFolder 的字符/保留名/'..'规则）、目录不已存在 */
static addFolder(projectPath: string, parentDirPath: string, folderName: string): Promise<void>;

/** 批量排除：单次读写 csproj，返回排除的条目数。
    非 SDK：循环 CsprojSerializer.removeCompile；SDK：循环 addCompileRemove。
    includes 传原始 include 字符串（保持分隔符精确匹配） */
static excludeFiles(projectPath: string, includes: string[]): Promise<number>;
```

- 文件夹排除由命令层前缀匹配收集条目后调 `excludeFiles`（与 deleteFolder 的「调用方传 compiles」模式一致）
- 排除**不做**目录包含性校验：不碰物理文件，排除 `..\` 链接条目是合法且主要的移除手段

## 5. 树层

### ProjectTreeProvider

- `buildFolderTree` / `getFolderChildren`：在 compile 推导目录的基础上合并 `project.folders`（Set 去重，POSIX 归一化比较），空文件夹节点 type 仍为 `folder`
- **linked 检测**：`isLinkedPath(relPath)`（POSIX 归一化后等于 `..` 或以 `../` 开头）：
  - folder 节点 → contextValue `linkedFolder`
  - file 节点 → contextValue `linkedFile`，description 追加 `→ 链接`
  - 节点 type 不变（仍 `folder`/`file`），只改 contextValue

### dragDropLogic / DragDropController

- `isLinkedPath` 函数放 `dragDropLogic.ts`（纯函数，供树层与拖拽共用）并单测
- `handleDrag` 跳过 linked 节点（不序列化），防止物理搬动共享文件

## 6. 命令层（fileCommands.ts）

| 命令 | 行为 |
|------|------|
| `csharpsolution.addInterface` / `addEnum` / `addStruct` | 与 addClass 相同流程（InputBox + 校验），调 `addType` 传对应 kind；作用于 `project` / `dirFolder` |
| `csharpsolution.addFolder` | InputBox 输入文件夹名（复用 renameFolder 的校验规则：非空/非法字符/保留名/尾部点空格）→ `CsprojService.addFolder` → 刷新 |
| `csharpsolution.excludeFromProject` | 见下方多选流程；确认框「将从项目排除 N 个条目（不删除物理文件）」 |
| `csharpsolution.deleteFile`（改造） | 见下方多选流程 |

### 多选流程（删除与排除共用骨架）

1. 签名 `(node?: ProjectNode, nodes?: ProjectNode[])`——右键时 VS Code 传 `(clicked, selection[])`，优先 `nodes`；键盘触发两者皆空，回退 `[...treeView.selection]`
2. 过滤出 `file` / `folder` 节点；linked 节点（`isLinkedPath`）：**删除**流程中静默剔除；**排除**流程中保留（排除对 linked 合法）
3. 后代去重：映射为 `DragNodeData` 复用 `dedupeDragData`（文件夹与其子项同选时只保留文件夹）
4. 展开：文件夹 → 前缀匹配 `project.compiles` 收集条目
5. 单次确认框汇总（删除：「N 个文件 + M 个文件夹」；排除：「N 个条目」）
6. 执行：删除逐项调 `deleteFile`/`deleteFolder` 并统计成败；排除单次调 `excludeFiles`
7. 汇总消息 + 刷新

`extension.ts`：`createTreeView` 增加 `canSelectMany: true`。

### Delete/F2 对 linked 节点

处理器内 `isLinkedPath` 判断：重命名遇 linked 静默忽略；删除批量流程自动剔除（见上）。

## 7. package.json

### submenus

```json
"submenus": [
  { "id": "csharpsolution.addFileMenu", "label": "新增文件" }
]
```

### 菜单矩阵变更（view/item/context）

| 入口 | project | dirFolder | file | linkedFile | linkedFolder | 说明 |
|------|---------|-----------|------|-----------|--------------|------|
| 「新增文件」子菜单 | ✓ | ✓ | — | — | — | navigation 组；原顶层「添加类...」移入 |
| 新建文件夹 | ✓ | ✓ | — | — | — | navigation 组 |
| 添加现有文件 | ✓（保留） | — | — | — | — | 顶层不动 |
| 排除 | — | ✓ | ✓ | ✓ | ✓ | 新组或 navigation |
| 删除 / 重命名 | — | ✓（保留） | ✓（保留） | — | — | linked 不给 |
| 资源管理器 / 终端 | ✓ | ✓ | ✓ | ✓ | ✓ | linked 保留导航 |

子菜单内部（`csharpsolution.addFileMenu`）：添加类 / 添加接口 / 添加枚举 / 添加结构体。

### commands 新增

`addInterface`（添加接口...）、`addEnum`（添加枚举...）、`addStruct`（添加结构体...）、`addFolder`（新建文件夹...）、`excludeFromProject`（从项目排除）。

keybindings 不变。

## 8. 边界情况

| 场景 | 行为 |
|------|------|
| 新建文件夹重名（物理已存在） | 报错提示 |
| SDK 项目新建文件夹 | 仅 mkdir，walkDir 下次扫描显示 |
| 空文件夹里新增文件 | 正常创建；Folder 条目保留，树去重显示 |
| 排除后再「添加现有文件」回来 | 传统项目正常 addCompile；SDK 项目 Remove 条目仍在会导致文件不显示——确认框提示用户该限制（本期不实现自动清理 Remove 条目） |
| 多选跨项目节点 | 以首个有效节点的 projectPath 为准，过滤掉其他项目的节点（批量操作单项目内执行） |
| 多选包含引用/包节点 | 过滤剔除 |
| Delete 键选中 linked 节点 | 静默忽略 |
| 拖拽 linked 节点 | handleDrag 不序列化 |

## 9. 测试要点

- `parseFolders`：常规、尾部反斜杠、空、多条目
- `addFolder`（serializer）：新建 ItemGroup、追加到已有 Folder 块、重复条目去重（归一化比较）
- `addCompileRemove`：新建/追加
- `excludeFiles`：传统移除多条目、SDK 写 Remove、混合分隔符、返回数
- `generateByKind`：四种模板输出正确关键字与命名空间
- `isLinkedPath`：`..`、`../x`、`..\x`、正常路径、`a..b` 不误判
- `CsprojService.addFolder`：传统写条目+mkdir、SDK 仅 mkdir、重名报错
- 手动清单：子菜单、空文件夹显示（两种项目）、多选删除/排除（含混合、含 linked）、linked 菜单裁剪、拖拽跳过 linked
