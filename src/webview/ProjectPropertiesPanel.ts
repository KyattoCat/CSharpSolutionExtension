import * as vscode from 'vscode';
import * as path from 'path';
import { CsprojProject } from '../models/CsprojModel';
import {
    FieldChange,
    ProjectPropertiesModel,
    PropertiesSnapshot,
    ReferenceChanges,
    SnapshotField,
} from '../services/ProjectPropertiesModel';
import { getHtml } from './html';
import { FIELD_SPECS } from '../models/ProjectPropertySchema';

interface PanelPayload {
    snapshot: PropertiesSnapshot;
    availableProjects: Array<{ path: string; name: string; relPath: string }>;
}

type SnapshotReason = 'init' | 'switch' | 'reload' | 'applied';

/**
 * 「项目属性」Webview 面板。
 *
 * 数据流：csproj 文本 → 快照（JSON）→ webview 表单；用户点「应用」后
 * 变更集回到扩展侧 → 文本层只改目标行 → 以一次 WorkspaceEdit 写回文档
 * （脏标记与撤销交给 VS Code）。
 */
export class ProjectPropertiesPanel {

    private static readonly panels = new Map<string, ProjectPropertiesPanel>();

    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly projectPath: string;
    private readonly document: vscode.TextDocument;
    /** 最近一次发送给 webview 的文档版本，用于检测外部修改 */
    private snapshotVersion: number;
    private applying = false;
    private configuration?: string;
    private platform?: string;

    static async createOrShow(
        context: vscode.ExtensionContext,
        projectPath: string,
        projectsProvider: () => CsprojProject[]
    ): Promise<void> {
        const key = projectPath.toLowerCase();
        const existing = ProjectPropertiesPanel.panels.get(key);
        if (existing) {
            existing.panel.reveal();
            return;
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(projectPath));
        const panel = new ProjectPropertiesPanel(context, document, projectPath, projectsProvider);
        ProjectPropertiesPanel.panels.set(key, panel);
    }

    private constructor(
        context: vscode.ExtensionContext,
        document: vscode.TextDocument,
        projectPath: string,
        private readonly projectsProvider: () => CsprojProject[]
    ) {
        this.document = document;
        this.projectPath = projectPath;
        this.snapshotVersion = document.version;

        const projectName = path.basename(projectPath, '.csproj');
        this.panel = vscode.window.createWebviewPanel(
            'csharpsolution.projectProperties',
            `属性: ${projectName}`,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview-ui')],
            }
        );
        this.panel.webview.html = getHtml(this.panel.webview, context.extensionUri);

        this.panel.webview.onDidReceiveMessage(
            message => void this.handleMessage(message),
            undefined,
            this.disposables
        );

