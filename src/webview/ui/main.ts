/**
 * 项目属性 Webview 前端脚本。
 *
 * 该文件被单独编译（tsconfig.webview.json，module: none），
 * 不使用任何 import，因此可以作为普通脚本注入 webview。
 */

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

type FieldType = 'text' | 'bool' | 'select' | 'multiline';
type FieldScope = 'project' | 'configuration';
type TabId = 'application' | 'build' | 'package' | 'references';

interface FieldPayload {
    id: string;
    label: string;
    type: FieldType;
    tab: 'application' | 'build' | 'package';
    value: string;
    present: boolean;
    conditional: boolean;
    scope: FieldScope;
    options?: string[];
    placeholder?: string;
    hint?: string;
}

interface Snapshot {
    projectPath: string;
    projectName: string;
    projectFileName: string;
    isSdk: boolean;
    configuration: string;
    platform: string;
    configurations: string[];
    platforms: string[];
    fields: FieldPayload[];
    packages: Array<{ id: string; version: string }>;
    projectReferences: Array<{ include: string; name?: string }>;
    assemblyReferences: Array<{ include: string; hintPath?: string }>;
    analyzers: Array<{ include: string }>;
    untouchedCount: number;
}

interface Payload {
    snapshot: Snapshot;
    availableProjects: Array<{ path: string; name: string; relPath: string }>;
}

interface Draft {
    id: string;
    scope: FieldScope;
    configuration?: string;
    platform?: string;
    value: string;
}

interface Pending {
    packagesAdd: Array<{ id: string; version: string }>;
    packagesRemove: string[];
    packagesVersion: Record<string, string>;
    projectsAdd: string[];
    projectsRemove: string[];
    assembliesAdd: Array<{ include: string; hintPath?: string }>;
    assembliesRemove: string[];
    analyzersRemove: string[];
}

const vscode = acquireVsCodeApi();

const state = {
    payload: null as Payload | null,
    tab: 'application' as TabId,
    drafts: new Map<string, Draft>(),
    pending: emptyPending(),
    busy: false,
};

const TAB_LABELS: Record<TabId, string> = {
    application: '应用程序',
    build: '生成',
    package: '包',
    references: '引用',
};

function emptyPending(): Pending {
    return {
        packagesAdd: [],
        packagesRemove: [],
        packagesVersion: {},
        projectsAdd: [],
        projectsRemove: [],
        assembliesAdd: [],
        assembliesRemove: [],
        analyzersRemove: [],
    };
}

function $(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
}

function post(message: unknown): void {
    vscode.postMessage(message);
}

/* ------------------------------------------------------------------ */
/* 草稿（未应用的字段修改）                                             */
/* ------------------------------------------------------------------ */

function draftKey(field: FieldPayload, snapshot: Snapshot): string {
    return field.scope === 'project'
        ? `project|||${field.id}`
        : `configuration|${snapshot.configuration}|${snapshot.platform}|${field.id}`;
}

function fieldValue(field: FieldPayload, snapshot: Snapshot): string {
    const draft = state.drafts.get(draftKey(field, snapshot));
    return draft ? draft.value : field.value;
}

function setFieldValue(field: FieldPayload, snapshot: Snapshot, value: string): void {
    const key = draftKey(field, snapshot);
    const original = field.value;
    if (value === original) {
        state.drafts.delete(key);
        return;
    }
    state.drafts.set(key, {
        id: field.id,
        scope: field.scope,
        configuration: field.scope === 'configuration' ? snapshot.configuration : undefined,
        platform: field.scope === 'configuration' ? snapshot.platform : undefined,
        value,
    });
}

