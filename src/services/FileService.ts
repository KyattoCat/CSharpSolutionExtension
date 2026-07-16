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
            const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
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
