import * as vscode from 'vscode';

export interface ProjectFileMap {
    path: string;      // csproj absolute path
    files: string[];   // all .cs file absolute paths in the project
}

export class DiagnosticMonitor {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private counts = new Map<string, { errors: number; warnings: number }>();
    private disposables: vscode.Disposable[] = [];
    private debounceTimer?: ReturnType<typeof setTimeout>;

    constructor() {
        this.disposables.push(
            vscode.languages.onDidChangeDiagnostics(() => {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = setTimeout(() => {
                    this._onDidChange.fire();
                }, 500);
            })
        );
    }

    refresh(projects: ProjectFileMap[]): void {
        this.counts.clear();

        const allDiags = vscode.languages.getDiagnostics();
        const diagMap = new Map<string, vscode.Diagnostic[]>();
        for (const [uri, diags] of allDiags) {
            if (uri.scheme === 'file' && uri.fsPath.endsWith('.cs')) {
                diagMap.set(uri.toString(), diags);
            }
        }

        for (const project of projects) {
            let errors = 0, warnings = 0;
            for (const filePath of project.files) {
                const diags = diagMap.get(vscode.Uri.file(filePath).toString()) ?? [];
                for (const d of diags) {
                    if (d.severity === vscode.DiagnosticSeverity.Error) {
                        errors++;
                    } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
                        warnings++;
                    }
                }
            }
            if (errors > 0 || warnings > 0) {
                this.counts.set(project.path, { errors, warnings });
            }
        }
    }

    getCounts(projectPath: string): { errors: number; warnings: number } | undefined {
        return this.counts.get(projectPath);
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.disposables.forEach(d => d.dispose());
    }
}
