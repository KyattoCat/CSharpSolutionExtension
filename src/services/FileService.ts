import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojSerializer } from '../serialization/CsprojSerializer';
import { CompileItem } from '../models/CsprojModel';

export class FileService {

    static async renameFile(
        projectPath: string,
        compileItem: CompileItem,
        newName: string,
        syncCode: boolean = true
    ): Promise<void> {
        const projectDir = path.dirname(projectPath);
        const oldRelPath = compileItem.include;
        const oldDir = path.dirname(oldRelPath);
        const newRelPath = oldDir && oldDir !== '.'
            ? path.join(oldDir, `${newName}.cs`)
            : `${newName}.cs`;
        const oldAbsPath = path.join(projectDir, oldRelPath);
        const newAbsPath = path.join(projectDir, newRelPath);

        try {
            await fs.promises.access(newAbsPath);
            throw new Error(`File already exists: ${newRelPath}`);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('File already exists')) {
                throw err;
            }
        }

        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);
        if (isSdk) {
            const targetDir = path.dirname(newAbsPath);
            await fs.promises.mkdir(targetDir, { recursive: true });
            await fs.promises.rename(oldAbsPath, newAbsPath);
            return;
        }

        let newContent: string;
        try {
            const oldContent = await fs.promises.readFile(oldAbsPath, 'utf-8');
            newContent = oldContent;
            if (syncCode) {
                newContent = this.replaceClassName(oldContent, newName, path.basename(oldRelPath, '.cs'));
            }
        } catch (err) {
            throw new Error(`Failed to read file: ${oldRelPath}`);
        }

        try {
            const targetDir = path.dirname(newAbsPath);
            await fs.promises.mkdir(targetDir, { recursive: true });
            await fs.promises.writeFile(newAbsPath, newContent, 'utf-8');
        } catch (err) {
            throw new Error(`Failed to write file: ${newRelPath}`);
        }

        let oldDeleted = false;
        try {
            await fs.promises.unlink(oldAbsPath);
            oldDeleted = true;
        } catch (err) {
            try { await fs.promises.unlink(newAbsPath); } catch { /* ignore */ }
            throw new Error(`Failed to delete old file: ${oldRelPath}`);
        }

        try {
            const updatedContent = CsprojSerializer.updateCompilePath(csprojContent, oldRelPath, newRelPath);
            if (updatedContent === csprojContent) {
                throw new Error(`Path not found in csproj: ${oldRelPath}`);
            }
            await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');
        } catch (err) {
            try { await fs.promises.unlink(newAbsPath); } catch { /* ignore */ }
            if (oldDeleted) {
                await fs.promises.writeFile(oldAbsPath, syncCode
                    ? this.replaceClassName(newContent, path.basename(oldRelPath, '.cs'), newName)
                    : newContent, 'utf-8');
            }
            throw err;
        }
    }

    static async deleteFile(
        projectPath: string,
        compileItem: CompileItem
    ): Promise<void> {
        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);
        if (isSdk) {
            const projectDir = path.dirname(projectPath);
            const filePath = path.join(projectDir, compileItem.include);
            const fileUri = vscode.Uri.file(filePath);
            try {
                await vscode.workspace.fs.delete(fileUri, { useTrash: true });
            } catch (err) {
                console.warn(`Failed to delete file: ${filePath}`, err);
            }
            return;
        }

        const updatedContent = CsprojSerializer.removeCompile(csprojContent, compileItem.include);
        await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');

        const projectDir = path.dirname(projectPath);
        const filePath = path.join(projectDir, compileItem.include);
        const fileUri = vscode.Uri.file(filePath);
        try {
            await vscode.workspace.fs.delete(fileUri, { useTrash: true });
        } catch (err) {
            console.warn(`Failed to delete file: ${filePath}`, err);
        }
    }

    /**
     * 将文件从 oldRelPath 移动到 newRelPath。
     * 移动物理文件，对非 SDK 项目同步更新 .csproj 中的 Compile Include 路径。
     */
    static async moveFile(
        projectPath: string,
        oldRelPath: string,
        newRelPath: string
    ): Promise<void> {
        const projectDir = path.dirname(projectPath);
        const oldAbsPath = path.join(projectDir, oldRelPath);
        const newAbsPath = path.join(projectDir, newRelPath);

        // 1. 验证源文件存在
        try {
            await fs.promises.access(oldAbsPath);
        } catch {
            throw new Error(`Source file not found: ${oldRelPath}`);
        }

        // 2. 安全检查 —— 目标文件不应存在（上层已做冲突检测）
        try {
            await fs.promises.access(newAbsPath);
            throw new Error(`Target file already exists: ${newRelPath}`);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('Target file already exists')) {
                throw err;
            }
            // 文件不存在 → 正常，继续
        }

        // 3. 读取 .csproj 判断是否为 SDK 项目
        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);

        // 4. 非 SDK 项目：先计算更新后的 .csproj 内容（在移动文件前完成校验，避免回滚）。
        //    传统 .csproj 通常使用反斜杠分隔符，先按原样匹配，失败后翻转分隔符重试，
        //    写入的新路径与匹配成功的分隔符风格保持一致。
        let updatedContent: string | undefined;
        if (!isSdk) {
            updatedContent = CsprojSerializer.updateCompilePath(
                csprojContent,
                oldRelPath,
                newRelPath
            );
            if (updatedContent === csprojContent) {
                updatedContent = CsprojSerializer.updateCompilePath(
                    csprojContent,
                    oldRelPath.replace(/\//g, '\\'),
                    newRelPath.replace(/\//g, '\\')
                );
            }
            if (updatedContent === csprojContent) {
                throw new Error(`Path not found in csproj: ${oldRelPath}`);
            }
        }

        // 5. 确保目标目录存在，移动物理文件
        const targetDir = path.dirname(newAbsPath);
        await fs.promises.mkdir(targetDir, { recursive: true });
        await fs.promises.rename(oldAbsPath, newAbsPath);

        // 6. 写入 .csproj（非 SDK 项目），失败时回滚文件移动
        if (!isSdk && updatedContent !== undefined) {
            try {
                await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');
            } catch (err) {
                await fs.promises.rename(newAbsPath, oldAbsPath);
                throw err;
            }
        }
    }

    /**
     * 删除文件夹：从非 SDK 项目的 .csproj 中移除文件夹下全部 Compile 条目，
     * 并将物理目录移至回收站。返回值为模型中匹配的条目数
     * （即匹配的 CompileItem 数量，不校验 XML 中是否实际发生移除）。
     */
    static async deleteFolder(
        projectPath: string,
        folderRelPath: string,
        compiles: CompileItem[]
    ): Promise<number> {
        const normalizedFolder = folderRelPath.replace(/\\/g, '/').replace(/\/+$/, '');
        if (!normalizedFolder || normalizedFolder === '.') {
            throw new Error(`Invalid folder path: ${folderRelPath}`);
        }
        const prefix = normalizedFolder + '/';

        // 前缀匹配筛出文件夹下所有条目（POSIX 归一化比较）
        const targets = compiles.filter(c => {
            const p = c.include.replace(/\\/g, '/');
            return p === normalizedFolder || p.startsWith(prefix);
        });

        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);

        if (!isSdk && targets.length > 0) {
            let updated = csprojContent;
            for (const item of targets) {
                updated = CsprojSerializer.removeCompile(updated, item.include);
            }
            await fs.promises.writeFile(projectPath, updated, 'utf-8');
        }

        // 整个目录进回收站
        const projectDir = path.dirname(projectPath);
        const dirAbsPath = path.join(projectDir, normalizedFolder);
        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(dirAbsPath), {
                recursive: true,
                useTrash: true,
            });
        } catch (err) {
            console.warn(`Failed to delete folder: ${dirAbsPath}`, err);
        }

        return targets.length;
    }

    private static replaceClassName(content: string, newName: string, oldName: string): string {
        const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const typeKeyword = '(?:class|struct|interface|enum|record)';
        const typeRegex = new RegExp(`(${typeKeyword}\\s+)${escaped}(\\b)`, 'g');
        let result = content.replace(typeRegex, `$1${newName}$2`);

        const ctorRegex = new RegExp(`(\\s)${escaped}(\\s*\\()`, 'g');
        result = result.replace(ctorRegex, `$1${newName}$2`);

        return result;
    }
}
