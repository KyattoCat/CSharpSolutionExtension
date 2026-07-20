// src/extension.ts
import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/ProjectTreeProvider';
import { DiagnosticMonitor } from './services/DiagnosticMonitor';
import { DragDropController } from './tree/DragDropController';
import { registerFileCommands } from './commands/fileCommands';
import { registerProjectCommands } from './commands/projectCommands';
import { registerNavCommands } from './commands/navCommands';
import { registerWatchers } from './commands/watchers';
import { registerVcsCommands } from './commands/vcsCommands';
import { MsBuildLocator } from './services/MsBuildLocator';
import { TortoiseService } from './services/TortoiseService';
import { BuildConfigService } from './services/BuildConfigService';

export function activate(context: vscode.ExtensionContext) {
    console.log('C# Project Manager extension activated');

    const diagnosticMonitor = new DiagnosticMonitor();
    context.subscriptions.push(diagnosticMonitor);

    const treeProvider = new ProjectTreeProvider(diagnosticMonitor);

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

    const buildConfigSvc = new BuildConfigService(context);
    context.subscriptions.push(buildConfigSvc);

    // Register toggle command before creating status bar item
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.toggleBuildConfiguration', () => {
            buildConfigSvc.toggle();
        })
    );

    buildConfigSvc.createStatusBarItem();  // lifecycle managed by service.dispose()

    // Wire diagnostic changes to tree refresh
    context.subscriptions.push(
        diagnosticMonitor.onDidChange(() => {
            diagnosticMonitor.refresh(treeProvider.getProjectFileMaps());
            treeProvider.refresh();
        })
    );

    registerNavCommands(context, treeProvider, treeView);
    registerFileCommands(context, treeProvider, treeView);
    registerProjectCommands(context, treeProvider, buildConfigSvc);
    registerWatchers(context);
    registerVcsCommands(context);

    // --- buildTool/msbuildPath 配置变更时重置 MSBuild 探测缓存 ---
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('csharpsolution.buildTool') ||
                e.affectsConfiguration('csharpsolution.msbuildPath')) {
                MsBuildLocator.reset();
            }
            if (e.affectsConfiguration('csharpsolution.tortoiseSvnPath') ||
                e.affectsConfiguration('csharpsolution.tortoiseGitPath')) {
                TortoiseService.reset();
            }
        })
    );

    // --- 初始扫描 ---
    vscode.commands.executeCommand('csharpsolution.refresh');
}

export function deactivate() {}