function changeCount(): number {
    const pending = state.pending;
    return state.drafts.size
        + pending.packagesAdd.length
        + pending.packagesRemove.length
        + Object.keys(pending.packagesVersion).length
        + pending.projectsAdd.length
        + pending.projectsRemove.length
        + pending.assembliesAdd.length
        + pending.assembliesRemove.length
        + pending.analyzersRemove.length;
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function renderAll(): void {
    const payload = state.payload;
    if (!payload) {
        return;
    }
    const snapshot = payload.snapshot;
    $('projectName').textContent = snapshot.projectName;
    $('projectFile').textContent = snapshot.projectFileName + (snapshot.isSdk ? '  ·  SDK 项目' : '  ·  传统项目');
    renderConfigSelects(snapshot);
    renderTabs(snapshot);
    renderContent();
    renderStatus(snapshot);
}

function renderConfigSelects(snapshot: Snapshot): void {
    const configSelect = $('configuration') as HTMLSelectElement;
    const platformSelect = $('platform') as HTMLSelectElement;
    fillSelect(configSelect, snapshot.configurations, snapshot.configuration);
    fillSelect(platformSelect, snapshot.platforms, snapshot.platform);
}

function fillSelect(select: HTMLSelectElement, values: string[], current: string): void {
    select.textContent = '';
    for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        if (value === current) {
            option.selected = true;
        }
        select.appendChild(option);
    }
    select.disabled = state.busy;
}

function renderTabs(snapshot: Snapshot): void {
    const tabs = $('tabs');
    tabs.textContent = '';
    const available: TabId[] = ['application', 'build'];
    if (snapshot.fields.some(field => field.tab === 'package')) {
        available.push('package');
    }
    available.push('references');
    if (!available.includes(state.tab)) {
        state.tab = 'application';
    }
    for (const tab of available) {
        const button = document.createElement('button');
        button.textContent = TAB_LABELS[tab];
        button.className = tab === state.tab ? 'active' : '';
        button.addEventListener('click', () => {
            state.tab = tab;
            renderTabs(snapshot);
            renderContent();
        });
        tabs.appendChild(button);
    }
}

function renderContent(): void {
    const payload = state.payload;
    if (!payload) {
        return;
    }
    const content = $('content');
    content.textContent = '';
    if (state.tab === 'references') {
        renderReferences(content, payload);
    } else {
        renderFields(content, payload.snapshot, state.tab);
    }
}

function renderFields(container: HTMLElement, snapshot: Snapshot, tab: 'application' | 'build' | 'package'): void {
    const fields = snapshot.fields.filter(field => field.tab === tab);
    if (fields.length === 0) {
        container.appendChild(placeholder('该页没有可配置项'));
        return;
    }
    if (tab === 'build') {
        const notice = document.createElement('div');
        notice.className = 'hint mb-12';
        notice.textContent = `已按配置定义的属性写入当前配置（${snapshot.configuration}|${snapshot.platform}）的条件组；其余写入项目级属性。`;
        container.appendChild(notice);
    }
    if (tab === 'package') {
        const notice = document.createElement('div');
        notice.className = 'hint mb-12';
        notice.textContent = '这些属性只在 dotnet pack 时生效。';
        container.appendChild(notice);
    }

    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const field of fields) {
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = field.label;
        if (field.scope === 'configuration') {
            label.title = '按配置保存（Debug/Release 可分别设置）';
        }
        grid.appendChild(label);

        const control = document.createElement('div');
        control.className = 'control';
        const value = fieldValue(field, snapshot);

        if (field.type === 'bool') {
            const row = document.createElement('div');
            row.className = 'row-check';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.setAttribute('data-field', field.id);
            checkbox.checked = value === 'true';
            checkbox.addEventListener('change', () => {
                setFieldValue(field, snapshot, checkbox.checked ? 'true' : '');
                renderStatus(snapshot);
            });
            const text = document.createElement('span');
            text.textContent = checkbox.checked ? '启用' : '禁用';
            checkbox.addEventListener('change', () => {
                text.textContent = checkbox.checked ? '启用' : '禁用';
            });
            row.appendChild(checkbox);
            row.appendChild(text);
            control.appendChild(row);
        } else if (field.type === 'select') {
            const select = document.createElement('select');
            select.setAttribute('data-field', field.id);
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '（默认）';
            select.appendChild(emptyOption);
            for (const option of field.options ?? []) {
                const element = document.createElement('option');
                element.value = option;
                element.textContent = option;
                if (option === value) {
                    element.selected = true;
                }
                select.appendChild(element);
            }
            if (!field.options?.includes(value) && value) {
                const custom = document.createElement('option');
                custom.value = value;
                custom.textContent = value;
                custom.selected = true;
                select.appendChild(custom);
            }
            select.addEventListener('change', () => {
                setFieldValue(field, snapshot, select.value);
                renderStatus(snapshot);
            });
            control.appendChild(select);
        } else if (field.type === 'multiline') {
            const textarea = document.createElement('textarea');
            textarea.rows = 2;
            textarea.setAttribute('data-field', field.id);
            textarea.value = value;
            textarea.placeholder = field.placeholder ?? '';
            textarea.addEventListener('input', () => {
                setFieldValue(field, snapshot, textarea.value);
                renderStatus(snapshot);
            });
            control.appendChild(textarea);
        } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.setAttribute('data-field', field.id);
            input.value = value;
            input.placeholder = field.placeholder ?? '';
            input.addEventListener('input', () => {
                setFieldValue(field, snapshot, input.value);
                renderStatus(snapshot);
            });
            control.appendChild(input);
        }

        if (field.hint) {
            const hint = document.createElement('div');
            hint.className = 'hint';
            hint.textContent = field.hint;
            control.appendChild(hint);
        }
        if (field.conditional && field.scope === 'project') {
            const hint = document.createElement('div');
            hint.className = 'hint';
            hint.textContent = '该值来自条件组，不随配置变化';
            control.appendChild(hint);
        }
        grid.appendChild(control);
    }
    container.appendChild(grid);
}

