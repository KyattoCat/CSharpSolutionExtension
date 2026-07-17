// src/extension.ts
import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/ProjectTreeProvider';
import { DragDropController } from './tree/DragDropController';
import { registerFileCommands } from './commands/fileCommands';
import { registerProjectCommands } from './commands/projectCommands';
import { registerNavCommands } from './commands/navCommands';
import { registerWatchers } from './commands/watchers';
import { MsBuildLocator } from './services/MsBuildLocator';

export function activate(context: vscode.ExtensionContext) {
    console.log('C# Project Manager extension activated');

    const treeProvider = new ProjectTreeProvider();

    const dragDropController = new DragDropController(treeProvider, () => {
        vscode.commands.executeCommand('csharpsolution.refresh');
    });

    const treeView = vscode.window.createTreeView('csharpsolution-projects', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: dragDropController,
    });

    treeView.message = '扫描中...';
    context.subscriptions.push(treeView);

    registerNavCommands(context, treeProvider, treeView);
    registerFileCommands(context, treeProvider, treeView);
    registerProjectCommands(context, treeProvider);
    registerWatchers(context);

    // --- buildTool/msbuildPath 配置变更时重置 MSBuild 探测缓存 ---
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('csharpsolution.buildTool') ||
                e.affectsConfiguration('csharpsolution.msbuildPath')) {
                MsBuildLocator.reset();
            }
        })
    );

    // --- 初始扫描 ---
    vscode.commands.executeCommand('csharpsolution.refresh');
}

export function deactivate() {}
