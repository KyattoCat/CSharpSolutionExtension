# 集成终端 / Delete 删除 / F2 重命名 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目树支持右键「在集成终端中打开」、Delete 键删除文件/文件夹、F2 键重命名文件/文件夹。

**Architecture:** `FileService` 新增 `deleteFolder` / `renameFolder`（目录级操作 + 单次 csproj 批量更新）；`extension.ts` 的 `deleteFile` / `renameFile` 命令处理器加节点类型分流和 `treeView.selection` 回退；`package.json` 新增 `openInTerminal` 命令、`dirFolder` 菜单项和 `keybindings` 贡献点。

**Tech Stack:** TypeScript, VS Code Extension API (keybindings / createTerminal), Node.js fs API

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/services/FileService.ts` | 修改 | 新增 `deleteFolder`、`renameFolder` 静态方法 |
| `src/test/FileService.test.ts` | 修改 | 新增 7 个测试用例 |
| `src/extension.ts` | 修改 | `openInTerminal` 命令；`deleteFile`/`renameFile` 分流 + selection 回退 |
| `package.json` | 修改 | 新命令、菜单项、keybindings |

---

### Task 1: FileService.deleteFolder

**Files:**
- Modify: `src/services/FileService.ts`（在 `moveFile` 方法之后新增）
- Test: `src/test/FileService.test.ts`

- [ ] **Step 1: 编写测试（3 个）**

在 `src/test/FileService.test.ts` 的最后一个测试之后、suite 的 `});` 闭合之前新增：

```typescript
test('deleteFolder 移除文件夹下全部 csproj 条目并保留其他条目', async () => {
    const subDir = path.join(tmpDir, 'ToRemove');
    await fs.promises.mkdir(subDir, { recursive: true });
    await fs.promises.writeFile(path.join(subDir, 'A.cs'), 'class A { }', 'utf-8');
    await fs.promises.writeFile(path.join(subDir, 'B.cs'), 'class B { }', 'utf-8');
    await fs.promises.writeFile(path.join(tmpDir, 'Keep.cs'), 'class Keep { }', 'utf-8');

    const csprojMulti = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="ToRemove/A.cs" />
    <Compile Include="ToRemove/B.cs" />
    <Compile Include="Keep.cs" />
  </ItemGroup>
</Project>`;
    await fs.promises.writeFile(projectPath, csprojMulti, 'utf-8');

    const compiles = [
        { include: 'ToRemove/A.cs' },
        { include: 'ToRemove/B.cs' },
        { include: 'Keep.cs' },
    ];
    const removed = await FileService.deleteFolder(projectPath, 'ToRemove', compiles);

    assert.strictEqual(removed, 2);
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.ok(!csproj.includes('ToRemove/A.cs'));
    assert.ok(!csproj.includes('ToRemove/B.cs'));
    assert.ok(csproj.includes('Keep.cs'));
    // 注：物理目录删除依赖 vscode.workspace.fs（单测环境下由扩展宿主提供，删除进回收站）
});

test('deleteFolder 移除嵌套子目录中的条目', async () => {
    const deepDir = path.join(tmpDir, 'Outer', 'Inner');
    await fs.promises.mkdir(deepDir, { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, 'Outer', 'Top.cs'), 'class Top { }', 'utf-8');
    await fs.promises.writeFile(path.join(deepDir, 'Deep.cs'), 'class Deep { }', 'utf-8');

    const csprojNested = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Outer/Top.cs" />
    <Compile Include="Outer/Inner/Deep.cs" />
  </ItemGroup>
</Project>`;
    await fs.promises.writeFile(projectPath, csprojNested, 'utf-8');

    const compiles = [
        { include: 'Outer/Top.cs' },
        { include: 'Outer/Inner/Deep.cs' },
    ];
    const removed = await FileService.deleteFolder(projectPath, 'Outer', compiles);

    assert.strictEqual(removed, 2);
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.ok(!csproj.includes('Outer/Top.cs'));
    assert.ok(!csproj.includes('Outer/Inner/Deep.cs'));
});