function renderReferences(container: HTMLElement, payload: Payload): void {
    const snapshot = payload.snapshot;
    const pending = state.pending;

    if (!snapshot.isSdk) {
        const notice = document.createElement('div');
        notice.className = 'hint mb-12';
        notice.textContent = '传统项目使用 packages.config 管理 NuGet 包，此处仅展示 PackageReference。';
        container.appendChild(notice);
    }

    // --- NuGet 包 ---
    container.appendChild(section('NuGet 包', `${snapshot.packages.length} 项`));
    const packageTable = table(['包 ID', '版本', '']);
    for (const pkg of snapshot.packages) {
        if (pending.packagesRemove.includes(pkg.id)) {
            continue;
        }
        const row = document.createElement('tr');
        row.appendChild(cell(pkg.id));
        const versionCell = document.createElement('td');
        const versionInput = document.createElement('input');
        versionInput.type = 'text';
        versionInput.value = pending.packagesVersion[pkg.id] ?? pkg.version;
        versionInput.addEventListener('input', () => {
            const value = versionInput.value;
            if (value === pkg.version) {
                delete pending.packagesVersion[pkg.id];
            } else {
                pending.packagesVersion[pkg.id] = value;
            }
            renderStatus(snapshot);
        });
        versionCell.appendChild(versionInput);
        row.appendChild(versionCell);
        row.appendChild(actionCell('移除', () => {
            pending.packagesRemove.push(pkg.id);
            delete pending.packagesVersion[pkg.id];
            renderContent();
            renderStatus(snapshot);
        }));
        packageTable.body.appendChild(row);
    }
    for (const pkg of pending.packagesAdd) {
        const row = document.createElement('tr');
        row.className = 'pending';
        row.appendChild(cell(pkg.id));
        row.appendChild(cell(pkg.version || '（最新）'));
        row.appendChild(actionCell('撤销', () => {
            pending.packagesAdd = pending.packagesAdd.filter(item => item.id !== pkg.id);
            renderContent();
            renderStatus(snapshot);
        }));
        packageTable.body.appendChild(row);
    }
    container.appendChild(packageTable.table);
    container.appendChild(addPackageRow());

    // --- 项目引用 ---
    container.appendChild(section('项目引用', `${snapshot.projectReferences.length} 项`));
    const projectTable = table(['路径', '名称', '']);
    for (const reference of snapshot.projectReferences) {
        if (pending.projectsRemove.includes(reference.include)) {
            continue;
        }
        const row = document.createElement('tr');
        row.appendChild(cell(reference.include));
        row.appendChild(cell(reference.name ?? ''));
        row.appendChild(actionCell('移除', () => {
            pending.projectsRemove.push(reference.include);
            renderContent();
            renderStatus(snapshot);
        }));
        projectTable.body.appendChild(row);
    }
    for (const include of pending.projectsAdd) {
        const row = document.createElement('tr');
        row.className = 'pending';
        row.appendChild(cell(include));
        row.appendChild(cell(''));
        row.appendChild(actionCell('撤销', () => {
            pending.projectsAdd = pending.projectsAdd.filter(item => item !== include);
            renderContent();
            renderStatus(snapshot);
        }));
        projectTable.body.appendChild(row);
    }
    container.appendChild(projectTable.table);
    container.appendChild(addProjectRow(payload));

    // --- 程序集引用 ---
    container.appendChild(section('程序集引用', `${snapshot.assemblyReferences.length} 项`));
    const assemblyTable = table(['名称', 'HintPath', '']);
    for (const reference of snapshot.assemblyReferences) {
        if (pending.assembliesRemove.includes(reference.include)) {
            continue;
        }
        const row = document.createElement('tr');
        row.appendChild(cell(reference.include));
        row.appendChild(cell(reference.hintPath ?? ''));
        row.appendChild(actionCell('移除', () => {
            pending.assembliesRemove.push(reference.include);
            renderContent();
            renderStatus(snapshot);
        }));
        assemblyTable.body.appendChild(row);
    }
    for (const reference of pending.assembliesAdd) {
        const row = document.createElement('tr');
        row.className = 'pending';
        row.appendChild(cell(reference.include));
        row.appendChild(cell(reference.hintPath ?? ''));
        row.appendChild(actionCell('撤销', () => {
            pending.assembliesAdd = pending.assembliesAdd.filter(item => item.include !== reference.include);
            renderContent();
            renderStatus(snapshot);
        }));
        assemblyTable.body.appendChild(row);
    }
    container.appendChild(assemblyTable.table);
    const assemblyAdd = document.createElement('div');
    assemblyAdd.className = 'add-row';
    const browse = document.createElement('button');
    browse.id = 'browseAssemblyBtn';
    browse.textContent = '浏览程序集…';
    browse.addEventListener('click', () => post({ type: 'browseAssembly' }));
    assemblyAdd.appendChild(browse);
    container.appendChild(assemblyAdd);

    // --- 分析器 ---
    container.appendChild(section('分析器', `${snapshot.analyzers.length} 项`));
    const analyzerTable = table(['路径', '']);
    for (const analyzer of snapshot.analyzers) {
        if (pending.analyzersRemove.includes(analyzer.include)) {
            continue;
        }
        const row = document.createElement('tr');
        row.appendChild(cell(analyzer.include));
        row.appendChild(actionCell('移除', () => {
            pending.analyzersRemove.push(analyzer.include);
            renderContent();
            renderStatus(snapshot);
        }));
        analyzerTable.body.appendChild(row);
    }
    if (snapshot.analyzers.length === 0) {
        const row = document.createElement('tr');
        const td = cell('（无）');
        td.colSpan = 2;
        td.className = 'dim';
        row.appendChild(td);
        analyzerTable.body.appendChild(row);
    }
    container.appendChild(analyzerTable.table);
}

function addPackageRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'add-row';
    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.id = 'newPackageId';
    idInput.placeholder = '包 ID，如 Newtonsoft.Json';
    const versionInput = document.createElement('input');
    versionInput.type = 'text';
    versionInput.id = 'newPackageVersion';
    versionInput.placeholder = '版本，如 13.0.3';
    const button = document.createElement('button');
    button.id = 'addPackageBtn';
    button.textContent = '添加包';
    button.addEventListener('click', () => {
        const id = idInput.value.trim();
        if (!id) {
            return;
        }
        state.pending.packagesAdd.push({ id, version: versionInput.value.trim() });
        idInput.value = '';
        versionInput.value = '';
        renderContent();
        if (state.payload) {
            renderStatus(state.payload.snapshot);
        }
    });
    row.appendChild(idInput);
    row.appendChild(versionInput);
    row.appendChild(button);
    return row;
}

function addProjectRow(payload: Payload): HTMLElement {
    const row = document.createElement('div');
    row.className = 'add-row';
    const referenced = new Set(
        payload.snapshot.projectReferences.map(reference => reference.include.toLowerCase())
    );
    for (const include of state.pending.projectsAdd) {
        referenced.add(include.toLowerCase());
    }
    const candidates = payload.availableProjects.filter(
        project => !referenced.has(project.relPath.toLowerCase())
    );
    if (candidates.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = '工作区中没有可添加的项目引用';
        row.appendChild(hint);
        return row;
    }
    const select = document.createElement('select');
    for (const candidate of candidates) {
        const option = document.createElement('option');
        option.value = candidate.relPath;
        option.textContent = `${candidate.name}  (${candidate.relPath})`;
        select.appendChild(option);
    }
    const button = document.createElement('button');
    button.id = 'addProjectBtn';
    button.textContent = '添加项目引用';
    button.addEventListener('click', () => {
        if (!select.value) {
            return;
        }
        state.pending.projectsAdd.push(select.value);
        renderContent();
        if (state.payload) {
            renderStatus(state.payload.snapshot);
        }
    });
    row.appendChild(select);
    row.appendChild(button);
    return row;
}

