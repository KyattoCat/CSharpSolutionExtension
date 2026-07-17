// src/commands/projectCommands.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectNode } from '../models/ProjectNode';
import { BuildService } from '../services/BuildService';
import { SlnService } from '../services/SlnService';

/** 注册项目/解决方案级命令：生成 / 清理 / 重新生成 / 添加新项目 / 添加已有项目 / 从解决方案移除 */
export function registerProjectCommands(context: vscode.ExtensionContext): void {
    // --- 生成 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.build', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'solution')) return;
            const targetPath = node.type === 'solution' ? node.solution.path : node.project.path;
            const targetName = node.type === 'solution' ? node.solution.name : node.project.name;
            await BuildService.build(targetPath, targetName);
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 清理 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.clean', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'solution')) return;
            const targetPath = node.type === 'solution' ? node.solution.path : node.project.path;
            const targetName = node.type === 'solution' ? node.solution.name : node.project.name;
            await BuildService.clean(targetPath, targetName);
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 重新生成 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.rebuild', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'solution')) return;
            const targetPath = node.type === 'solution' ? node.solution.path : node.project.path;
            const targetName = node.type === 'solution' ? node.solution.name : node.project.name;
            await BuildService.rebuild(targetPath, targetName);
            vscode.commands.executeCommand('csharpsolution.refresh');
        })
    );

    // --- 添加已有项目到解决方案 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addExistingProject', async (node: ProjectNode) => {
            if (!node || node.type !== 'solution') return;

            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: '选择项目文件',
                filters: { 'C# 项目': ['csproj'] },
            });

            if (!files || files.length === 0) return;

            try {
                await SlnService.addProject(node.solution.path, files[0].fsPath);
                vscode.window.showInformationMessage(`已添加: ${path.basename(files[0].fsPath)}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `添加失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 添加新项目到解决方案 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addNewProject', async (node: ProjectNode) => {
            if (!node || node.type !== 'solution') return;

            const templates = await SlnService.getTemplates();
            const templateChoice = await vscode.window.showQuickPick(
                templates.map(t => ({ label: t.label, description: t.description, id: t.id })),
                { placeHolder: '选择项目模板' }
            );
            if (!templateChoice) return;

            const projectName = await vscode.window.showInputBox({
                prompt: '请输入项目名称',
                placeHolder: 'MyNewProject',
                validateInput: (value) => {
                    if (!value.trim()) return '项目名不能为空';
                    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(value)) return '项目名包含非法字符';
                    return null;
                },
            });
            if (!projectName) return;

            try {
                const slnDir = path.dirname(node.solution.path);
                await SlnService.createProject(node.solution.path, slnDir, templateChoice.id, projectName);
                vscode.window.showInformationMessage(`已创建项目: ${projectName}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `创建失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 从解决方案移除项目 ---
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.removeProjectFromSolution', async (node: ProjectNode) => {
            if (!node || node.type !== 'project' || !node.solutionPath) return;

            const slnPath = node.solutionPath;
            const projectPath = node.project.path;

            const choice = await vscode.window.showWarningMessage(
                `从解决方案中移除 "${node.project.name}"？`,
                { modal: true },
                '仅移除引用',
                '移除并删除文件'
            );

            if (!choice) return;

            try {
                await SlnService.removeProject(slnPath, projectPath);
                vscode.window.showInformationMessage(`已从解决方案移除: ${node.project.name}`);

                if (choice === '移除并删除文件') {
                    const fileUri = vscode.Uri.file(projectPath);
                    await vscode.workspace.fs.delete(fileUri, { useTrash: true });
                }

                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `移除失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );
}
