// src/commands/watchers.ts
import * as vscode from 'vscode';

/** 注册 csproj/sln/slnx 文件监听，变化后防抖 500ms 触发刷新 */
export function registerWatchers(context: vscode.ExtensionContext): void {
    // --- 文件监听（防抖 500ms）---
    const watcher = vscode.workspace.createFileSystemWatcher(
        '**/*.csproj',
        false, false, false
    );

    let debounceTimer: NodeJS.Timeout | undefined;
    const debouncedRefresh = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            vscode.commands.executeCommand('csharpsolution.refresh');
        }, 500);
    };

    watcher.onDidCreate(debouncedRefresh);
    watcher.onDidChange(debouncedRefresh);
    watcher.onDidDelete(debouncedRefresh);
    context.subscriptions.push(watcher);

    const slnWatcher = vscode.workspace.createFileSystemWatcher(
        '**/*.sln',
        false, false, false
    );
    slnWatcher.onDidCreate(debouncedRefresh);
    slnWatcher.onDidChange(debouncedRefresh);
    slnWatcher.onDidDelete(debouncedRefresh);
    context.subscriptions.push(slnWatcher);

    const slnxWatcher = vscode.workspace.createFileSystemWatcher(
        '**/*.slnx',
        false, false, false
    );
    slnxWatcher.onDidCreate(debouncedRefresh);
    slnxWatcher.onDidChange(debouncedRefresh);
    slnxWatcher.onDidDelete(debouncedRefresh);
    context.subscriptions.push(slnxWatcher);
}