function section(title: string, badge: string): HTMLElement {
    const header = document.createElement('h2');
    header.className = 'section-title';
    header.textContent = title;
    const span = document.createElement('span');
    span.className = 'badge';
    span.textContent = badge;
    header.classList.add('mt-24');
    header.appendChild(span);
    return header;
}

function table(headers: string[]): { table: HTMLTableElement; body: HTMLTableSectionElement } {
    const element = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const header of headers) {
        const th = document.createElement('th');
        th.textContent = header;
        headRow.appendChild(th);
    }
    head.appendChild(headRow);
    element.appendChild(head);
    const body = document.createElement('tbody');
    element.appendChild(body);
    return { table: element, body };
}

function cell(text?: string): HTMLTableCellElement {
    const td = document.createElement('td');
    if (text !== undefined) {
        td.textContent = text;
    }
    return td;
}

function actionCell(label: string, onClick: () => void): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = 'actions';
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', onClick);
    td.appendChild(button);
    return td;
}

function placeholder(text: string): HTMLElement {
    const div = document.createElement('div');
    div.className = 'placeholder';
    div.textContent = text;
    return div;
}

/* ------------------------------------------------------------------ */
/* 状态栏 / 提示条                                                      */
/* ------------------------------------------------------------------ */

function renderStatus(snapshot?: Snapshot): void {
    const count = changeCount();
    const applyButton = $('apply') as HTMLButtonElement;
    applyButton.disabled = state.busy || count === 0;
    applyButton.textContent = count > 0 ? `应用 (${count})` : '应用';
    $('reload').toggleAttribute('disabled', state.busy);

    const status = $('statusText');
    if (state.busy) {
        status.textContent = '正在应用…';
    } else if (count > 0) {
        status.textContent = `有 ${count} 项未应用的更改`;
    } else {
        status.textContent = '就绪';
    }

    const untouched = $('untouched');
    if (snapshot) {
        untouched.textContent = snapshot.untouchedCount > 0
            ? `另有 ${snapshot.untouchedCount} 项未在此界面展示，可用文本编辑器修改`
            : '';
    }
}

let bannerTimer: number | undefined;

function showBanner(message: string, isError: boolean, actions: Array<{ label: string; run: () => void }> = []): void {
    const banner = $('banner');
    banner.textContent = '';
    banner.className = `banner visible${isError ? ' error' : ''}`;
    const text = document.createElement('div');
    text.textContent = message;
    banner.appendChild(text);
    if (actions.length > 0) {
        const row = document.createElement('div');
        row.className = 'actions';
        for (const action of actions) {
            const button = document.createElement('button');
            button.textContent = action.label;
            button.addEventListener('click', () => {
                hideBanner();
                action.run();
            });
            row.appendChild(button);
        }
        banner.appendChild(row);
    }
    if (bannerTimer) {
        window.clearTimeout(bannerTimer);
    }
    bannerTimer = window.setTimeout(() => hideBanner(), isError ? 12000 : 8000);
}

