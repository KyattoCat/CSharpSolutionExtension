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

        // 3. 确保目标目录存在
        const targetDir = path.dirname(newAbsPath);
        await fs.promises.mkdir(targetDir, { recursive: true });

        // 4. 读取 .csproj 判断是否为 SDK 项目
        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);

        // 5. 移动物理文件
        await fs.promises.rename(oldAbsPath, newAbsPath);

        // 6. 更新 .csproj（非 SDK 项目）
        if (!isSdk) {
            const updatedContent = CsprojSerializer.updateCompilePath(
                csprojContent,
                oldRelPath,
                newRelPath
            );

            if (updatedContent === csprojContent) {
                // 回滚文件移动
                await fs.promises.rename(newAbsPath, oldAbsPath);
                throw new Error(`Path not found in csproj: ${oldRelPath}`);
            }

            await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');
        }
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
