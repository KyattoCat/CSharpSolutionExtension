import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectNode } from '../models/ProjectNode';
import { TortoiseService } from '../services/TortoiseService';

interface VcsCommandDef {
    vcs: 'svn' | 'git';
    cmd: string;
    id: string;
    label: string;
    icon: string;
}

const VCS_COMMANDS: VcsCommandDef[] = [
    // --- SVN ---
    { vcs: 'svn', cmd: 'update',  id: 'svnUpdate',  label: 'Update',   icon: '$(cloud-download)' },
    { vcs: 'svn', cmd: 'commit',  id: 'svnCommit',  label: 'Commit',   icon: '$(check)' },
    { vcs: 'svn', cmd: 'diff',    id: 'svnDiff',    label: 'Diff',     icon: '$(diff)' },
    { vcs: 'svn', cmd: 'log',     id: 'svnLog',     label: 'Log',      icon: '$(history)' },
    { vcs: 'svn', cmd: 'add',     id: 'svnAdd',     label: 'Add',      icon: '$(add)' },
    { vcs: 'svn', cmd: 'revert',  id: 'svnRevert',  label: 'Revert',   icon: '$(discard)' },
    { vcs: 'svn', cmd: 'blame',   id: 'svnBlame',   label: 'Blame',    icon: '$(info)' },
    { vcs: 'svn', cmd: 'cleanup', id: 'svnCleanup', label: 'Clean up', icon: '$(clear-all)' },
    { vcs: 'svn', cmd: 'switch',  id: 'svnSwitch',  label: 'Switch',   icon: '$(arrow-swap)' },
    { vcs: 'svn', cmd: 'resolve', id: 'svnResolve', label: 'Resolve',  icon: '$(pass)' },
    { vcs: 'svn', cmd: 'shelve',  id: 'svnShelve',  label: 'Shelve',   icon: '$(archive)' },
    // --- Git ---
    { vcs: 'git', cmd: 'pull',     id: 'gitPull',     label: 'Pull',     icon: '$(cloud-download)' },
    { vcs: 'git', cmd: 'push',     id: 'gitPush',     label: 'Push',     icon: '$(cloud-upload)' },
    { vcs: 'git', cmd: 'commit',   id: 'gitCommit',   label: 'Commit',   icon: '$(check)' },
    { vcs: 'git', cmd: 'diff',     id: 'gitDiff',     label: 'Diff',     icon: '$(diff)' },
    { vcs: 'git', cmd: 'fetch',    id: 'gitFetch',    label: 'Fetch',    icon: '$(arrow-down)' },
    { vcs: 'git', cmd: 'log',      id: 'gitLog',      label: 'Log',      icon: '$(history)' },
    { vcs: 'git', cmd: 'add',      id: 'gitAdd',      label: 'Add',      icon: '$(add)' },
    { vcs: 'git', cmd: 'revert',   id: 'gitRevert',   label: 'Revert',   icon: '$(discard)' },
    { vcs: 'git', cmd: 'blame',    id: 'gitBlame',    label: 'Blame',    icon: '$(info)' },
    { vcs: 'git', cmd: 'cleanup',  id: 'gitCleanup',  label: 'Clean up', icon: '$(clear-all)' },
    { vcs: 'git', cmd: 'switch',   id: 'gitSwitch',   label: 'Switch',   icon: '$(arrow-swap)' },
    { vcs: 'git', cmd: 'resolve',  id: 'gitResolve',  label: 'Resolve',  icon: '$(pass)' },
    { vcs: 'git', cmd: 'stashsave',id: 'gitStash',    label: 'Stash',    icon: '$(archive)' },
];

/** Resolve absolute filesystem path from a ProjectNode */
function resolveNodePath(node: ProjectNode): string | undefined {
    if (node.type === 'file') {
        return path.resolve(path.dirname(node.projectPath), node.compile.include);
    }
    if (node.type === 'folder') {
        return path.resolve(path.dirname(node.projectPath), node.relPath);
    }
    return undefined;
}

/** Register TortoiseSVN / TortoiseGit right-click context menu commands */
export function registerVcsCommands(context: vscode.ExtensionContext): void {
    for (const def of VCS_COMMANDS) {
        context.subscriptions.push(
            vscode.commands.registerCommand(`csharpsolution.${def.id}`, async (node: ProjectNode) => {
                if (!node || (node.type !== 'file' && node.type !== 'folder')) return;
                const filePath = resolveNodePath(node);
                if (!filePath) return;
                TortoiseService.execute(def.vcs, def.cmd, filePath);
            })
        );
    }
}