function hideBanner(): void {
    const banner = $('banner');
    banner.className = 'banner';
    banner.textContent = '';
}

/* ------------------------------------------------------------------ */
/* 消息                                                                */
/* ------------------------------------------------------------------ */

function collectApplyMessage(): unknown {
    const snapshot = state.payload?.snapshot;
    if (!snapshot) {
        return null;
    }
    const fields = [...state.drafts.values()].map(draft => ({
        id: draft.id,
        scope: draft.scope,
        configuration: draft.configuration,
        platform: draft.platform,
        value: draft.value === '' ? null : draft.value,
    }));
    const pending = state.pending;
    return {
        type: 'apply',
        fields,
        refs: {
            addPackages: pending.packagesAdd,
            setPackageVersions: Object.entries(pending.packagesVersion).map(([id, version]) => ({ id, version })),
            removePackages: pending.packagesRemove,
            addProjectReferences: pending.projectsAdd,
            removeProjectReferences: pending.projectsRemove,
            addAssemblyReferences: pending.assembliesAdd,
            removeAssemblyReferences: pending.assembliesRemove,
            removeAnalyzers: pending.analyzersRemove,
        },
    };
}

window.addEventListener('message', event => {
    const message = event.data as { type: string; reason?: string; payload?: Payload; message?: string; include?: string; hintPath?: string };
    switch (message.type) {
        case 'snapshot': {
            if (!message.payload) {
                return;
            }
            state.payload = message.payload;
            state.busy = false;
            if (message.reason !== 'switch') {
                state.drafts.clear();
                state.pending = emptyPending();
                hideBanner();
            }
            if (message.reason === 'applied') {
                setStatusText('已应用更改，保存文件后生效（Ctrl+S）');
            }
            renderAll();
            return;
        }
        case 'error': {
            state.busy = false;
            renderStatus(state.payload?.snapshot);
            showBanner(message.message ?? '未知错误', true);
            return;
        }
        case 'externalChange': {
            showBanner('项目文件已被外部修改，面板中的值可能已过期。', false, [
                { label: '重新加载', run: () => post({ type: 'reload' }) },
            ]);
            return;
        }
        case 'assemblyPicked': {
            if (message.include) {
                state.pending.assembliesAdd.push({ include: message.include, hintPath: message.hintPath });
                renderContent();
                if (state.payload) {
                    renderStatus(state.payload.snapshot);
                }
            }
            return;
        }
        default:
            return;
    }
});

let statusTimer: number | undefined;

function setStatusText(text: string): void {
    $('statusText').textContent = text;
    if (statusTimer) {
        window.clearTimeout(statusTimer);
    }
    statusTimer = window.setTimeout(() => {
        if (state.payload) {
            renderStatus(state.payload.snapshot);
        }
    }, 6000);
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

function bindToolbar(): void {
    $('configuration').addEventListener('change', () => {
        const configuration = ($('configuration') as HTMLSelectElement).value;
        const platform = ($('platform') as HTMLSelectElement).value;
        state.busy = true;
        renderStatus(state.payload?.snapshot);
        post({ type: 'switchConfig', configuration, platform });
    });
    $('platform').addEventListener('change', () => {
        const configuration = ($('configuration') as HTMLSelectElement).value;
        const platform = ($('platform') as HTMLSelectElement).value;
        state.busy = true;
        renderStatus(state.payload?.snapshot);
        post({ type: 'switchConfig', configuration, platform });
    });
    $('apply').addEventListener('click', () => {
        const message = collectApplyMessage();
        if (!message) {
            return;
        }
        state.busy = true;
        renderStatus(state.payload?.snapshot);
        post(message);
    });
    $('reload').addEventListener('click', () => {
        if (changeCount() > 0 && !window.confirm('重新加载会丢弃未应用的更改，继续？')) {
            return;
        }
        state.busy = true;
        renderStatus(state.payload?.snapshot);
        post({ type: 'reload' });
    });
    $('openText').addEventListener('click', () => post({ type: 'openText' }));
}

bindToolbar();
post({ type: 'ready' });
