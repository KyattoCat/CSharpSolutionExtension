// src/services/CsprojService.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojSerializer } from '../serialization/CsprojSerializer';
import { PackagesConfigSerializer } from '../serialization/PackagesConfigSerializer';
import { FileTemplateService } from './FileTemplateService';

export class CsprojService {

    static async addClass(
        projectPath: string,
        dirPath: string,
        className: string,
        rootNamespace: string,
        classTemplate: string[]
    ): Promise<vscode.Uri> {
        if (!FileTemplateService.isValidClassName(className)) {
            throw new Error(`无效的类名: "${className}"。类名必须为合法的 C# 标识符。`);
        }

        const projectDir = path.dirname(projectPath);
        const fileRelPath = dirPath
            ? path.join(dirPath, `${className}.cs`)
            : `${className}.cs`;
        const fileAbsPath = path.join(projectDir, fileRelPath);
        const fileUri = vscode.Uri.file(fileAbsPath);

        try {
            await fs.promises.access(fileAbsPath);
            throw new Error(`文件已存在: ${fileRelPath}`);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('文件已存在')) {
                throw err;
            }
        }

        const namespace = rootNamespace || path.basename(projectPath, '.csproj');
        const fullNs = FileTemplateService.inferNamespace(namespace, dirPath);
        const classContent = FileTemplateService.generate(fullNs, className, classTemplate);

        const targetDir = path.dirname(fileAbsPath);
        await fs.promises.mkdir(targetDir, { recursive: true });
        await fs.promises.writeFile(fileAbsPath, classContent, 'utf-8');

        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const updatedContent = CsprojSerializer.addCompile(csprojContent, fileRelPath);
        await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');

        return fileUri;
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
