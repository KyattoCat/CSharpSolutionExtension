# CSharpSolution

管理传统 C# 项目（非 SDK 风格 `.csproj`）的 VS Code 扩展。

## 功能

- **项目管理面板** — 在侧边栏新增「项目管理」视图，自动发现工作区中所有 `.csproj` 项目
- **项目浏览** — 展开项目查看引用（项目引用、程序集引用、NuGet 包、分析器）和源文件目录树
- **添加类** — 右键项目或文件夹，一键创建 C# 类文件并自动注册到 `.csproj` 的 `<Compile>` 中
- **删除文件** — 右键删除源文件，自动从 `.csproj` 移除对应条目，文件进入回收站
- **添加现有文件** — 将现有 `.cs` 文件加入项目
- **自动刷新** — 监听 `.csproj` 文件变化，面板自动更新

## 使用方式

1. 打开包含传统 `.csproj` 项目的工作区
2. 点击侧边栏「C# 项目管理」图标
3. 在「项目管理」面板中浏览和操作项目

## 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `csharpsolution.excludePatterns` | `string[]` | `[]` | 额外的排除 glob 模式 |
| `csharpsolution.defaultNamespace` | `string` | `""` | 默认根命名空间（留空使用项目名） |
| `csharpsolution.classTemplate` | `string[]` | 标准类模板 | 类文件模板，支持 `{namespace}` 和 `{className}` |

## 要求

- VS Code 1.93.0 及以上
- 适用于显式包含 `<Compile Include="..."/>` 的传统 `.csproj` 项目（.NET Framework 4.x 等）
