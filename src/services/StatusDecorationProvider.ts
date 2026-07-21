import * as vscode from 'vscode';
import * as path from 'path';
import { SvnStatusService } from './SvnStatusService';

/**
 * 自定义 FileDecorationProvider，专门为 SVN 文件提供彩色状态角标。
 *
 * Git 文件的状态由 VS Code 内置 Git 扩展通过 TreeItem.resourceUri 自动处理，
 * 此 Provider 仅在 SVN 模式下生效（通过检查内部 statusMap 是否为空来判断）。
 */
export class StatusDecorationProvider implements vscode.FileDecorationProvider {

    private _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChange.event;

    /** 相对路径 → FileDecoration */
    private statusMap = new Map<string, vscode.FileDecoration>();
    private rootPath: string = '';
    private enabled: boolean = false;
    private debounceTimer?: NodeJS.Timeout;

    /** SVN 状态字符 → 主题色装饰（复用 VS Code 原生 Git 主题色，视觉一致） */
    private static readonly DECORATIONS: Record<string, vscode.FileDecoration> = {
        'M': { badge: 'M', color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),    tooltip: '已修改 (SVN)' },
        'A': { badge: 'A', color: new vscode.ThemeColor('gitDecoration.addedResourceForeground'),       tooltip: '已添加 (SVN)' },
        'D': { badge: 'D', color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),     tooltip: '已删除 (SVN)' },
        '?': { badge: '?', color: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'),   tooltip: '未跟踪 (SVN)' },
        '!': { badge: '!', color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),    tooltip: '已忽略 (SVN)' },
        'C': { badge: 'C', color: new vscode.ThemeColor('gitDecoration.conflictingResourceForeground'), tooltip: '冲突 (SVN)' },
        'R': { badge: 'R', color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),    tooltip: '已替换 (SVN)' },
        '~': { badge: '~', color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),    tooltip: '类型变更 (SVN)' },
        'I': { badge: 'I', color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),    tooltip: '已忽略 (SVN)' },
        'X': { badge: 'X', color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),    tooltip: '外部定义 (SVN)' },
    };

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration | undefined> {
        if (this.statusMap.size === 0) return undefined;

        const rootPath = this.rootPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!rootPath) return undefined;

        const relativePath = path.relative(rootPath, uri.fsPath);
        const normalized = relativePath.replace(/\\/g, '/');
        return this.statusMap.get(normalized);
    }

    /** 用 SVN `svn status` 的结果更新装饰映射 */
    update(fileStatuses: Map<string, string>): void {
        this.statusMap.clear();
        for (const [filePath, statusChar] of fileStatuses) {
            const decoration = StatusDecorationProvider.DECORATIONS[statusChar];
            if (decoration) {
                this.statusMap.set(filePath.replace(/\\/g, '/'), decoration);
            }
        }
        this._onDidChange.fire(undefined);
    }

    /** 清空所有装饰并禁用自动刷新（VCS 切换为 git/none 时调用） */
    clear(): void {
        this.enabled = false;
        this.statusMap.clear();
        this._onDidChange.fire(undefined);
    }

    /**
     * 启用 SVN 装饰并立即收集状态。
     * 之后通过 onFileChanged() 响应文件变更，防抖重新收集。
     */
    enable(rootPath: string, initialStatus: Map<string, string>): void {
        this.enabled = true;
        this.rootPath = rootPath;
        this.update(initialStatus);
    }

    /**
     * 文件变更时调用（由外部 watcher 触发），防抖 2s 后重新运行 svn status。
     */
    onFileChanged(): void {
        if (!this.enabled || !this.rootPath) return;

        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.refreshFromDisk();
        }, 2000);
    }

    /** 重新执行 svn status 并更新装饰 */
    private async refreshFromDisk(): Promise<void> {
        const fileStatuses = await SvnStatusService.getStatus(this.rootPath);
        this.update(fileStatuses);
    }

    dispose(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this._onDidChange.dispose();
        this.statusMap.clear();
    }
}
