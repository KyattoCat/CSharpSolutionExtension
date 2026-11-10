import * as vscode from 'vscode';

/** 「项目属性」面板的 HTML 外壳（样式内联，脚本走 out/webview/main.js） */
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview-ui', 'main.js'));

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>项目属性</title>
<style nonce="${nonce}">
  :root {
    --gap: 12px;
    --row-height: 26px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .page { display: flex; flex-direction: column; height: 100vh; }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--gap);
    padding: 10px 14px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
    flex-wrap: wrap;
  }
  .title { display: flex; flex-direction: column; min-width: 180px; margin-right: auto; }
  .project-name { font-size: 1.05em; font-weight: 600; }
  .project-file { opacity: .65; font-size: .85em; }
  .config { display: flex; gap: var(--gap); align-items: center; }
  .config label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  select, input[type="text"], input[type="search"], textarea {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 4px 6px;
    font-family: inherit;
    font-size: inherit;
    min-width: 120px;
  }
  select:focus, input:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  textarea { resize: vertical; min-height: 48px; }
  button {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: none;
    border-radius: 3px;
    padding: 5px 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.3)); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .5; cursor: default; }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 14px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
  }
  .tabs button {
    background: transparent;
    color: var(--vscode-foreground);
    border-radius: 0;
    border-bottom: 2px solid transparent;
    padding: 8px 14px;
    opacity: .8;
  }
  .tabs button.active { border-bottom-color: var(--vscode-focusBorder); opacity: 1; font-weight: 600; }
  .content { flex: 1; overflow: auto; padding: 16px 14px 24px; }
  .grid { display: grid; grid-template-columns: minmax(180px, 34%) 1fr; gap: 10px 16px; align-items: start; max-width: 900px; }
  .grid .label { padding-top: 5px; text-align: right; opacity: .9; }
  .grid .control { display: flex; flex-direction: column; gap: 4px; }
  .grid .control > input[type="text"], .grid .control > select, .grid .control > textarea { width: 100%; max-width: 420px; }
  .hint { opacity: .65; font-size: .85em; }
  .row-check { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
  input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--vscode-checkbox-background, var(--vscode-button-background)); }
  .section-title { font-weight: 600; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
  .section-title .badge { font-weight: 400; opacity: .7; font-size: .85em; }
  table { border-collapse: collapse; width: 100%; max-width: 980px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); vertical-align: middle; }
  th { font-weight: 600; opacity: .85; }
  tr.pending td { font-style: italic; }
  tr.removed td { opacity: .55; text-decoration: line-through; }
  td.actions { white-space: nowrap; text-align: right; }
  .add-row { display: flex; gap: 8px; align-items: center; margin: 12px 0 0; flex-wrap: wrap; }
  .add-row input, .add-row select { min-width: 160px; }
  .banner {
    display: none;
    margin: 10px 14px 0;
    padding: 8px 12px;
    border-radius: 3px;
    border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255,200,0,.6));
    background: var(--vscode-inputValidation-warningBackground, rgba(255,200,0,.1));
  }
  .banner.visible { display: block; }
  .banner.error {
    border-color: var(--vscode-inputValidation-errorBorder, rgba(255,0,0,.6));
    background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,.1));
  }
  .banner .actions { margin-top: 6px; display: flex; gap: 8px; }
  .status {
    display: flex;
    justify-content: space-between;
    gap: var(--gap);
    padding: 6px 14px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));
    font-size: .85em;
    opacity: .85;
  }
  .placeholder { opacity: .7; padding: 24px; text-align: center; }
  code { font-family: var(--vscode-editor-font-family, monospace); }
  .mb-12 { margin-bottom: 12px; }
  .mt-24 { margin-top: 24px; }
  .dim { opacity: .65; }
</style>
</head>
<body>
  <div class="page">
    <header class="toolbar">
      <div class="title">
        <span class="project-name" id="projectName">加载中…</span>
        <span class="project-file" id="projectFile"></span>
      </div>
      <div class="config">
        <label>配置 <select id="configuration"></select></label>
        <label>平台 <select id="platform"></select></label>
      </div>
      <div class="actions">
        <button id="apply" class="primary">应用</button>
        <button id="reload">重新加载</button>
        <button id="openText">文本编辑</button>
      </div>
    </header>
    <div class="banner" id="banner"></div>
    <nav class="tabs" id="tabs"></nav>
    <main class="content" id="content"><div class="placeholder">加载中…</div></main>
    <footer class="status">
      <span id="statusText">就绪</span>
      <span id="untouched"></span>
    </footer>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