test('deleteFolder 兼容反斜杠分隔符的传统 .csproj', async () => {
    const subDir = path.join(tmpDir, 'BackDir');
    await fs.promises.mkdir(subDir, { recursive: true });
    await fs.promises.writeFile(path.join(subDir, 'C.cs'), 'class C { }', 'utf-8');

    const csprojBack = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="BackDir\\C.cs" />
    <Compile Include="Keep2.cs" />
  </ItemGroup>
</Project>`;
    await fs.promises.writeFile(projectPath, csprojBack, 'utf-8');
    await fs.promises.writeFile(path.join(tmpDir, 'Keep2.cs'), 'class Keep2 { }', 'utf-8');

    const compiles = [
        { include: 'BackDir\\C.cs' },
        { include: 'Keep2.cs' },
    ];
    const removed = await FileService.deleteFolder(projectPath, 'BackDir', compiles);

    assert.strictEqual(removed, 1);
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.ok(!csproj.includes('BackDir\\C.cs'));
    assert.ok(csproj.includes('Keep2.cs'));
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm run compile`
Expected: 编译错误 —— `FileService.deleteFolder` 不存在

- [ ] **Step 3: 实现 deleteFolder**

在 `src/services/FileService.ts` 的 `moveFile` 方法之后（`replaceClassName` 之前）新增：

```typescript
/**
 * 删除文件夹：从非 SDK 项目的 .csproj 中移除文件夹下全部 Compile 条目，
 * 并将物理目录移至回收站。返回移除的条目数。
 */
static async deleteFolder(
    projectPath: string,
    folderRelPath: string,
    compiles: CompileItem[]
): Promise<number> {
    const normalizedFolder = folderRelPath.replace(/\\/g, '/');
    const prefix = normalizedFolder + '/';

    // 前缀匹配筛出文件夹下所有条目（POSIX 归一化比较）
    const targets = compiles.filter(c => {
        const p = c.include.replace(/\\/g, '/');
        return p === normalizedFolder || p.startsWith(prefix);
    });

    const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
    const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);

    if (!isSdk && targets.length > 0) {
        let updated = csprojContent;
        for (const item of targets) {
            updated = CsprojSerializer.removeCompile(updated, item.include);
        }
        await fs.promises.writeFile(projectPath, updated, 'utf-8');
    }

    // 整个目录进回收站
    const projectDir = path.dirname(projectPath);
    const dirAbsPath = path.join(projectDir, folderRelPath);
    try {
        await vscode.workspace.fs.delete(vscode.Uri.file(dirAbsPath), {
            recursive: true,
            useTrash: true,
        });
    } catch (err) {
        console.warn(`Failed to delete folder: ${dirAbsPath}`, err);
    }

    return targets.length;
}
```

- [ ] **Step 4: 编译并运行测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（含新增 3 个 deleteFolder 测试）

- [ ] **Step 5: Commit**

```bash
git add src/services/FileService.ts src/test/FileService.test.ts
git commit -m "feat: add FileService.deleteFolder for folder deletion"
```

---

### Task 2: FileService.renameFolder

**Files:**
- Modify: `src/services/FileService.ts`（在 `deleteFolder` 方法之后新增）
- Test: `src/test/FileService.test.ts`

- [ ] **Step 1: 编写测试（4 个）**

在 `src/test/FileService.test.ts` 的 deleteFolder 测试之后新增：

```typescript
test('renameFolder 重命名目录并更新 csproj 全部路径', async () => {
    const subDir = path.join(tmpDir, 'OldDir');
    await fs.promises.mkdir(path.join(subDir, 'Nested'), { recursive: true });
    await fs.promises.writeFile(path.join(subDir, 'X.cs'), 'class X { }', 'utf-8');
    await fs.promises.writeFile(path.join(subDir, 'Nested', 'Y.cs'), 'class Y { }', 'utf-8');

    const csprojDir = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="OldDir/X.cs" />
    <Compile Include="OldDir/Nested/Y.cs" />
  </ItemGroup>
</Project>`;
    await fs.promises.writeFile(projectPath, csprojDir, 'utf-8');

    await FileService.renameFolder(projectPath, 'OldDir', 'NewDir');

    // 目录已改名
    const oldExists = await fs.promises.access(subDir).then(() => true, () => false);
    const newExists = await fs.promises.access(path.join(tmpDir, 'NewDir', 'X.cs')).then(() => true, () => false);
    assert.strictEqual(oldExists, false);
    assert.strictEqual(newExists, true);

    // csproj 路径已更新
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.ok(csproj.includes('NewDir/X.cs'));
    assert.ok(csproj.includes('NewDir/Nested/Y.cs'));
    assert.ok(!csproj.includes('OldDir/'));
});

