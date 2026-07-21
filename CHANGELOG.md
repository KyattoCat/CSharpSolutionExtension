# Change Log

All notable changes to the "csharpsolution" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [1.9.5] - 2026-07-21

### Changed
- 所有命令统一添加 `category`（C# Project Manager），在命令面板中可按类别统一检索
- 命令国际化改造：引入 `package.nls.json` + `package.nls.zh-cn.json`，命令面板同时显示中英双语（如 `切换解决方案` / `Switch Solution`），中英文输入均可检索

## [1.9.4] - 2026-07-21

### Added
- VCS 状态装饰升级：Git 文件通过 `resourceUri` 获得原生彩色角标，SVN 文件通过自定义 `FileDecorationProvider` 实现同款彩色角标（M/A/D/? 等）
- 文件变更后 SVN 状态自动刷新（防抖 2s），无需手动刷新面板

### Changed
- 文件节点 VCS 状态从灰色 `description` 文字改为右侧彩色角标，与 VS Code 原生 SCM 视图一致

## [1.9.3] - 2026-07-21

### Added
- 扩展图标，在 VS Code Marketplace 和扩展管理器中显示
- README 添加图标展示

## [1.9.2] - 2026-07-21

### Fixed
- 为 `switchSolution` 命令添加 `category`，使其在命令面板中可被搜索发现

## [1.9.1] - 2026-07-21

### Added
- 右键「编辑项目文件」，直接在编辑器中打开 `.csproj`

## [1.9.0] - 2026-07-20

### Added
- 状态栏构建配置切换（Debug/Release），点击切换，工作区持久化
- C# 诊断装饰：项目节点显示错误/警告数量（红色 `✕ N` / 黄色 `⚠ N`）
- 右键「复制文件路径」，将绝对路径写入剪贴板

### Changed
- 项目树默认折叠所有节点（解决方案、项目、引用）

## [1.8.0] - 2026-07-20

### Added
- 文件/文件夹右键菜单集成 TortoiseSVN（Update/Commit/Diff/Log/Add/Revert/Blame/Clean up/Switch/Resolve/Shelve）
- 文件/文件夹右键菜单集成 TortoiseGit（Pull/Push/Commit/Diff/Fetch/Log/Add/Revert/Blame/Clean up/Switch/Resolve/Stash）
- 自动探测 TortoiseProc.exe 路径（配置项 → 常见路径 → 注册表）
- 新增配置项 `csharpsolution.tortoiseSvnPath` 和 `csharpsolution.tortoiseGitPath`

## [1.7.0] - 2026-07-17

### Added

- **MSBuild 支持** — `csharpsolution.buildTool` 配置（auto / dotnet / msbuild），auto 模式按项目类型智能选择：含传统非 SDK 项目时优先 MSBuild，找不到回退 dotnet 并警告
- **MSBuild 自动探测** — `msbuildPath` 配置 → vswhere（VS/Build Tools 安装）→ PATH 三级定位链，结果会话缓存，配置变更自动重探
- MSBuild 参数：`/t:Build` / `/t:Clean` / `/t:Rebuild`（重新生成单次调用，优于 dotnet 的 clean+build 两段）

### Fixed

- SDK 项目的 `Compile Remove` 通配符（`**/*.cs` / `*.cs` / `?.cs`）从未生效——`matchesGlob` 转义/替换正则不匹配，通配模式被当作字面字符串比较

### Added

- **新增文件子菜单** — 右键「新增文件」收纳 类/接口/枚举/结构体 四种模板
- **新建文件夹** — 传统项目写入 `<Folder Include>` 条目（与 VS 一致），空文件夹在树中立即可见；SDK 项目自动扫描并显示空目录
- **从项目排除** — 文件/文件夹排除：移除 `.csproj` 条目、保留物理文件；SDK 项目写 `<Compile Remove>`
- **多选批量操作** — Ctrl 多选后批量删除、批量排除（自动过滤跨项目节点、文件夹与子项去重）
- **链接条目防护** — `..\` 链接路径的文件/文件夹标记「→ 链接」，仅保留排除与导航菜单，拖拽/删除/重命名/新增均防护
- 解决方案内项目节点补齐 新增文件/新建文件夹/添加现有文件 菜单（修复历史遗漏）

### Fixed

- SDK 项目排除的反斜杠 `Compile Remove` 模式与归一化路径不匹配导致排除无效
- SDK 空目录扫描不再把 `.git` / `.vs` 等点目录显示为项目文件夹
- 子菜单重复贡献导致「新增文件」菜单不显示（同一 submenu 在同一菜单只能贡献一次）

## [1.5.0] - 2026-07-17

### Added

- **在集成终端中打开** — 项目/解决方案/文件夹/文件节点右键新命令，在对应目录打开集成终端（文件定位到其父目录）
- **Delete 键删除** — 项目树获得焦点时按 Delete 触发删除，支持文件和文件夹
- **F2 键重命名** — 项目树获得焦点时按 F2 触发重命名，支持文件和文件夹
- **文件夹删除** — 右键/Delete 删除文件夹：批量移除 `.csproj` 条目，目录进回收站，确认框显示文件数
- **文件夹重命名** — 右键/F2 重命名文件夹：目录改名 + 批量更新 `.csproj` 路径，保持原有分隔符风格，支持仅大小写变化的改名

### Security

- 文件夹删除/重命名增加项目目录越界防护——传统 csproj 链接文件（`..\` 路径）产生的文件夹节点无法误删项目外目录

## [1.4.0] - 2026-07-17

### Added

- **拖拽移动** — 支持在项目树中拖拽文件/文件夹到同项目的其他文件夹或项目根节点
  - 自动移动物理文件并更新非 SDK 项目的 `.csproj`（SDK 项目仅移动物理文件）
  - 兼容传统 `.csproj` 的反斜杠路径分隔符，保持原有分隔符风格
  - 目标存在同名文件时逐个询问：跳过 / 覆盖 / 取消全部
  - 覆盖时同步移除目标文件的 `.csproj` 条目（目标文件进回收站）
  - 「取消全部」完全无副作用（决策收集与执行分离）
  - 多选拖拽自动去重（文件夹与其子项同时选中时只移动文件夹）
  - 阻止将文件夹拖入其自身或子目录