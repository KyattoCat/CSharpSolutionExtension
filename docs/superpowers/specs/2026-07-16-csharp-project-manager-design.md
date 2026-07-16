# C# 老项目管理插件设计规格

> 日期: 2026-07-16 | 状态: 待审阅

## 概述

为 VS Code 开发一个扩展插件，用于管理传统格式（非 SDK 风格）的 C# 项目。核心功能包括：在资源管理器新增【项目管理】面板展示工作区内所有项目、显示项目引用和文件、右键添加类（自动更新 .csproj）、删除文件时同步更新 .csproj。

**适用范围：** 所有显式包含 `<Compile Include="..."/>` 元素的 .csproj 文件（.NET Framework 4.x 及早期 .NET Core 项目）。

---

## 目标与非目标

**目标：**
- 在 VS Code Explorer 中提供直观的 C# 项目浏览器
- 支持通过右键菜单快速添加类和删除文件，自动维护 .csproj
- 自动发现工作区中所有 .csproj，支持配置排除

**非目标：**
- 不处理 SDK 风格项目（`<Project Sdk="...">`）——这些项目自动包含源文件，无需手动管理
- 不提供 .csproj 文件的全量编辑器/可视化设计器
- 不管理 NuGet 包的安装/卸载（仅读取显示）
- 不支持 .vbproj、.fsproj 等其他项目类型（仅 .csproj）
- 不提供 MSBuild 构建集成

---

## 架构

采用模型驱动的分层架构（方案 B）：

```
src/
├── extension.ts              # 入口：注册 TreeView、命令、事件监听
├── tree/
│   └── ProjectTreeProvider.ts # TreeDataProvider 实现，构建树节点
├── models/
│   ├── CsprojModel.ts         # 核心实体：Project、Reference、SourceFile
│   └── ProjectNode.ts         # 树节点类型定义
├── services/
│   ├── ProjectDiscovery.ts    # 扫描工作区，发现所有 .csproj
│   ├── CsprojService.ts       # 业务层：添加类、删除文件
│   └── FileTemplateService.ts # 生成 C# 类文件模板
└── serialization/
    ├── CsprojSerializer.ts    # .csproj XML 读写（处理 MSBuild 命名空间）
    └── PackagesConfigSerializer.ts  # packages.config 读取
```

| 层 | 模块 | 职责 |
|----|------|------|
| 入口 | `extension.ts` | 激活/停用扩展，注册 TreeDataProvider、命令、FileSystemWatcher |
| 视图 | `ProjectTreeProvider` | 接收模型数据，构建 VS Code TreeItem 树，处理右键菜单 context |
| 服务 | `ProjectDiscovery` | 用 `vscode.workspace.findFiles` 扫描 `**/*.csproj`，过滤排除模式 |
| 服务 | `CsprojService` | 编排增删操作：调用 Serializer 读 → 改模型 → Serializer 写回 |
| 服务 | `FileTemplateService` | 根据类名 + 目录路径生成 .cs 内容，自动推断 namespace |
| 模型 | `CsprojModel` | 纯数据结构，不依赖 VS Code 类型 |
| 模型 | `ProjectNode` | 树节点描述，不依赖 VS Code 类型 |
| 序列化 | `CsprojSerializer` | 解析/生成 MSBuild XML，保持原有格式和缩进 |
| 序列化 | `PackagesConfigSerializer` | 解析 packages.config 中的 NuGet 引用 |

---

## Tree View 结构

### 树形布局

```
📁 项目管理
├── 📦 MyApp.csproj
│   ├── 📂 引用
│   │   ├── 📁 项目引用
│   │   │   └── 🔗 MyApp.Core
│   │   ├── 📁 程序集引用
│   │   │   └── 🔧 System.Data.dll
│   │   ├── 📁 NuGet 包
│   │   │   └── 📦 Newtonsoft.Json v13.0.1
│   │   └── 📁 分析器
│   │       └── ⚙ StyleCop.Analyzers
│   ├── 📂 Properties
│   │   └── 🔷 AssemblyInfo.cs
│   └── 📂 Models
│       ├── 🔷 User.cs
│       └── 🔷 Order.cs
├── 📦 MyApp.Tests.csproj
│   ├── 📂 引用
│   │   └── ...
│   └── 🔷 UnitTest1.cs
```

