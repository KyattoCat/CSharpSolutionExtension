import * as vscode from 'vscode';
import * as path from 'path';
import { CsprojProject, CompileItem } from '../models/CsprojModel';
import { ProjectNode } from '../models/ProjectNode';

export class ProjectTreeProvider implements vscode.TreeDataProvider<ProjectNode> {

    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private projects: CsprojProject[] = [];

    /** 更新内部数据并刷新视图 */
    refresh(projects?: CsprojProject[]): void {
        if (projects) {
            this.projects = projects;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(node: ProjectNode): vscode.TreeItem {
        switch (node.type) {
            case 'project':
                return this.projectTreeItem(node.project);
            case 'refGroup':
                return this.folderTreeItem('引用', vscode.TreeItemCollapsibleState.Expanded);
            case 'refSubGroup':
                return this.folderTreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
            case 'reference':
                return this.leafTreeItem(
                    `🔧 ${node.item.include}`,
                    node.item.hintPath || '',
                    'reference'
                );
            case 'projectRef':
                return this.leafTreeItem(
                    `🔗 ${node.item.name || path.basename(node.item.include, '.csproj')}`,
                    node.item.include,
                    'reference'
                );
            case 'package':
                return this.leafTreeItem(
                    `📦 ${node.item.id} v${node.item.version}`,
                    node.item.targetFramework || '',
                    'package'
                );
            case 'analyzer':
                return this.leafTreeItem(
                    `⚙ ${path.basename(node.item.include)}`,
                    node.item.include,
                    'reference'
                );
            case 'folder':
                return this.folderTreeItem(
                    path.basename(node.relPath) || node.relPath,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
            case 'file':
                return this.fileTreeItem(node.compile, node.projectPath);
        }
    }

    getChildren(node?: ProjectNode): ProjectNode[] | undefined {
        if (!node) {
            if (this.projects.length === 0) {
                return undefined; // triggers empty state message
            }
            return this.projects.map(p => ({ type: 'project' as const, project: p }));
        }

        switch (node.type) {
            case 'project':
                return this.getProjectChildren(node.project);
            case 'refGroup':
                return this.getRefChildren(node.projectPath);
            case 'refSubGroup':
                return this.getRefSubGroupChildren(node);
            case 'folder':
                return this.getFolderChildren(node);
            default:
                return undefined;
        }
    }

    getParent(): undefined { return undefined; }

    // --- Private helpers ---

    private projectTreeItem(project: CsprojProject): vscode.TreeItem {
        const item = new vscode.TreeItem(
            `📦 ${project.name}`,
            vscode.TreeItemCollapsibleState.Expanded
        );
        item.contextValue = 'project';
        item.tooltip = project.path;
        item.description = this.relativePath(project.path);
        return item;
    }

    private relativePath(absPath: string): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
            const rel = path.relative(root, absPath);
            if (rel !== absPath) {
                return rel;
            }
        }
        return absPath;
    }

    private folderTreeItem(label: string, collapsible: vscode.TreeItemCollapsibleState): vscode.TreeItem {
        const item = new vscode.TreeItem(`📂 ${label}`, collapsible);
        item.contextValue = 'folder';
        return item;
    }

    private leafTreeItem(label: string, tooltip: string, contextValue: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.tooltip = tooltip;
        item.contextValue = contextValue;
        return item;
    }

    private fileTreeItem(compile: CompileItem, projectPath: string): vscode.TreeItem {
        const projectDir = path.dirname(projectPath);
        const absPath = path.join(projectDir, compile.include);
        const item = new vscode.TreeItem(
            `🔷 ${path.basename(compile.include)}`,
            vscode.TreeItemCollapsibleState.None
        );
        item.resourceUri = vscode.Uri.file(absPath);
        item.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(absPath)],
        };
        item.contextValue = 'file';
        item.tooltip = compile.include;
        if (compile.link) {
            item.description = `→ ${compile.link}`;
        }
        return item;
    }

    private getProjectChildren(project: CsprojProject): ProjectNode[] {
        const children: ProjectNode[] = [];

        const hasRefs = project.references.length > 0
            || project.projectReferences.length > 0
            || project.packages.length > 0
            || project.analyzers.length > 0;

        if (hasRefs) {
            children.push({ type: 'refGroup', projectPath: project.path });
        }

        const folderMap = this.buildFolderTree(project.compiles, project.path);
        children.push(...folderMap);

        return children;
    }

    private getRefChildren(projectPath: string): ProjectNode[] {
        const project = this.projects.find(p => p.path === projectPath);
        if (!project) return [];

        const children: ProjectNode[] = [];

        if (project.projectReferences.length > 0) {
            children.push({ type: 'refSubGroup', label: '项目引用', projectPath });
        }
        if (project.references.length > 0) {
            children.push({ type: 'refSubGroup', label: '程序集引用', projectPath });
        }
        if (project.packages.length > 0) {
            children.push({ type: 'refSubGroup', label: 'NuGet 包', projectPath });
        }
        if (project.analyzers.length > 0) {
            children.push({ type: 'refSubGroup', label: '分析器', projectPath });
        }

        return children;
    }

    private getRefSubGroupChildren(node: ProjectNode & { type: 'refSubGroup' }): ProjectNode[] {
        const project = this.projects.find(p => p.path === node.projectPath);
        if (!project) return [];

        switch (node.label) {
            case '项目引用':
                return project.projectReferences.map(item => ({
                    type: 'projectRef' as const, item, projectPath: node.projectPath,
                }));
            case '程序集引用':
                return project.references.map(item => ({
                    type: 'reference' as const, item, projectPath: node.projectPath,
                }));
            case 'NuGet 包':
                return project.packages.map(item => ({
                    type: 'package' as const, item, projectPath: node.projectPath,
                }));
            case '分析器':
                return project.analyzers.map(item => ({
                    type: 'analyzer' as const, item, projectPath: node.projectPath,
                }));
            default:
                return [];
        }
    }

    /** 从 Compile 数组构建目录树节点 */
    private buildFolderTree(compiles: CompileItem[], projectPath: string): ProjectNode[] {
        const folderMap = new Map<string, CompileItem[]>();
        const rootFiles: CompileItem[] = [];

        for (const compile of compiles) {
            const dir = path.dirname(compile.include);
            if (dir === '.' || dir === '') {
                rootFiles.push(compile);
            } else {
                const normalized = dir.replace(/\\/g, '/');
                if (!folderMap.has(normalized)) {
                    folderMap.set(normalized, []);
                }
                folderMap.get(normalized)!.push(compile);
            }
        }

        const result: ProjectNode[] = [];

        for (const compile of rootFiles) {
            result.push({ type: 'file', compile, projectPath });
        }

        // Only add top-level folders; deeper nesting handled in getFolderChildren
        const topFolders = new Set<string>();
        for (const folderRelPath of folderMap.keys()) {
            const firstSegment = folderRelPath.split('/')[0];
            topFolders.add(firstSegment);
        }

        for (const topFolder of topFolders) {
            result.push({ type: 'folder', relPath: topFolder, projectPath });
        }

        return result;
    }

    private getFolderChildren(node: ProjectNode & { type: 'folder' }): ProjectNode[] {
        const project = this.projects.find(p => p.path === node.projectPath);
        if (!project) return [];

        const normalizedFolder = node.relPath.replace(/\\/g, '/');
        const prefix = normalizedFolder + '/';

        const directFiles: CompileItem[] = [];
        const subFolders = new Set<string>();

        for (const compile of project.compiles) {
            const dir = path.dirname(compile.include).replace(/\\/g, '/');

            // Direct child of this folder
            if (dir === normalizedFolder) {
                directFiles.push(compile);
            }
            // Deeper nested file — find immediate subfolder
            else if (dir.startsWith(prefix)) {
                const remaining = dir.slice(prefix.length);
                const nextSegment = remaining.split('/')[0];
                if (nextSegment && nextSegment !== normalizedFolder) {
                    subFolders.add(normalizedFolder + '/' + nextSegment);
                }
            }
        }

        const result: ProjectNode[] = [];

        for (const subFolder of subFolders) {
            result.push({ type: 'folder', relPath: subFolder, projectPath: node.projectPath });
        }

        for (const compile of directFiles) {
            result.push({ type: 'file', compile, projectPath: node.projectPath });
        }

        return result;
    }
}
