// src/services/CsprojService.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojSerializer } from '../serialization/CsprojSerializer';
import { PackagesConfigSerializer } from '../serialization/PackagesConfigSerializer';
import { FileTemplateService, TypeKind } from './FileTemplateService';
import { MsBuildProperties } from './MsBuildProperties';

export class CsprojService {

    /**
     * 添加类。保留签名兼容；classTemplate 参数已废弃（配置项已移除），
     * 实际内容由 FileTemplateService 的 class 模板生成（与原默认模板一致）。
     */
    static async addClass(
        projectPath: string,
        dirPath: string,
        className: string,
        rootNamespace: string,
        _classTemplate: string[]
    ): Promise<vscode.Uri> {
        return this.addType(projectPath, dirPath, className, 'class', rootNamespace);
    }

    /**
     * 解析项目实际使用的根命名空间（新建类型时使用）：
     * `<RootNamespace>` → `<AssemblyName>` → 项目文件名。
     *
     * 含 `$(...)` 的 MSBuild 变量/函数无法在扩展内求值，遇到时回退到下一来源，
     * 避免把字面量 `$(MSBuildProjectName)` 写进源码。
     */
    static async resolveRootNamespace(projectPath: string): Promise<string> {
        const fallback = path.basename(projectPath, '.csproj');
        try {
            const xml = await fs.promises.readFile(projectPath, 'utf-8');
            for (const propertyName of ['RootNamespace', 'AssemblyName']) {
                const value = MsBuildProperties.getEffective(xml, propertyName)?.value.trim();
                if (value && !value.includes('$(')) {
                    return value;
                }
            }
        } catch {
            // 项目文件不可读时用文件名兜底
        }
        return fallback;
    }

    /**
     * 通用新增类型：创建 .cs 文件（按 kind 生成内容）+ 注册 csproj（非 SDK 项目）。
     * 命名空间直接使用根命名空间，不再拼接目录层级。
     */
    static async addType(
        projectPath: string,
        dirPath: string,
        name: string,
        kind: TypeKind,
        rootNamespace: string
    ): Promise<vscode.Uri> {
        if (!FileTemplateService.isValidClassName(name)) {
            throw new Error(`无效的名称: "${name}"。必须为合法的 C# 标识符。`);
        }

        const projectDir = path.dirname(projectPath);
        const fileRelPath = dirPath ? path.join(dirPath, `${name}.cs`) : `${name}.cs`;
        const fileAbsPath = path.join(projectDir, fileRelPath);

        try {
            await fs.promises.access(fileAbsPath);
            throw new Error(`文件已存在: ${fileRelPath}`);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('文件已存在')) {
                throw err;
            }
        }

        const namespace = rootNamespace || path.basename(projectPath, '.csproj');
        const content = FileTemplateService.generateByKind(namespace, name, kind);

        await fs.promises.mkdir(path.dirname(fileAbsPath), { recursive: true });
        await fs.promises.writeFile(fileAbsPath, content, 'utf-8');

        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        if (!CsprojSerializer.isSdk(csprojContent)) {
            const updated = CsprojSerializer.addCompile(csprojContent, fileRelPath);
            await fs.promises.writeFile(projectPath, updated, 'utf-8');
        }

        return vscode.Uri.file(fileAbsPath);
    }

    /**
     * 新建文件夹：物理 mkdir + 非 SDK 项目写入 <Folder> 条目；SDK 项目仅 mkdir。
     */
    static async addFolder(
        projectPath: string,
        parentDirPath: string,
        folderName: string
    ): Promise<void> {
        if (!folderName || folderName === '.' || folderName === '..'
            || /[\\/:*?"<>|]/.test(folderName)
            || /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(folderName)
            || /[. ]$/.test(folderName)) {
            throw new Error(`Invalid folder name: ${folderName}`);
        }

        const parentPosix = parentDirPath.replace(/\\/g, '/').replace(/\/+$/, '');
        const relPath = parentPosix ? path.posix.join(parentPosix, folderName) : folderName;
        const projectDir = path.dirname(projectPath);
        const absPath = path.join(projectDir, relPath);

        try {
            await fs.promises.access(absPath);
            throw new Error(`Folder already exists: ${relPath}`);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('Folder already exists')) {
                throw err;
            }
        }

        await fs.promises.mkdir(absPath, { recursive: true });

        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        if (!CsprojSerializer.isSdk(csprojContent)) {
            const updated = CsprojSerializer.addFolder(csprojContent, relPath);
            if (updated !== csprojContent) {
                await fs.promises.writeFile(projectPath, updated, 'utf-8');
            }
        }
    }

    /**
     * 批量排除：从项目移除条目、不删物理文件。单次读写 csproj，返回条目数。
     * 非 SDK：removeCompile；SDK：addCompileRemove。includes 传原始 include 保持分隔符匹配。
     */
    static async excludeFiles(projectPath: string, includes: string[]): Promise<number> {
        if (includes.length === 0) {
            return 0;
        }
        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const isSdk = CsprojSerializer.isSdk(csprojContent);

        let updated = csprojContent;
        for (const include of includes) {
            updated = isSdk
                ? CsprojSerializer.addCompileRemove(updated, include)
                : CsprojSerializer.removeCompile(updated, include);
        }
        if (updated !== csprojContent) {
            await fs.promises.writeFile(projectPath, updated, 'utf-8');
        }
        return includes.length;
    }

    static async addExistingFile(
        projectPath: string,
        sourceFileUri: vscode.Uri
    ): Promise<void> {
        const projectDir = path.dirname(projectPath);
        const sourceFileName = path.basename(sourceFileUri.fsPath);
        const destPath = path.join(projectDir, sourceFileName);

        const sourceContent = await fs.promises.readFile(sourceFileUri.fsPath);
        await fs.promises.writeFile(destPath, sourceContent);

        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const updatedContent = CsprojSerializer.addCompile(csprojContent, sourceFileName);
        await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');
    }

    static async removePackage(
        projectPath: string,
        packageId: string
    ): Promise<void> {
        const pkgConfigPath = path.join(path.dirname(projectPath), 'packages.config');

        try {
            const content = await fs.promises.readFile(pkgConfigPath, 'utf-8');
            const updated = PackagesConfigSerializer.removePackage(content, packageId);
            await fs.promises.writeFile(pkgConfigPath, updated, 'utf-8');
        } catch (err) {
            throw new Error(`移除包失败: ${packageId} — ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
