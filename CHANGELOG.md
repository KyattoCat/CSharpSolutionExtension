# Change Log

All notable changes to the "csharpsolution" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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