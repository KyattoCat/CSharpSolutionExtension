// src/extension.ts
import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/ProjectTreeProvider';
import { DragDropController } from './tree/DragDropController';
import { registerFileCommands } from './commands/fileCommands';
import { registerProjectCommands } from './commands/projectCommands';
import { registerNavCommands } from './commands/navCommands';
import { registerWatchers } from './commands/watchers';

export function activate(context: vscode.ExtensionContext) {
    console.log('C# Project Manager extension activated');

    const treeProvider = new ProjectTreeProvider();

    const dragDropController = new DragDropController(treeProvider, () => {
        vscode.commands.executeCommand('csharpsolution.refresh');
    });

    const treeView = vscode.window.createTreeView('csharpsolution-projects', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
        dragAndDropController: dragDropController,
    });

    treeView.message = '扫描中...';
    context.subscriptions.push(treeView);

    registerNavCommands(context, treeProvider, treeView);
    registerFileCommands(context, treeProvider, treeView);
    registerProjectCommands(context);
    registerWatchers(context);

    // --- 初始扫描 ---
    vscode.commands.executeCommand('csharpsolution.refresh');
}

export function deactivate() {}