### 节点类型

- **项目节点** `project` — 代表一个 .csproj 项目
- **引用组** `refGroup` — 固定的"引用"分组
- **引用子组** `refSubGroup` — 项目引用 / 程序集引用 / NuGet 包 / 分析器
- **引用项** `reference` / `projectRef` / `package` / `analyzer` — 具体引用
- **文件夹** `folder` — 虚拟节点，根据 Compile 文件路径聚合生成
- **文件** `file` — 对应一个 `<Compile Include="..."/>` 条目

### 右键菜单

| 节点类型 | 菜单项 | 行为 |
|----------|--------|------|
| 📦 项目节点 | `➕ 添加类...` | 弹出输入框 → 在项目根创建类 |
| | `📋 添加现有文件...` | 文件选择器 → 复制到项目目录 + 加入 Compile |
| 📂 文件夹节点 | `➕ 添加类...` | 弹出输入框 → 在该目录创建类 |
| 🔷 .cs 文件 | `🗑 删除` | 确认 → 删文件到回收站 + 从 Compile 移除 |
| 📦 NuGet 包 | `🗑 移除包` | 从 packages.config 移除 |

### 交互细节

- 点击文件节点在编辑器中打开（通过 `resourceUri` 机制）
- 文件夹节点根据 Compile 路径自动聚合生成，无对应磁盘目录则不显示
- 项目文件外部变化通过 FileSystemWatcher（防抖 500ms）监听 → 自动 refresh

---

## 数据模型

```typescript
// === CsprojModel.ts ===

interface CsprojProject {
  path: string;              // .csproj 绝对路径
  name: string;              // 项目名（文件名去掉扩展名）
  compiles: CompileItem[];
  references: ReferenceItem[];
  projectReferences: ProjectReferenceItem[];
  packages: PackageItem[];
  analyzers: AnalyzerItem[];
}

interface CompileItem {
  include: string;           // 相对路径，如 "Models\\User.cs"
  link?: string;             // 链接文件的目标路径（可选）
}

interface ReferenceItem {
  include: string;           // 程序集名，如 "System.Data"
  hintPath?: string;
}

interface ProjectReferenceItem {
  include: string;           // 相对路径，如 "..\\MyApp.Core\\MyApp.Core.csproj"
  name?: string;
}

interface PackageItem {
  id: string;
  version: string;
  targetFramework?: string;
}

interface AnalyzerItem {
  include: string;
}
```

```typescript
// === ProjectNode.ts ===

type ProjectNode =
  | { type: 'project';       project: CsprojProject }
  | { type: 'refGroup';      label: '引用';         projectPath: string }
  | { type: 'refSubGroup';   label: string;          projectPath: string }
  | { type: 'reference';     item: ReferenceItem;     projectPath: string }
  | { type: 'projectRef';    item: ProjectReferenceItem; projectPath: string }
  | { type: 'package';       item: PackageItem;       projectPath: string }
  | { type: 'analyzer';      item: AnalyzerItem;      projectPath: string }
  | { type: 'folder';        relPath: string;         projectPath: string }
  | { type: 'file';          compile: CompileItem;    projectPath: string };
```

### 目录树构建逻辑

- 遍历 `compiles` 数组中的所有 `include` 路径
- 按 `/` 或 `\` 拆分为目录层级
- 聚合为树：`Models/User.cs` → folder "Models" → file "User.cs"

---

## 核心操作流程

### 添加类

```
用户: 右键项目/文件夹 → "添加类..."
  ↓ 输入框 "请输入类名"（验证 C# 标识符规则）
  ↓
CsprojService.addClass(projectPath, dirPath, className):
  1. 计算完整路径: <projectDir>/<dirPath>/<ClassName>.cs
  2. 文件已存在 → 报错终止
  3. FileTemplateService.generate(className, namespace):
     - namespace = 项目根命名空间 + 目录路径转命名空间
     - 使用可配置模板生成 .cs 内容
  4. vscode.workspace.applyEdit() 创建 .cs 文件
  5. CsprojSerializer: 添加 <Compile Include="dir\ClassName.cs" />
     保持原有 XML 格式（缩进风格、换行方式）
  6. ProjectTreeProvider.refresh()
