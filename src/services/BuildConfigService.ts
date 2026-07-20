import * as vscode from 'vscode';

export class BuildConfigService {
    private static readonly STATE_KEY = 'buildConfiguration';
    private static readonly DEFAULT_CONFIG = 'Release';

    private _configuration: 'Debug' | 'Release';
    private _onDidChangeConfiguration = new vscode.EventEmitter<'Debug' | 'Release'>();
    readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;
    private statusBarItem?: vscode.StatusBarItem;

    constructor(private context: vscode.ExtensionContext) {
        const stored = context.workspaceState.get<string>(BuildConfigService.STATE_KEY);
        this._configuration = (stored === 'Debug' || stored === 'Release') ? stored : BuildConfigService.DEFAULT_CONFIG;
    }

    get configuration(): 'Debug' | 'Release' {
        return this._configuration;
    }

    createStatusBarItem(): vscode.StatusBarItem {
        if (this.statusBarItem) return this.statusBarItem;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'csharpsolution.toggleBuildConfiguration';
        this.updateStatusBar();
        this.statusBarItem.show();
        return this.statusBarItem;
    }

    toggle(): void {
        this._configuration = this._configuration === 'Release' ? 'Debug' : 'Release';
        this.context.workspaceState.update(BuildConfigService.STATE_KEY, this._configuration);
        this.updateStatusBar();
        this._onDidChangeConfiguration.fire(this._configuration);
    }

    private updateStatusBar(): void {
        if (!this.statusBarItem) return;
        if (this._configuration === 'Debug') {
            this.statusBarItem.text = '$(debug-alt) Debug';
        } else {
            this.statusBarItem.text = '$(gear) Release';
        }
        this.statusBarItem.tooltip = 'C# Build Configuration - Click to toggle';
    }

    dispose(): void {
        this.statusBarItem?.dispose();
        this.statusBarItem = undefined;
        this._onDidChangeConfiguration.dispose();
    }
}