test('renameFolder 兼容反斜杠分隔符并保持风格', async () => {
    const subDir = path.join(tmpDir, 'BackOld');
    await fs.promises.mkdir(subDir, { recursive: true });
    await fs.promises.writeFile(path.join(subDir, 'Z.cs'), 'class Z { }', 'utf-8');

    const csprojBack = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="BackOld\\Z.cs" />
  </ItemGroup>
</Project>`;
    await fs.promises.writeFile(projectPath, csprojBack, 'utf-8');

    await FileService.renameFolder(projectPath, 'BackOld', 'BackNew');

    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.ok(csproj.includes('BackNew\\Z.cs'), '新路径应保持反斜杠风格');
    assert.ok(!csproj.includes('BackOld'));
});

test('renameFolder 目标目录已存在时报错且无副作用', async () => {
    await fs.promises.mkdir(path.join(tmpDir, 'SrcDir'), { recursive: true });
    await fs.promises.mkdir(path.join(tmpDir, 'DstDir'), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, 'SrcDir', 'S.cs'), 'class S { }', 'utf-8');

    const csprojSrc = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="SrcDir/S.cs" />
  </ItemGroup>
</Project>`;
    await fs.promises.writeFile(projectPath, csprojSrc, 'utf-8');

    await assert.rejects(
        () => FileService.renameFolder(projectPath, 'SrcDir', 'DstDir'),
        /already exists/i
    );

    // 无副作用：源目录还在，csproj 未变
    const srcExists = await fs.promises.access(path.join(tmpDir, 'SrcDir', 'S.cs')).then(() => true, () => false);
    assert.strictEqual(srcExists, true);
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.strictEqual(csproj, csprojSrc);
});

