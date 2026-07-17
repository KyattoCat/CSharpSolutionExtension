# Change Log

All notable changes to the "csharpsolution" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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