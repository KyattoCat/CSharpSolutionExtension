# 右键重命名 + 构建集成设计规格

> 日期: 2026-07-16 | 状态: 待审阅 | 基于: v1.0.0

## 概述

为 CSharpSolution 扩展新增两个功能：
1. **右键重命名** — 重命名 .cs 文件，同步更新 .csproj 路径和当前文件的 namespace/class 声明
2. **构建集成** — 右键项目节点执行 dotnet build/clean/rebuild，输出到 OutputChannel

---

## 目标与非目标

**目标：**
- 文件重命名同时更新 .csproj `<Compile Include>` 路径
- 根据配置自动更新重命名文件内的 namespace 和 class 声明
- 项目节点右键菜单新增 生成/清理/重新生成
- 构建输出显示在专用 OutputChannel "C# Build"

**非目标：**
- 不跨文件搜索引用（不更新其他文件中对被重命名类的引用）
- 不支持 msbuild 直接调用（仅 dotnet CLI）
- 不提供构建参数自定义界面
- 不处理解决方案级别的构建

---

## 架构变更

### 模块拆分

将 `CsprojService` 中文件相关操作拆分到 `FileService`，构建独立为 `BuildService`：

```
src/services/
├── FileService.ts          ← 新建：renameFile() + 迁入 deleteFile()
├── BuildService.ts         ← 新建：build() / clean() / rebuild()
├── CsprojService.ts        ← 精简：addClass / addExistingFile / removePackage
├── FileTemplateService.ts  ← 不变
└── ProjectDiscovery.ts     ← 不变
```

| 模块 | 职责 | 变更 |
|------|------|------|
| `FileService` | `renameFile()`、`deleteFile()` | 全新 + 迁入 delete |
| `BuildService` | `build()`、`clean()`、`rebuild()` | 全新 |
| `CsprojService` | `addClass()`、`addExistingFile()`、`removePackage()` | 移除 deleteFile |
| `extension.ts` | 注册新命令、OutputChannel、读取新配置 | 修改 |

### CsprojSerializer 新增方法

新增 `updateCompilePath` 方法：

```typescript
static updateCompilePath(xml: string, oldInclude: string, newInclude: string): string
```

从 .csproj 中将 `Include="oldInclude"` 替换为 `Include="newInclude"`，保持格式不变。

---

## 功能一：重命名文件

### 右键菜单

| 节点类型 | 菜单项 | 分组 |
|----------|--------|------|
| 🔷 .cs 文件 | `✏ 重命名` | navigation@1 |

### 操作流程

```
用户: 右键 .cs 文件 → "重命名"
  ↓ 输入框（预填当前文件名，不含扩展名）
  ↓ 验证 C# 标识符规则
  ↓
FileService.renameFile(projectPath, compileItem, newName):
  1. newRelPath = oldDir + newName + '.cs'
  2. 检查 newRelPath 是否已存在 → 报错终止
  3. 读取 .cs 内容，根据 csharpsolution.renameSyncCode 决定是否替换：
     - true → 替换 class/struct/interface/enum/record 声明名称
     - true → 替换构造函数名（public OldName( → public NewName(）
     - false → 不改文件内容
  4. 写入修改后的内容到新文件路径
  5. 删除旧文件
  6. CsprojSerializer.updateCompilePath() 更新 .csproj 路径
  7. ProjectTreeProvider.refresh()
```

### 失败回滚

任一步骤失败时：
- 如果新文件已写入 → 删除新文件
- 如果旧文件已删除 → 从回收站恢复（如无法恢复则报错）
- .csproj 恢复原值
- 确保不丢失用户代码

### 代码替换规则

只在当前文件内替换，不跨文件：

```
旧名: User → 新名: Customer
替换: public class User → public class Customer
      public User( → public Customer(   ← 构造函数
      class User<T> → class Customer<T> ← 泛型
```

不处理：`User user = new User()`（实例化引用，由 IDE 的重构功能处理）

---

## 功能二：构建集成

### 右键菜单

| 节点类型 | 菜单项 | 分组 |
|----------|--------|------|
| 📦 项目节点 | `🔨 生成` | group2@1 |
| | `🧹 清理` | group2@2 |
| | `🔄 重新生成` | group2@3 |

### 构建流程

```
用户: 右键项目 → "生成"
  ↓
BuildService.build(projectPath):
  1. 检查 dotnet CLI 可用性 → 不可用则报错
  2. 获取/创建 OutputChannel "C# Build"
  3. channel.show(true)
  4. channel.appendLine(`[${timestamp}] 生成 ${projectName}...`)
  5. spawn('dotnet', ['build', projectPath], { cwd: projectDir })
     - stdout → channel.appendLine()
     - stderr → channel.appendLine(`❌ ${line}`)
  6. 等待进程退出:
     - 成功 → channel.appendLine('✅ 生成成功')
     - 失败 → channel.appendLine('❌ 生成失败') + showErrorMessage
```

### Clean / Rebuild

- **Clean:** `dotnet clean <projectPath>`，清除 obj/bin
- **Rebuild:** 依次执行 clean → build，clean 失败则终止

### OutputChannel

- 名称：`C# Build`
- 每次构建前自动清空
- 显示时间戳和项目名
- 项目名称来源于 `CsprojProject.name`

---

## 新增配置

在 `package.json` 的 `configuration` 中新增：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `csharpsolution.renameSyncCode` | `boolean` | `true` | 重命名文件时自动更新 class/namespace 声明 |

---

## 新增命令

| 命令 ID | 标题 | 用途 |
|---------|------|------|
| `csharpsolution.renameFile` | 重命名 | 文件重命名入口 |
| `csharpsolution.build` | 生成 | 构建单个项目 |
| `csharpsolution.clean` | 清理 | 清理单个项目 |
| `csharpsolution.rebuild` | 重新生成 | 重新生成单个项目 |

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| dotnet CLI 不可用 | `showErrorMessage` "未找到 .NET SDK" |
| 构建失败（exitCode ≠ 0） | 错误信息写入 OutputChannel + `showErrorMessage` |
| 重命名目标文件已存在 | 报错，不覆盖 |
| 新文件名不合法 | 输入框即时验证，不通过不提交 |
| 重命名过程中 .csproj 写入失败 | 回滚已做的文件操作 |

---

## 测试策略

| 模块 | 测试内容 | 方式 |
|------|----------|------|
| FileService.renameFile | 重命名流程、内容替换、回滚 | 单元测试（mock fs） |
| CsprojSerializer.updateCompilePath | 路径替换，格式保持 | 单元测试 |
| BuildService | dotnet 命令拼接、shell spawn | 单元测试（mock child_process） |
| OutputChannel | 构建输出格式 | 集成测试 |
| 重构验证 | deleteFile 行为不变 | 现有 27 个测试继续 PASS |