test('renameFolder SDK 项目仅改目录不碰 csproj', async () => {
    const sdkCsproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;
    await fs.promises.writeFile(projectPath, sdkCsproj, 'utf-8');
    await fs.promises.mkdir(path.join(tmpDir, 'SdkDir'), { recursive: true });
    await fs.promises.writeFile(path.join(tmpDir, 'SdkDir', 'K.cs'), 'class K { }', 'utf-8');

    await FileService.renameFolder(projectPath, 'SdkDir', 'SdkRenamed');

    const newExists = await fs.promises.access(path.join(tmpDir, 'SdkRenamed', 'K.cs')).then(() => true, () => false);
    assert.strictEqual(newExists, true);
    const csproj = await fs.promises.readFile(projectPath, 'utf-8');
    assert.strictEqual(csproj, sdkCsproj);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm run compile`
Expected: 编译错误 —— `FileService.renameFolder` 不存在

- [ ] **Step 3: 实现 renameFolder**

在 `deleteFolder` 之后新增：

```typescript
/**
 * 重命名文件夹：目录改名 + 批量更新非 SDK 项目 .csproj 中该文件夹下所有条目路径。
 * 先完成 csproj 内容计算和校验，再动文件系统（与 moveFile 一致的先验证后动盘策略）。
 */
static async renameFolder(
    projectPath: string,
    folderRelPath: string,
    newName: string
): Promise<void> {
    const normalizedOld = folderRelPath.replace(/\\/g, '/');
    const parentDir = path.posix.dirname(normalizedOld);
    const normalizedNew = parentDir === '.'
        ? newName
        : path.posix.join(parentDir, newName);

    const projectDir = path.dirname(projectPath);
    const oldAbsPath = path.join(projectDir, normalizedOld);
    const newAbsPath = path.join(projectDir, normalizedNew);

    // 1. 校验源目录存在、目标目录不存在
    try {
        await fs.promises.access(oldAbsPath);
    } catch {
        throw new Error(`Source folder not found: ${folderRelPath}`);
    }
    try {
        await fs.promises.access(newAbsPath);
        throw new Error(`Target folder already exists: ${normalizedNew}`);
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Target folder already exists')) {
            throw err;
        }
    }

    // 2. 非 SDK 项目：内存中批量计算 csproj 更新（沿用 moveFile 的分隔符策略）
    const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
    const isSdk = /<Project\s+Sdk="[^"]*"/.test(csprojContent);

    let updatedContent: string | undefined;
    if (!isSdk) {
        const project = CsprojSerializer.parse(csprojContent, projectPath);
        const prefix = normalizedOld + '/';
        updatedContent = csprojContent;

        for (const compile of project.compiles) {
            const compilePosix = compile.include.replace(/\\/g, '/');
            if (compilePosix !== normalizedOld && !compilePosix.startsWith(prefix)) {
                continue;
            }
            const newIncludePosix = normalizedNew + compilePosix.slice(normalizedOld.length);
            // 新路径跟随源条目的分隔符风格
            const newInclude = compile.include.includes('\\')
                ? newIncludePosix.replace(/\//g, '\\')
                : newIncludePosix;

            let next = CsprojSerializer.updateCompilePath(updatedContent, compile.include, newInclude);
            if (next === updatedContent) {
                next = CsprojSerializer.updateCompilePath(
                    updatedContent,
                    compile.include.replace(/\//g, '\\'),
                    newIncludePosix.replace(/\//g, '\\')
                );
            }
            updatedContent = next;
        }
    }

    // 3. 目录改名
    await fs.promises.rename(oldAbsPath, newAbsPath);

    // 4. 写入 csproj（非 SDK），失败回滚目录改名
    if (!isSdk && updatedContent !== undefined && updatedContent !== csprojContent) {
        try {
            await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');
        } catch (err) {
            await fs.promises.rename(newAbsPath, oldAbsPath);
            throw err;
        }
    }
}
```

- [ ] **Step 4: 编译并运行测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（含新增 4 个 renameFolder 测试）

- [ ] **Step 5: Commit**

```bash
git add src/services/FileService.ts src/test/FileService.test.ts
git commit -m "feat: add FileService.renameFolder for folder rename"
```

---

### Task 3: package.json 贡献点

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 新增 openInTerminal 命令**

在 `contributes.commands` 数组末尾（`revealInExplorer` 之后）新增：

```json
{
  "command": "csharpsolution.openInTerminal",
  "title": "在集成终端中打开"
}
```

- [ ] **Step 2: 新增右键菜单项**

在 `contributes.menus["view/item/context"]` 数组中新增以下条目（`dirFolder` 已有 `addClass` 在 `navigation@1`，故重命名/删除使用 `navigation@3`/`navigation@4`）：

```json
{
  "command": "csharpsolution.openInTerminal",
  "when": "view == csharpsolution-projects && viewItem == project",
  "group": "group4@2"
},
{
  "command": "csharpsolution.openInTerminal",
  "when": "view == csharpsolution-projects && viewItem == solutionProject",
  "group": "group4@2"
},
{
  "command": "csharpsolution.openInTerminal",
  "when": "view == csharpsolution-projects && viewItem == solution",
  "group": "group4@2"
},
{
  "command": "csharpsolution.openInTerminal",
  "when": "view == csharpsolution-projects && viewItem == dirFolder",
  "group": "group4@2"
},
{
  "command": "csharpsolution.openInTerminal",
  "when": "view == csharpsolution-projects && viewItem == file",
  "group": "group4@2"
},
{
  "command": "csharpsolution.renameFile",
  "when": "view == csharpsolution-projects && viewItem == dirFolder",
  "group": "navigation@3"
},
{
  "command": "csharpsolution.deleteFile",
  "when": "view == csharpsolution-projects && viewItem == dirFolder",
  "group": "navigation@4"
}
```

- [ ] **Step 3: 新增 keybindings 贡献点**

在 `contributes` 对象中（与 `menus` 平级）新增：

```json
"keybindings": [
  {
    "command": "csharpsolution.deleteFile",
    "key": "delete",
    "when": "focusedView == csharpsolution-projects"
  },
  {
    "command": "csharpsolution.renameFile",
    "key": "f2",
    "when": "focusedView == csharpsolution-projects"
  }
]
```

- [ ] **Step 4: 编译验证**

Run: `pnpm run compile`
Expected: 编译成功（package.json 语法正确，不影响 TS 编译）

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat: contribute openInTerminal command, dirFolder menus, del/f2 keybindings"
```

---

### Task 4: extension.ts 命令处理器

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 改造 deleteFile 命令**

将现有的 `csharpsolution.deleteFile` 注册（约 96-119 行）替换为：

```typescript
// --- 删除文件/文件夹 ---
context.subscriptions.push(
    vscode.commands.registerCommand('csharpsolution.deleteFile', async (node?: ProjectNode) => {
        node = node ?? treeView.selection[0];
        if (!node || (node.type !== 'file' && node.type !== 'folder')) return;

        if (node.type === 'file') {
            const fileName = path.basename(node.compile.include);
            const confirm = await vscode.window.showWarningMessage(
                `确定要删除 "${fileName}" 吗？\n文件将移至回收站，并从项目中移除。`,
                { modal: true },
                '确定删除'
            );
            if (confirm !== '确定删除') return;

            try {
                await FileService.deleteFile(node.projectPath, node.compile);
                vscode.window.showInformationMessage(`已删除: ${fileName}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `删除失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
            return;
        }

        // folder 节点
        const project = treeProvider.allProjects.find(p => p.path === node.projectPath);
        if (!project) return;

        const folderName = path.basename(node.relPath);
        const normalizedFolder = node.relPath.replace(/\\/g, '/');
        const prefix = normalizedFolder + '/';
        const fileCount = project.compiles.filter(c => {
            const p = c.include.replace(/\\/g, '/');
            return p === normalizedFolder || p.startsWith(prefix);
        }).length;

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除文件夹 "${folderName}" 及其中 ${fileCount} 个文件吗？\n文件夹将移至回收站，并从项目中移除。`,
            { modal: true },
            '确定删除'
        );
        if (confirm !== '确定删除') return;

        try {
            await FileService.deleteFolder(node.projectPath, node.relPath, project.compiles);
            vscode.window.showInformationMessage(`已删除文件夹: ${folderName}`);
            vscode.commands.executeCommand('csharpsolution.refresh');
        } catch (err) {
            vscode.window.showErrorMessage(
                `删除失败: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    })
);
```

- [ ] **Step 2: 改造 renameFile 命令**

将现有的 `csharpsolution.renameFile` 注册替换为：

```typescript
// --- 重命名文件/文件夹 ---
context.subscriptions.push(
    vscode.commands.registerCommand('csharpsolution.renameFile', async (node?: ProjectNode) => {
        node = node ?? treeView.selection[0];
        if (!node || (node.type !== 'file' && node.type !== 'folder')) return;

        if (node.type === 'file') {
            const oldName = path.basename(node.compile.include, '.cs');
            const newName = await vscode.window.showInputBox({
                prompt: '请输入新文件名（不含扩展名）',
                value: oldName,
                validateInput: (value) => {
                    if (!FileTemplateService.isValidClassName(value)) {
                        if (!value.trim()) return '文件名不能为空';
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
                            return '文件名必须为合法的 C# 标识符';
                        }
                        return `"${value}" 是 C# 关键字，不能用作文件名`;
                    }
                    if (value === oldName) return '新文件名与旧文件名相同';
                    return null;
                },
            });
            if (!newName) return;

            try {
                const config = vscode.workspace.getConfiguration('csharpsolution');
                const syncCode = config.get<boolean>('renameSyncCode', true);
                await FileService.renameFile(node.projectPath, node.compile, newName, syncCode);
                vscode.window.showInformationMessage(`已重命名: ${oldName}.cs → ${newName}.cs`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `重命名失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
            return;
        }

        // folder 节点
        const oldFolderName = path.basename(node.relPath);
        const newFolderName = await vscode.window.showInputBox({
            prompt: '请输入新文件夹名',
            value: oldFolderName,
            validateInput: (value) => {
                if (!value.trim()) return '文件夹名不能为空';
                if (/[/\\:*?"<>|]/.test(value)) return '文件夹名包含非法字符';
                if (value === oldFolderName) return '新文件夹名与旧文件夹名相同';
                return null;
            },
        });
        if (!newFolderName) return;

        try {
            await FileService.renameFolder(node.projectPath, node.relPath, newFolderName);
            vscode.window.showInformationMessage(`已重命名文件夹: ${oldFolderName} → ${newFolderName}`);
            vscode.commands.executeCommand('csharpsolution.refresh');
        } catch (err) {
            vscode.window.showErrorMessage(
                `重命名失败: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    })
);
```

- [ ] **Step 3: 新增 openInTerminal 命令**

在 `revealInExplorer` 命令注册之后新增：

```typescript
// --- 在集成终端中打开 ---
context.subscriptions.push(
    vscode.commands.registerCommand('csharpsolution.openInTerminal', async (node: ProjectNode) => {
        if (!node) return;

        let cwd: string | undefined;
        switch (node.type) {
            case 'project':
                cwd = path.dirname(node.project.path);
                break;
            case 'solution':
                cwd = path.dirname(node.solution.path);
                break;
            case 'folder':
                cwd = path.join(path.dirname(node.projectPath), node.relPath);
                break;
            case 'file':
                cwd = path.dirname(path.join(path.dirname(node.projectPath), node.compile.include));
                break;
        }

        if (cwd) {
            vscode.window.createTerminal({ cwd }).show();
        }
    })
);
```

注意：`solutionProject` 的 contextValue 对应的节点类型是 `project`（带 solutionPath），上面的 `case 'project'` 已覆盖。

- [ ] **Step 4: 编译并运行测试**

Run: `pnpm run compile && pnpm test`
Expected: 编译成功，全部测试通过

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts
git commit -m "feat: openInTerminal command, folder delete/rename, selection fallback for keybindings"
```

---

### Task 5: 完整验证

- [ ] **Step 1: 编译 + 全量测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过，无回归

- [ ] **Step 2: 手动验证清单**

按 F5 启动扩展开发宿主：

| # | 场景 | 预期 |
|---|------|------|
| 1 | 项目/方案/文件夹/文件节点右键「在集成终端中打开」 | 终端 cwd 为对应目录（文件为其父目录） |
| 2 | 选中文件按 Delete | 弹删除确认，确认后删除 |
| 3 | 选中文件夹按 Delete | 弹「删除文件夹 X 及其中 N 个文件」确认 |
| 4 | 选中文件按 F2 | 弹重命名输入框 |
| 5 | 选中文件夹按 F2 | 弹文件夹重命名输入框，重命名后 csproj 路径批量更新 |
| 6 | 文件夹右键 | 有「重命名」「删除」菜单项 |
| 7 | 编辑器焦点按 Delete/F2 | 不触发本扩展命令 |
| 8 | 选中引用/包节点按 Delete/F2 | 无反应 |

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: address issues found in manual testing"
```
