import * as vscode from 'vscode';
import * as path from 'path';
import { CsprojProject, CompileItem, Solution } from '../models/CsprojModel';
import { ProjectNode } from '../models/ProjectNode';
import { ProjectDiscovery } from '../services/ProjectDiscovery';

export class ProjectTreeProvider implements vscode.TreeDataProvider<ProjectNode> {

    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private solutions: Solution[] = [];
    private standaloneProjects: CsprojProject[] = [];
    private allProjects: CsprojProject[] = [];
    private gitStatusMap: Map<string, string> = new Map();
    refresh(data?: { solutions: Solution[]; standaloneProjects: CsprojProject[]; allProjects: CsprojProject[]; gitStatusMap?: Map<string, string> }): void {
        if (data) {
            this.solutions = data.solutions;
            this.standaloneProjects = data.standaloneProjects;
            this.allProjects = data.allProjects;
            if (data.gitStatusMap) {
                this.gitStatusMap = data.gitStatusMap;
            }
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(node: ProjectNode): vscode.TreeItem {
        let item: vscode.TreeItem;
        switch (node.type) {
            case 'project':
                item = this.projectTreeItem(node.project, !!node.solutionPath);
                break;
            case 'solution':
                item = this.solutionTreeItem(node.solution);
                break;
            case 'refGroup':
                item = this.folderTreeItem('引用', vscode.TreeItemCollapsibleState.Expanded);
                item.id = `refGroup:${node.projectPath}`;
                break;
            case 'refSubGroup':
                item = this.folderTreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
                item.id = `refSub:${node.projectPath}:${node.label}`;
                break;
            case 'reference':
                item = this.leafTreeItem(node.item.include, node.item.hintPath || '', 'reference');
                item.id = `ref:${node.projectPath}:${node.item.include}`;
                break;
            case 'projectRef':
                item = this.leafTreeItem(node.item.name || path.basename(node.item.include, '.csproj'), node.item.include, 'reference');
                item.id = `projRef:${node.projectPath}:${node.item.include}`;
                break;
            case 'package':
                item = this.leafTreeItem(`${node.item.id} v${node.item.version}`, node.item.targetFramework || '', 'package');
                item.id = `pkg:${node.projectPath}:${node.item.id}`;
                break;
            case 'analyzer':
                item = this.leafTreeItem(path.basename(node.item.include), node.item.include, 'reference');
                item.id = `analyzer:${node.projectPath}:${node.item.include}`;
                break;
            case 'folder': {
                item = this.folderTreeItem(path.basename(node.relPath) || node.relPath, vscode.TreeItemCollapsibleState.Collapsed);
                item.contextValue = 'dirFolder';
                item.id = `dir:${node.projectPath}:${node.relPath}`;
                break;
            }
            case 'file':
                item = this.fileTreeItem(node.compile, node.projectPath);
                break;
            default:
                item = new vscode.TreeItem('unknown', vscode.TreeItemCollapsibleState.None);
                break;
        }
        return item;
    }

    getChildren(node?: ProjectNode): ProjectNode[] | undefined {
        if (!node) {
            const children: ProjectNode[] = [];
            for (const s of this.solutions.sort((a, b) => a.name.localeCompare(b.name))) {
                children.push({ type: 'solution' as const, solution: s });
            }
            for (const p of this.standaloneProjects.sort((a, b) => a.name.localeCompare(b.name))) {
                children.push({ type: 'project' as const, project: p });
            }
            if (children.length === 0) return undefined;
            return children;
        }
        switch (node.type) {
            case 'solution':
                return this.getSolutionChildren(node.solution);
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

    getParent(node: ProjectNode): ProjectNode | undefined {
        switch (node.type) {
            case 'project':
                if (node.solutionPath) {
                    const solution = this.solutions.find(s => s.path === node.solutionPath);
                    if (solution) return { type: 'solution', solution };
                }
                return undefined;
            case 'solution':
                return undefined;
            case 'file': {
                const project = this.allProjects.find(p => p.path === node.projectPath);
                if (!project) return undefined;
                const dir = path.dirname(node.compile.include).replace(/\\/g, '/');
                if (dir && dir !== '.') {
                    return { type: 'folder', relPath: dir, projectPath: node.projectPath };
                }
                return { type: 'project', project, solutionPath: undefined };
            }
            case 'folder': {
                const parentDir = path.dirname(node.relPath).replace(/\\/g, '/');
                if (parentDir && parentDir !== '.') {
                    return { type: 'folder', relPath: parentDir, projectPath: node.projectPath };
                }
                const project = this.allProjects.find(p => p.path === node.projectPath);
                if (project) return { type: 'project', project, solutionPath: undefined };
                return undefined;
            }
            case 'refGroup': {
                const project = this.allProjects.find(p => p.path === node.projectPath);
                if (project) return { type: 'project', project, solutionPath: undefined };
                return undefined;
            }
            case 'refSubGroup':
                return { type: 'refGroup', projectPath: node.projectPath };
            case 'reference':
            case 'projectRef':
            case 'package':
            case 'analyzer': {
                const project = this.allProjects.find(p => p.path === node.projectPath);
                if (!project) return undefined;
                let label: string;
                switch (node.type) {
                    case 'reference': label = '程序集引用'; break;
                    case 'projectRef': label = '项目引用'; break;
                    case 'package': label = 'NuGet 包'; break;
                    case 'analyzer': label = '分析器'; break;
                }
                return { type: 'refSubGroup', label, projectPath: node.projectPath };
            }
            default:
                return undefined;
        }
    }

    /** 根据 URI 查找对应的文件节点（供 reveal 使用）—— 遍历 allProjects 创建新节点 */
    findNodeByUri(uri: vscode.Uri): ProjectNode | undefined {
        const fsPath = uri.fsPath;
        for (const project of this.allProjects) {
            const projectDir = path.dirname(project.path);
            for (const compile of project.compiles) {
                if (path.join(projectDir, compile.include) === fsPath) {
                    return { type: 'file', compile, projectPath: project.path };
                }
            }
        }
        return undefined;
    }

    // --- Private helpers ---

    private solutionTreeItem(solution: Solution): vscode.TreeItem {
        const item = new vscode.TreeItem(
            solution.name,
            vscode.TreeItemCollapsibleState.Expanded
        );
        item.id = `sln:${solution.path}`;
        item.contextValue = 'solution';
        item.tooltip = solution.path;
        item.description = `${solution.projects.length} 个项目`;
        return item;
    }

    private getSolutionChildren(solution: Solution): ProjectNode[] {
        const projects = ProjectDiscovery.findProjectsForSolution(solution, this.allProjects);
        projects.sort((a, b) => a.name.localeCompare(b.name));
        return projects.map(p => ({ type: 'project' as const, project: p, solutionPath: solution.path }));
    }

    private projectTreeItem(project: CsprojProject, isSolutionChild?: boolean): vscode.TreeItem {
        const item = new vscode.TreeItem(
            project.name,
            vscode.TreeItemCollapsibleState.Expanded
        );
        item.id = `proj:${project.path}`;
        item.contextValue = isSolutionChild ? 'solutionProject' : 'project';
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
        const item = new vscode.TreeItem(label, collapsible);
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
            path.basename(compile.include),
            vscode.TreeItemCollapsibleState.None
        );
        item.resourceUri = vscode.Uri.file(absPath);
        item.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(absPath)],
        };
        item.id = `file:${absPath}`;
        item.contextValue = 'file';
        item.tooltip = compile.include;

        const parts: string[] = [];
        if (compile.link) {
            parts.push(`→ ${compile.link}`);
        }
        const gitStatus = this.gitStatusMap.get(compile.include);
        if (gitStatus) {
            parts.push(gitStatus);
        }
        if (parts.length > 0) {
            item.description = parts.join('  ');
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
        // Sort: folders first (by name), then files (by name)
        folderMap.sort((a, b) => {
            if (a.type === 'folder' && b.type === 'file') return -1;
            if (a.type === 'file' && b.type === 'folder') return 1;
            if (a.type === 'folder' && b.type === 'folder') return a.relPath.localeCompare(b.relPath);
            if (a.type === 'file' && b.type === 'file') return a.compile.include.localeCompare(b.compile.include);
            return 0;
        });
        children.push(...folderMap);

        return children;
    }

    private getRefChildren(projectPath: string): ProjectNode[] {
        const project = this.allProjects.find(p => p.path === projectPath);
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
        const project = this.allProjects.find(p => p.path === node.projectPath);
        if (!project) return [];

        switch (node.label) {
            case '项目引用':
                return project.projectReferences
                    .sort((a, b) => a.include.localeCompare(b.include))
                    .map(item => ({ type: 'projectRef' as const, item, projectPath: node.projectPath }));
            case '程序集引用':
                return project.references
                    .sort((a, b) => a.include.localeCompare(b.include))
                    .map(item => ({ type: 'reference' as const, item, projectPath: node.projectPath }));
            case 'NuGet 包':
                return project.packages
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map(item => ({ type: 'package' as const, item, projectPath: node.projectPath }));
            case '分析器':
                return project.analyzers
                    .sort((a, b) => a.include.localeCompare(b.include))
                    .map(item => ({ type: 'analyzer' as const, item, projectPath: node.projectPath }));
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
        const project = this.allProjects.find(p => p.path === node.projectPath);
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

        const sortedSubFolders = [...subFolders].sort((a, b) => a.localeCompare(b));
        for (const subFolder of sortedSubFolders) {
            result.push({ type: 'folder', relPath: subFolder, projectPath: node.projectPath });
        }

        directFiles.sort((a, b) => a.include.localeCompare(b.include));
        for (const compile of directFiles) {
            result.push({ type: 'file', compile, projectPath: node.projectPath });
        }

        return result;
    }
}