        this.panel.onDidDispose(
            () => {
                ProjectPropertiesPanel.panels.delete(projectPath.toLowerCase());
                this.disposables.forEach(disposable => disposable.dispose());
            },
            undefined,
            this.disposables
        );

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (this.applying || event.document.uri.toString() !== this.document.uri.toString()) {
                    return;
                }
                void this.panel.webview.postMessage({ type: 'externalChange' });
            })
        );
    }

    private async handleMessage(message: {
        type?: string;
        configuration?: string;
        platform?: string;
        fields?: FieldChange[];
        refs?: ReferenceChanges;
        include?: string;
        hintPath?: string;
    }): Promise<void> {
        switch (message.type) {
            case 'ready':
                await this.sendSnapshot('init');
                return;
            case 'switchConfig':
                this.configuration = message.configuration;
                this.platform = message.platform;
                await this.sendSnapshot('switch');
                return;
            case 'reload':
                await this.sendSnapshot('reload');
                return;
            case 'apply':
                await this.apply(message.fields ?? [], message.refs ?? emptyRefChanges());
                return;
            case 'openText':
                await vscode.window.showTextDocument(this.document, { preview: false });
                return;
            case 'browseAssembly':
                await this.browseAssembly();
                return;
            default:
                return;
        }
    }

    private async sendSnapshot(reason: SnapshotReason): Promise<void> {
        const xml = this.document.getText();
        const snapshot = ProjectPropertiesModel.snapshot(xml, {
            projectPath: this.projectPath,
            configuration: this.configuration,
            platform: this.platform,
        });
        this.configuration = snapshot.configuration;
        this.platform = snapshot.platform;

        const payload: PanelPayload = {
            snapshot: this.decorateFields(snapshot),
            availableProjects: this.getAvailableProjects(),
        };
        this.snapshotVersion = this.document.version;
        await this.panel.webview.postMessage({ type: 'snapshot', reason, payload });
    }

    /** 把字段的展示元数据（标签/类型/选项/提示）一并下发，webview 无需硬编码字段表 */
    private decorateFields(snapshot: PropertiesSnapshot): PropertiesSnapshot {
        const fields: SnapshotField[] = snapshot.fields.map(field => {
            const spec = FIELD_SPECS.find(item => item.id === field.id);
            return {
                ...field,
                label: spec?.label ?? field.id,
                type: spec?.type ?? 'text',
                tab: spec?.tab ?? 'application',
                options: spec?.options,
                placeholder: spec?.placeholder,
                hint: spec?.hint,
            };
        });
        return { ...snapshot, fields };
    }

    private getAvailableProjects(): Array<{ path: string; name: string; relPath: string }> {
        const projectDir = path.dirname(this.projectPath);
        return this.projectsProvider()
            .filter(project => project.path.toLowerCase() !== this.projectPath.toLowerCase())
            .map(project => ({
                path: project.path,
                name: project.name,
                relPath: path.relative(projectDir, project.path).replace(/\//g, '\\'),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private async apply(fieldChanges: FieldChange[], refChanges: ReferenceChanges): Promise<void> {
        if (this.document.version !== this.snapshotVersion) {
            const choice = await vscode.window.showWarningMessage(
                '项目文件已被外部修改。重新加载会丢弃面板中的修改。',
                { modal: true },
                '重新加载',
                '仍然覆盖'
            );
            if (choice === '重新加载') {
                await this.sendSnapshot('reload');
                return;
            }
            if (choice !== '仍然覆盖') {
                return;
            }
        }

        const current = this.document.getText();
        const result = ProjectPropertiesModel.apply(current, fieldChanges, refChanges);
        if (result.errors.length > 0) {
            await this.panel.webview.postMessage({ type: 'error', message: result.errors.join('\n') });
            return;
        }

        if (result.xml !== current) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                this.document.positionAt(0),
                this.document.positionAt(current.length)
            );
            edit.replace(this.document.uri, fullRange, result.xml);
            this.applying = true;
            let applied = false;
            try {
                applied = await vscode.workspace.applyEdit(edit);
            } finally {
                this.applying = false;
            }
            if (!applied) {
                await this.panel.webview.postMessage({ type: 'error', message: '写入项目文件失败' });
                return;
            }
            vscode.commands.executeCommand('csharpsolution.refresh');
        }

        await this.sendSnapshot('applied');
        vscode.window.setStatusBarMessage('项目属性已应用，保存文件后生效（Ctrl+S）', 5000);
    }

    private async browseAssembly(): Promise<void> {
        const selected = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: '添加引用',
            filters: { '程序集': ['dll', 'exe'] },
        });
        if (!selected || selected.length === 0) {
            return;
        }
        const filePath = selected[0].fsPath;
        const projectDir = path.dirname(this.projectPath);
        await this.panel.webview.postMessage({
            type: 'assemblyPicked',
            include: path.basename(filePath, path.extname(filePath)),
            hintPath: path.relative(projectDir, filePath).replace(/\//g, '\\'),
        });
    }
}

function emptyRefChanges(): ReferenceChanges {
    return {
        addPackages: [],
        setPackageVersions: [],
        removePackages: [],
        addProjectReferences: [],
        removeProjectReferences: [],
        addAssemblyReferences: [],
        removeAssemblyReferences: [],
        removeAnalyzers: [],
    };
}