```

### 删除文件

```
用户: 右键 .cs 文件 → "删除"
  ↓ 确认对话框 "文件将移至回收站，并从项目中移除。确定？"
  ↓
CsprojService.deleteFile(projectPath, compileItem):
  1. CsprojSerializer: 查找并移除对应 <Compile Include="..." />
  2. vscode.workspace.fs.delete(uri, { useTrash: true })
  3. ProjectTreeProvider.refresh()
```

### 添加现有文件

```
用户: 右键项目 → "添加现有文件..."
  ↓ 文件选择器
  ↓
CsprojService.addExistingFile(projectPath, sourceFileUri):
  1. 复制文件到项目目录（使用 WorkspaceEdit）
  2. CsprojSerializer: 添加 <Compile Include="..." />
  3. ProjectTreeProvider.refresh()
```

### 移除 NuGet 包

```
用户: 右键 NuGet 包 → "移除包"
  ↓ 确认对话框
  ↓
CsprojService.removePackage(projectPath, packageId):
  1. PackagesConfigSerializer: 移除对应 <package> 元素
  2. ProjectTreeProvider.refresh()
```

---

## 项目发现

### 初始扫描

扩展激活时执行：
1. `vscode.workspace.findFiles('**/*.csproj')` 查找所有项目文件
2. 排除默认模式：`**/node_modules/**`, `**/bin/**`, `**/obj/**`
3. 应用用户配置的 `exclusionPatterns` 做二次过滤
4. 对每个 .csproj 调用 `CsprojSerializer.read()` 解析
5. 返回 `CsprojProject[]` 传递给 TreeDataProvider

### 运行时监听

- `FileSystemWatcher` 监听 `**/*.csproj` 和 `**/packages.config`
- 变化时自动 refresh()，防抖 500ms
- 新增/删除 .csproj 文件时重新扫描

---

## 扩展配置

在 `package.json` 的 `contributes.configuration` 中注册：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `csharpsolution.excludePatterns` | `string[]` | `[]` | 额外的排除 glob 模式 |
| `csharpsolution.defaultNamespace` | `string` | `""` | 默认根命名空间（空 = 用项目名） |
| `csharpsolution.classTemplate` | `string[]` | 见下方 | 类文件模板，每项一行 |

**默认模板：**
```
using System;

namespace {namespace}
{
    public class {className}
    {

    }
}
```

**模板变量：** `{namespace}` — 推断的命名空间；`{className}` — 用户输入的类名。

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| .csproj 解析失败（格式损坏） | `vscode.window.showErrorMessage`，跳过该项目 |
| 文件已存在（添加类时） | 错误提示，不覆盖 |
| 类名包含非法字符 | 即时验证，不通过则不允许提交 |
| .csproj 写回失败（权限等） | 错误提示，不丢失数据 |
| 工作区无 .csproj | 面板显示空状态提示："未发现 C# 项目" |
| 外部程序修改了 .csproj | FileSystemWatcher 触发自动刷新 |

---

## 测试策略

| 层次 | 测试内容 | 方式 |
|------|----------|------|
| `CsprojSerializer` | 解析/生成 XML，保持格式不变 | 单元测试（fixture .csproj 文件） |
| `PackagesConfigSerializer` | 解析/生成 packages.config | 单元测试 |
| `FileTemplateService` | namespace 推断、模板替换 | 单元测试 |
| `CsprojService` | 添加/删除操作的编排逻辑 | 单元测试（mock 文件系统） |
| `ProjectTreeProvider` | 树节点构建正确性 | 单元测试（给定模型，验证节点结构） |
| `ProjectDiscovery` | 扫描和过滤逻辑 | 集成测试 |
| 端到端 | 完整添加类 / 删除文件流程 | 手动测试 + vscode-test |

---

## 依赖

- **运行时：** VS Code API（TreeDataProvider、FileSystemWatcher、WorkspaceEdit）
- **XML 处理：** 手写递归解析器（不引入第三方 XML 库，MSBuild XML 结构简单且需要精确控制格式保持）
- **测试：** `@vscode/test-electron`, `mocha`

---

## 待定（未来版本）

- 支持更多文件模板（interface、enum、struct）
- 支持 `packages.config` 中 NuGet 包的搜索和安装
- 支持 .csproj 属性编辑（TargetFramework、OutputType 等）
- 多项目间拖拽移动文件
