// src/commands/propertiesCommands.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectNode } from '../models/ProjectNode';
import { ProjectTreeProvider } from '../tree/ProjectTreeProvider';
import { ProjectPropertiesPanel } from '../webview/ProjectPropertiesPanel';

/** 注册项目属性相关命令 */
export function registerPropertiesCommands(
    context: vscode.ExtensionContext,
    treeProvider: ProjectTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.openProjectProperties', async (node?: ProjectNode) => {
            let projectPath: string | undefined;

            if (node?.type === 'project') {
                projectPath = node.project.path;
            } else {
                const projects = treeProvider.allProjects;
                if (projects.length === 0) {
                    vscode.window.showInformationMessage('工作区中未发现 C# 项目');
                    return;
                }
                if (projects.length === 1) {
                    projectPath = projects[0].path;
                } else {
                    const picked = await vscode.window.showQuickPick(
                        projects
                            .map(project => ({
                                label: project.name,
                                description: path.relative(
                                    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
                                    project.path
                                ),
                                projectPath: project.path,
                            }))
                            .sort((a, b) => a.label.localeCompare(b.label)),
                        { placeHolder: '选择要配置的项目' }
                    );
                    projectPath = picked?.projectPath;
                }
            }

            if (!projectPath) {
                return;
            }
            await ProjectPropertiesPanel.createOrShow(context, projectPath, () => treeProvider.allProjects);
        })
    );
}
