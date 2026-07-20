// src/services/TortoiseService.ts
import * as cp from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';

/** TortoiseSVN / TortoiseGit TortoiseProc.exe path detection and command execution */
export class TortoiseService {
    private static procCache = new Map<'svn' | 'git', string | undefined>();

    /** Detect TortoiseProc.exe path (with cache) */
    static detectProc(vcs: 'svn' | 'git'): string | undefined {
        if (this.procCache.has(vcs)) return this.procCache.get(vcs);

        const configKey = vcs === 'svn' ? 'tortoiseSvnPath' : 'tortoiseGitPath';
        const config = vscode.workspace.getConfiguration('csharpsolution');
        const configuredPath = config.get<string>(configKey, '');

        // 1. Configuration takes priority
        if (configuredPath && fs.existsSync(configuredPath)) {
            this.procCache.set(vcs, configuredPath);
            return configuredPath;
        }

        // 2. Common installation paths
        const commonPaths = vcs === 'svn'
            ? [
                'C:\\Program Files\\TortoiseSVN\\bin\\TortoiseProc.exe',
                'C:\\Program Files (x86)\\TortoiseSVN\\bin\\TortoiseProc.exe',
            ]
            : [
                'C:\\Program Files\\TortoiseGit\\bin\\TortoiseGitProc.exe',
                'C:\\Program Files (x86)\\TortoiseGit\\bin\\TortoiseGitProc.exe',
            ];

        for (const p of commonPaths) {
            if (fs.existsSync(p)) {
                this.procCache.set(vcs, p);
                return p;
            }
        }

        // 3. Registry detection
        const regKey = vcs === 'svn'
            ? 'HKLM\\Software\\TortoiseSVN'
            : 'HKLM\\Software\\TortoiseGit';
        try {
            const result = cp.spawnSync('reg', ['query', regKey, '/v', 'ProcPath'], {
                encoding: 'utf-8',
                timeout: 3000,
            });
            if (result.status === 0 && result.stdout) {
                const match = result.stdout.match(/REG_SZ\s+(.+)/);
                if (match) {
                    const dir = match[1].trim();
                    const exeName = vcs === 'svn' ? 'TortoiseProc.exe' : 'TortoiseGitProc.exe';
                    const fullPath = dir + '\\' + exeName;
                    if (fs.existsSync(fullPath)) {
                        this.procCache.set(vcs, fullPath);
                        return fullPath;
                    }
                }
            }
        } catch {
            // Non-Windows or reg not available
        }

        this.procCache.set(vcs, undefined);
        return undefined;
    }

    /** Launch TortoiseProc GUI to execute specified command (non-blocking) */
    static execute(vcs: 'svn' | 'git', command: string, filePath: string): void {
        const proc = this.detectProc(vcs);
        if (!proc) {
            const name = vcs === 'svn' ? 'TortoiseSVN' : 'TortoiseGit';
            const configKey = vcs === 'svn' ? 'tortoiseSvnPath' : 'tortoiseGitPath';
            vscode.window.showWarningMessage(
                `TortoiseProc.exe not found for ${name}. Please install ${name} or configure csharpsolution.${configKey} in settings.`
            );
            return;
        }

        try {
            const p = cp.spawn(proc, [`/command:${command}`, `/path:${filePath}`], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            p.unref();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Failed to launch TortoiseProc: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }
}
