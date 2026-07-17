# 文件管理增强 — 实现计划（子项目 B）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建文件夹（空文件夹可见）、接口/枚举/结构体模板（「新增文件」子菜单）、从项目排除（文件+文件夹、传统+SDK）、多选批量删除/排除、linked 节点菜单裁剪与拖拽排除。

**Architecture:** 解析层加 `folders` 字段与 Folder/Compile-Remove 序列化；`FileTemplateService.generateByKind` 承载四种模板；`CsprojService` 新增 `addType`/`addFolder`/`excludeFiles`；树层合并空文件夹节点并为 `..` 路径产出 `linkedFile`/`linkedFolder` contextValue；命令层用 `collectBatchNodes` 统一多选收集（复用 `dedupeDragData`）。

**Tech Stack:** TypeScript, VS Code Extension API (submenus / canSelectMany), Mocha

---

## 文件结构

| 文件 | 操作 |
|------|------|
| `src/models/CsprojModel.ts` | 修改：`CsprojProject.folders: string[]` |
| `src/serialization/CsprojSerializer.ts` | 修改：parseFolders / addFolder / addCompileRemove / SDK 空目录收集 |
| `src/services/FileTemplateService.ts` | 修改：TypeKind + generateByKind |
| `src/services/CsprojService.ts` | 修改：addType / addFolder / excludeFiles；addClass 委托 addType |
| `src/tree/dragDropLogic.ts` | 修改：isLinkedPath |
| `src/tree/DragDropController.ts` | 修改：handleDrag 跳过 linked |
| `src/tree/ProjectTreeProvider.ts` | 修改：空文件夹合并、linked contextValue |
| `src/commands/fileCommands.ts` | 修改：addType 系列 / addFolder / exclude / 多选删除 |
| `src/extension.ts` | 修改：canSelectMany |
| `package.json` | 修改：submenu / 命令 / 菜单矩阵 |
| 测试 | `CsprojSerializer.test.ts`、`FileTemplateService.test.ts`、`dragDropLogic.test.ts` 扩充；新建 `CsprojService.test.ts` |

---

### Task 1: folders 字段 + parseFolders + SDK 空目录收集

**Files:**
- Modify: `src/models/CsprojModel.ts`
- Modify: `src/serialization/CsprojSerializer.ts`
- Test: `src/test/CsprojSerializer.test.ts`

- [ ] **Step 1: 写测试**

在 `src/test/CsprojSerializer.test.ts` 末尾（suite 闭合前）新增：

```typescript
test('parseFolders 解析 Folder 条目并归一化', () => {
    const xml = `<Project><ItemGroup>
    <Folder Include="Empty\\" />
    <Folder Include="A\\B\\" />
    <Folder Include="Posix/C/" />
  </ItemGroup></Project>`;
    assert.deepStrictEqual(CsprojSerializer.parseFolders(xml), ['Empty', 'A/B', 'Posix/C']);
});

test('parseFolders 无 Folder 条目返回空数组', () => {
    assert.deepStrictEqual(CsprojSerializer.parseFolders('<Project></Project>'), []);
});

test('parseLegacy 填充 folders 字段', () => {
    const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup><Folder Include="Empty\\" /></ItemGroup>
</Project>`;
    const project = CsprojSerializer.parse(xml, 'C:/proj/Test.csproj');
    assert.deepStrictEqual(project.folders, ['Empty']);
});
```

SDK 空目录测试——找到现有 SDK glob 测试（`解析 SDK 风格项目自动 glob 文件`）所用的临时目录构建方式，仿照新增：

```typescript
test('parseSdk 收集空目录到 folders', () => {
    // 临时目录：EmptyDir（空）、Src/HasFile.cs
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'csproj-sdk-folders-'));
    try {
        fs.mkdirSync(path.join(tmpRoot, 'EmptyDir'));
        fs.mkdirSync(path.join(tmpRoot, 'Src'));
        fs.writeFileSync(path.join(tmpRoot, 'Src', 'HasFile.cs'), 'class A { }');

        const project = CsprojSerializer.parse(
            '<Project Sdk="Microsoft.NET.Sdk"></Project>',
            path.join(tmpRoot, 'Test.csproj')
        );
        assert.deepStrictEqual(project.folders, ['EmptyDir']);
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
```

（该测试文件如未 import `os`/`fs`/`path`，补上——现有 SDK 测试大概率已有。）

- [ ] **Step 2: 编译验证失败**

Run: `pnpm run compile`
Expected: 编译错误（parseFolders 不存在 / folders 字段缺失）

- [ ] **Step 3: 实现**

`src/models/CsprojModel.ts` 的 `CsprojProject` 接口新增：

```typescript
/** 空文件夹列表（POSIX 相对路径）：传统项目来自 <Folder Include>，SDK 项目来自文件系统扫描 */
folders: string[];
```

`src/serialization/CsprojSerializer.ts`：

```typescript
/** 解析 <Folder Include="Sub\" /> 条目，返回 POSIX 风格、去尾部分隔符的路径列表 */
static parseFolders(xml: string): string[] {
    const results: string[] = [];
    const regex = /<Folder\s+Include="([^"]*)"[^>]*\/?>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
        const normalized = match[1].replace(/\\/g, '/').replace(/\/+$/, '');
        if (normalized) {
            results.push(normalized);
        }
    }
    return results;
}
```

`parseLegacy` 返回对象加 `folders: this.parseFolders(xml),`；`parseSdk` 加 `folders: this.collectEmptyDirs(projectDir),`。

新增私有方法（与 walkDir 并列）：

```typescript
/** 收集子树中不含任何 .cs 文件的目录（POSIX 相对路径，含嵌套空目录），跳过 bin/obj/node_modules */
private static collectEmptyDirs(root: string): string[] {
    const result: string[] = [];
    const walk = (dir: string): boolean => { // 返回子树是否含 .cs
        let hasCs = false;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    if (entry.name === 'bin' || entry.name === 'obj' || entry.name === 'node_modules') continue;
                    const full = path.join(dir, entry.name);
                    const childHas = walk(full);
                    if (!childHas) {
                        result.push(path.relative(root, full).replace(/\\/g, '/'));
                    }
                    hasCs = hasCs || childHas;
                } else if (entry.name.endsWith('.cs')) {
                    hasCs = true;
                }
            }
        } catch { /* dir not readable */ }
        return hasCs;
    };
    walk(root);
    return result.sort((a, b) => a.localeCompare(b));
}
```

- [ ] **Step 4: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（91 + 4 = 95）

- [ ] **Step 5: Commit**

```bash
git add src/models/CsprojModel.ts src/serialization/CsprojSerializer.ts src/test/CsprojSerializer.test.ts
git commit -m "feat: parse Folder entries and collect SDK empty dirs into CsprojProject.folders"
```

---

### Task 2: CsprojSerializer.addFolder + addCompileRemove

**Files:**
- Modify: `src/serialization/CsprojSerializer.ts`
- Test: `src/test/CsprojSerializer.test.ts`

- [ ] **Step 1: 写测试**

```typescript
test('addFolder 追加到已有 Folder 块之后', () => {
    const xml = `<Project>
  <ItemGroup>
    <Folder Include="A\\" />
  </ItemGroup>
</Project>`;
    const result = CsprojSerializer.addFolder(xml, 'B/C');
    assert.ok(result.includes('<Folder Include="B\\C\\" />'));
    assert.ok(result.indexOf('A\\') < result.indexOf('B\\C\\'));
});

test('addFolder 无 Folder 块时新建 ItemGroup', () => {
    const xml = `<Project>\n</Project>`;
    const result = CsprojSerializer.addFolder(xml, 'New');
    assert.ok(result.includes('<Folder Include="New\\" />'));
    assert.ok(result.includes('<ItemGroup>'));
});

test('addFolder 重复条目返回原 xml（归一化比较）', () => {
    const xml = `<Project><ItemGroup><Folder Include="A\\B\\" /></ItemGroup></Project>`;
    assert.strictEqual(CsprojSerializer.addFolder(xml, 'A/B'), xml);
});

test('addCompileRemove 追加 Remove 条目', () => {
    const xml = `<Project Sdk="Microsoft.NET.Sdk">\n</Project>`;
    const result = CsprojSerializer.addCompileRemove(xml, 'Sub/File.cs');
    assert.ok(result.includes('<Compile Remove="Sub/File.cs" />'));
    assert.ok(result.includes('<ItemGroup>'));
});

test('addCompileRemove 追加到已有 Remove 块之后', () => {
    const xml = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <Compile Remove="Old.cs" />
  </ItemGroup>
</Project>`;
    const result = CsprojSerializer.addCompileRemove(xml, 'New.cs');
    assert.ok(result.indexOf('Old.cs') < result.indexOf('<Compile Remove="New.cs" />'));
});
```

- [ ] **Step 2: 编译验证失败**

Run: `pnpm run compile`
Expected: 编译错误

- [ ] **Step 3: 实现**

在 `addCompile` 附近新增（插入策略仿照 `addCompile`）：

```typescript
/**
 * 向 .csproj 添加 <Folder Include="Sub\" /> 条目（反斜杠 + 尾部分隔符风格，与 VS 一致）。
 * 已有同路径条目（分隔符归一化比较）则返回原 xml。
 */
static addFolder(xml: string, folderRelPath: string): string {
    const normalized = folderRelPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (this.parseFolders(xml).includes(normalized)) {
        return xml;
    }

    const includeValue = normalized.replace(/\//g, '\\') + '\\';
    const newLine = `    <Folder Include="${includeValue}" />`;
    return this.insertItemLine(xml, /^\s*<Folder\s+Include="[^"]*"/gm, newLine);
}

/** SDK 项目排除：添加 <Compile Remove="..." /> 条目 */
static addCompileRemove(xml: string, relPath: string): string {
    const newLine = `    <Compile Remove="${relPath}" />`;
    return this.insertItemLine(xml, /^\s*<Compile\s+Remove="[^"]*"/gm, newLine);
}

/** 在最后一个匹配 blockRegex 的自闭合条目行后插入 newLine；无匹配则在 </Project> 前新建 ItemGroup */
private static insertItemLine(xml: string, blockRegex: RegExp, newLine: string): string {
    const matches = [...xml.matchAll(blockRegex)];
    if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const startIndex = lastMatch.index!;
        const rest = xml.slice(startIndex);
        let insertPos = startIndex + rest.indexOf('/>') + 2;
        const newlineAfter = xml.indexOf('\n', insertPos);
        insertPos = newlineAfter !== -1 ? newlineAfter + 1 : xml.length;
        return xml.slice(0, insertPos) + newLine + '\n' + xml.slice(insertPos);
    }
    const projectClose = xml.lastIndexOf('</Project>');
    const itemGroup = `  <ItemGroup>\n${newLine}\n  </ItemGroup>\n`;
    if (projectClose !== -1) {
        return xml.slice(0, projectClose) + itemGroup + xml.slice(projectClose);
    }
    return xml + '\n' + itemGroup;
}
```

- [ ] **Step 4: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（95 + 5 = 100）

- [ ] **Step 5: Commit**

```bash
git add src/serialization/CsprojSerializer.ts src/test/CsprojSerializer.test.ts
git commit -m "feat: add CsprojSerializer.addFolder and addCompileRemove"
```

---

### Task 3: FileTemplateService.generateByKind

**Files:**
- Modify: `src/services/FileTemplateService.ts`
- Test: `src/test/FileTemplateService.test.ts`

- [ ] **Step 1: 写测试**

在 `src/test/FileTemplateService.test.ts` 末尾新增：

```typescript
test('generateByKind 生成四种类型', () => {
    const cls = FileTemplateService.generateByKind('My.App', 'Foo', 'class');
    assert.ok(cls.includes('namespace My.App'));
    assert.ok(cls.includes('public class Foo'));

    const itf = FileTemplateService.generateByKind('My.App', 'IFoo', 'interface');
    assert.ok(itf.includes('public interface IFoo'));

    const enm = FileTemplateService.generateByKind('My.App', 'Color', 'enum');
    assert.ok(enm.includes('public enum Color'));

    const stc = FileTemplateService.generateByKind('My.App', 'Point', 'struct');
    assert.ok(stc.includes('public struct Point'));
});
```

- [ ] **Step 2: 编译验证失败**

Run: `pnpm run compile`
Expected: 编译错误

- [ ] **Step 3: 实现**

`src/services/FileTemplateService.ts`：

```typescript
export type TypeKind = 'class' | 'interface' | 'enum' | 'struct';

// class 内新增：

private static readonly TYPE_TEMPLATES: Record<TypeKind, string[]> = {
    class: [
        'using System;',
        '',
        'namespace {namespace}',
        '{',
        '    public class {className}',
        '    {',
        '        ',
        '    }',
        '}',
        '',
    ],
    interface: [
        'using System;',
        '',
        'namespace {namespace}',
        '{',
        '    public interface {className}',
        '    {',
        '        ',
        '    }',
        '}',
        '',
    ],
    enum: [
        'using System;',
        '',
        'namespace {namespace}',
        '{',
        '    public enum {className}',
        '    {',
        '        ',
        '    }',
        '}',
        '',
    ],
    struct: [
        'using System;',
        '',
        'namespace {namespace}',
        '{',
        '    public struct {className}',
        '    {',
        '        ',
        '    }',
        '}',
        '',
    ],
};

/** 按类型生成 C# 代码（模板硬编码；class 模板与原 DEFAULT_CLASS_TEMPLATE 一致） */
static generateByKind(namespace: string, name: string, kind: TypeKind): string {
    return this.generate(namespace, name, this.TYPE_TEMPLATES[kind]);
}
```

- [ ] **Step 4: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（100 + 1 = 101）

- [ ] **Step 5: Commit**

```bash
git add src/services/FileTemplateService.ts src/test/FileTemplateService.test.ts
git commit -m "feat: add typed templates via FileTemplateService.generateByKind"
```

---

### Task 4: CsprojService.addType / addFolder / excludeFiles

**Files:**
- Modify: `src/services/CsprojService.ts`
- Create: `src/test/CsprojService.test.ts`

- [ ] **Step 1: 写测试**

新建 `src/test/CsprojService.test.ts`：

```typescript
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CsprojService } from '../services/CsprojService';

suite('CsprojService', () => {

    const tmpDir = path.join(os.tmpdir(), 'csprojservice-test-' + Date.now());
    const projectPath = path.join(tmpDir, 'Test.csproj');
    const legacyCsproj = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Keep.cs" />
    <Compile Include="Sub/A.cs" />
    <Compile Include="Sub/B.cs" />
  </ItemGroup>
</Project>`;
    const sdkCsproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

    suiteSetup(async () => {
        await fs.promises.mkdir(tmpDir, { recursive: true });
    });

    suiteTeardown(async () => {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    setup(async () => {
        const entries = await fs.promises.readdir(tmpDir);
        for (const entry of entries) {
            const full = path.join(tmpDir, entry);
            const stat = await fs.promises.stat(full);
            if (stat.isDirectory()) {
                await fs.promises.rm(full, { recursive: true, force: true });
            } else if (entry !== 'Test.csproj') {
                await fs.promises.unlink(full);
            }
        }
        await fs.promises.writeFile(projectPath, legacyCsproj, 'utf-8');
    });

    test('addType 创建接口文件并注册 csproj', async () => {
        await CsprojService.addType(projectPath, '', 'IFoo', 'interface', 'My.App');
        const content = await fs.promises.readFile(path.join(tmpDir, 'IFoo.cs'), 'utf-8');
        assert.ok(content.includes('public interface IFoo'));
        assert.ok(content.includes('namespace My.App'));
        const csproj = await fs.promises.readFile(projectPath, 'utf-8');
        assert.ok(csproj.includes('IFoo.cs'));
    });

    test('addType 子目录推断命名空间', async () => {
        await fs.promises.mkdir(path.join(tmpDir, 'Models'), { recursive: true });
        await CsprojService.addType(projectPath, 'Models', 'Color', 'enum', 'My.App');
        const content = await fs.promises.readFile(path.join(tmpDir, 'Models', 'Color.cs'), 'utf-8');
        assert.ok(content.includes('namespace My.App.Models'));
        assert.ok(content.includes('public enum Color'));
    });

    test('addFolder 传统项目建目录并写 Folder 条目', async () => {
        await CsprojService.addFolder(projectPath, '', 'NewDir');
        const dirExists = await fs.promises.access(path.join(tmpDir, 'NewDir')).then(() => true, () => false);
        assert.strictEqual(dirExists, true);
        const csproj = await fs.promises.readFile(projectPath, 'utf-8');
        assert.ok(csproj.includes('<Folder Include="NewDir\\" />'));
    });

    test('addFolder SDK 项目仅建目录', async () => {
        await fs.promises.writeFile(projectPath, sdkCsproj, 'utf-8');
        await CsprojService.addFolder(projectPath, '', 'SdkDir');
        const dirExists = await fs.promises.access(path.join(tmpDir, 'SdkDir')).then(() => true, () => false);
        assert.strictEqual(dirExists, true);
        const csproj = await fs.promises.readFile(projectPath, 'utf-8');
        assert.strictEqual(csproj, sdkCsproj);
    });

    test('addFolder 目录已存在时报错', async () => {
        await fs.promises.mkdir(path.join(tmpDir, 'Dup'), { recursive: true });
        await assert.rejects(
            () => CsprojService.addFolder(projectPath, '', 'Dup'),
            /already exists/i
        );
    });

    test('addFolder 非法名称报错', async () => {
        await assert.rejects(() => CsprojService.addFolder(projectPath, '', '..'), /Invalid folder name/);
        await assert.rejects(() => CsprojService.addFolder(projectPath, '', 'a/b'), /Invalid folder name/);
        await assert.rejects(() => CsprojService.addFolder(projectPath, '', 'CON'), /Invalid folder name/);
    });

    test('excludeFiles 传统项目移除条目不删文件', async () => {
        await fs.promises.mkdir(path.join(tmpDir, 'Sub'), { recursive: true });
        await fs.promises.writeFile(path.join(tmpDir, 'Sub', 'A.cs'), 'class A { }', 'utf-8');

        const n = await CsprojService.excludeFiles(projectPath, ['Sub/A.cs', 'Sub/B.cs']);
        assert.strictEqual(n, 2);
        const csproj = await fs.promises.readFile(projectPath, 'utf-8');
        assert.ok(!csproj.includes('Sub/A.cs'));
        assert.ok(!csproj.includes('Sub/B.cs'));
        assert.ok(csproj.includes('Keep.cs'));
        // 物理文件未删除
        const fileExists = await fs.promises.access(path.join(tmpDir, 'Sub', 'A.cs')).then(() => true, () => false);
        assert.strictEqual(fileExists, true);
    });

    test('excludeFiles SDK 项目写 Compile Remove', async () => {
        await fs.promises.writeFile(projectPath, sdkCsproj, 'utf-8');
        const n = await CsprojService.excludeFiles(projectPath, ['Sub/A.cs']);
        assert.strictEqual(n, 1);
        const csproj = await fs.promises.readFile(projectPath, 'utf-8');
        assert.ok(csproj.includes('<Compile Remove="Sub/A.cs" />'));
    });

    test('excludeFiles 空列表为 no-op', async () => {
        const before = await fs.promises.readFile(projectPath, 'utf-8');
        const n = await CsprojService.excludeFiles(projectPath, []);
        assert.strictEqual(n, 0);
        const after = await fs.promises.readFile(projectPath, 'utf-8');
        assert.strictEqual(after, before);
    });
});
```

- [ ] **Step 2: 编译验证失败**

Run: `pnpm run compile`
Expected: 编译错误

- [ ] **Step 3: 实现**

`src/services/CsprojService.ts`（顶部补 `import { FileTemplateService, TypeKind } from './FileTemplateService';`——`FileTemplateService` 已导入，加 `TypeKind`）：

```typescript
/**
 * 通用新增类型：创建 .cs 文件（按 kind 生成内容）+ 注册 csproj（非 SDK 项目）。
 */
static async addType(
    projectPath: string,
    dirPath: string,
    name: string,
    kind: TypeKind,
    rootNamespace: string
): Promise<vscode.Uri> {
    if (!FileTemplateService.isValidClassName(name)) {
        throw new Error(`无效的名称: "${name}"。必须为合法的 C# 标识符。`);
    }

    const projectDir = path.dirname(projectPath);
    const fileRelPath = dirPath ? path.join(dirPath, `${name}.cs`) : `${name}.cs`;
    const fileAbsPath = path.join(projectDir, fileRelPath);

    try {
        await fs.promises.access(fileAbsPath);
        throw new Error(`文件已存在: ${fileRelPath}`);
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('文件已存在')) {
            throw err;
        }
    }

    const namespace = rootNamespace || path.basename(projectPath, '.csproj');
    const fullNs = FileTemplateService.inferNamespace(namespace, dirPath);
    const content = FileTemplateService.generateByKind(fullNs, name, kind);

    await fs.promises.mkdir(path.dirname(fileAbsPath), { recursive: true });
    await fs.promises.writeFile(fileAbsPath, content, 'utf-8');

    const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
    if (!CsprojSerializer.isSdk(csprojContent)) {
        const updated = CsprojSerializer.addCompile(csprojContent, fileRelPath);
        await fs.promises.writeFile(projectPath, updated, 'utf-8');
    }

    return vscode.Uri.file(fileAbsPath);
}

/**
 * 新建文件夹：物理 mkdir + 非 SDK 项目写入 <Folder> 条目；SDK 项目仅 mkdir。
 */
static async addFolder(
    projectPath: string,
    parentDirPath: string,
    folderName: string
): Promise<void> {
    if (!folderName || folderName === '.' || folderName === '..'
        || /[\\/:*?"<>|]/.test(folderName)
        || /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(folderName)
        || /[. ]$/.test(folderName)) {
        throw new Error(`Invalid folder name: ${folderName}`);
    }

    const parentPosix = parentDirPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const relPath = parentPosix ? path.posix.join(parentPosix, folderName) : folderName;
    const projectDir = path.dirname(projectPath);
    const absPath = path.join(projectDir, relPath);

    try {
        await fs.promises.access(absPath);
        throw new Error(`Folder already exists: ${relPath}`);
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Folder already exists')) {
            throw err;
        }
    }

    await fs.promises.mkdir(absPath, { recursive: true });

    const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
    if (!CsprojSerializer.isSdk(csprojContent)) {
        const updated = CsprojSerializer.addFolder(csprojContent, relPath);
        if (updated !== csprojContent) {
            await fs.promises.writeFile(projectPath, updated, 'utf-8');
        }
    }
}

/**
 * 批量排除：从项目移除条目、不删物理文件。单次读写 csproj，返回条目数。
 * 非 SDK：removeCompile；SDK：addCompileRemove。includes 传原始 include 保持分隔符匹配。
 */
static async excludeFiles(projectPath: string, includes: string[]): Promise<number> {
    if (includes.length === 0) {
        return 0;
    }
    const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
    const isSdk = CsprojSerializer.isSdk(csprojContent);

    let updated = csprojContent;
    for (const include of includes) {
        updated = isSdk
            ? CsprojSerializer.addCompileRemove(updated, include)
            : CsprojSerializer.removeCompile(updated, include);
    }
    if (updated !== csprojContent) {
        await fs.promises.writeFile(projectPath, updated, 'utf-8');
    }
    return includes.length;
}
```

同时将 `addClass` 改为委托（模板参数保留签名兼容，实际忽略——classTemplate 配置已于 v1.3.x 移除，唯一调用方传入的就是默认模板）：

```typescript
/**
 * 添加类。保留签名兼容；classTemplate 参数已废弃（配置项已移除），
 * 实际内容由 FileTemplateService 的 class 模板生成（与原默认模板一致）。
 */
static async addClass(
    projectPath: string,
    dirPath: string,
    className: string,
    rootNamespace: string,
    _classTemplate: string[]
): Promise<vscode.Uri> {
    return this.addType(projectPath, dirPath, className, 'class', rootNamespace);
}
```

- [ ] **Step 4: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（101 + 9 = 110）

- [ ] **Step 5: Commit**

```bash
git add src/services/CsprojService.ts src/test/CsprojService.test.ts
git commit -m "feat: add CsprojService.addType/addFolder/excludeFiles"
```

---

### Task 5: 树层——空文件夹合并 + linked 节点 + 拖拽排除

**Files:**
- Modify: `src/tree/dragDropLogic.ts`
- Modify: `src/tree/DragDropController.ts`
- Modify: `src/tree/ProjectTreeProvider.ts`
- Test: `src/test/dragDropLogic.test.ts`

- [ ] **Step 1: 写 isLinkedPath 测试**

在 `src/test/dragDropLogic.test.ts` 顶部 import 补 `isLinkedPath`，新增 suite：

```typescript
suite('isLinkedPath', () => {
    test('.. 与 ../ 前缀为链接路径', () => {
        assert.strictEqual(isLinkedPath('..'), true);
        assert.strictEqual(isLinkedPath('../Shared'), true);
        assert.strictEqual(isLinkedPath('..\\Shared\\Foo.cs'), true);
    });

    test('常规路径不是链接路径', () => {
        assert.strictEqual(isLinkedPath('Models/User.cs'), false);
        assert.strictEqual(isLinkedPath('a..b/x.cs'), false);
        assert.strictEqual(isLinkedPath(''), false);
    });
});
```

- [ ] **Step 2: 编译验证失败**

Run: `pnpm run compile`
Expected: 编译错误

- [ ] **Step 3: 实现 isLinkedPath + handleDrag 跳过**

`src/tree/dragDropLogic.ts` 新增：

```typescript
/** 判断是否为链接路径（指向项目目录之外）：POSIX 归一化后等于 '..' 或以 '../' 开头 */
export function isLinkedPath(relPath: string): boolean {
    const p = relPath.replace(/\\/g, '/');
    return p === '..' || p.startsWith('../');
}
```

`src/tree/DragDropController.ts` 的 `handleDrag`：import 增加 `isLinkedPath`；两个分支各加跳过（linked 节点不参与拖拽——物理搬动共享文件危险）：

```typescript
if (node.type === 'file') {
    if (isLinkedPath(node.compile.include)) continue;
    // ...原 push
} else if (node.type === 'folder') {
    if (isLinkedPath(node.relPath)) continue;
    // ...原 push
}
```

（`for...of` 中用 `continue`；若现有结构是 if/else 直接在 push 前加卫语句。）

- [ ] **Step 4: 树层——linked contextValue + 空文件夹合并**

`src/tree/ProjectTreeProvider.ts`（import 增加 `isLinkedPath` from `./dragDropLogic`）：

1. `getTreeItem` 的 `case 'folder'` 块，contextValue 改为：

```typescript
item.contextValue = isLinkedPath(node.relPath) ? 'linkedFolder' : 'dirFolder';
```

2. `fileTreeItem` 中 contextValue 改为：

```typescript
item.contextValue = isLinkedPath(compile.include) ? 'linkedFile' : 'file';
```

并在 `parts` 组装处（`compile.link` 判断之后）追加：

```typescript
if (!compile.link && isLinkedPath(compile.include)) {
    parts.push('→ 链接');
}
```

3. **空文件夹合并** —— `getProjectChildren` 中 `buildFolderTree` 调用改为传入 folders：

```typescript
const folderMap = this.buildFolderTree(project.compiles, project.path, project.folders);
```

`buildFolderTree` 签名与实现（在现有 topFolders 收集之后合并）：

```typescript
private buildFolderTree(compiles: CompileItem[], projectPath: string, folders: string[]): ProjectNode[] {
    // ...现有逻辑不变...

    // Only add top-level folders; deeper nesting handled in getFolderChildren
    const topFolders = new Set<string>();
    for (const folderRelPath of folderMap.keys()) {
        topFolders.add(folderRelPath.split('/')[0]);
    }
    // 合并空文件夹（Folder 条目 / SDK 空目录）的顶层段
    for (const f of folders) {
        topFolders.add(f.split('/')[0]);
    }

    // ...其余不变...
}
```

`getFolderChildren` 中子目录发现同样合并（在现有 compiles 循环之后）：

```typescript
const project = this.allProjects.find(p => p.path === node.projectPath);
if (!project) return [];
// ...现有 directFiles/subFolders 逻辑...

// 合并空文件夹产生的直接子目录
for (const f of project.folders) {
    const fp = f.replace(/\\/g, '/');
    if (fp.startsWith(prefix)) {
        const remaining = fp.slice(prefix.length);
        const nextSegment = remaining.split('/')[0];
        if (nextSegment) {
            subFolders.add(normalizedFolder + '/' + nextSegment);
        }
    }
}
```

- [ ] **Step 5: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（110 + 2 = 112）

- [ ] **Step 6: Commit**

```bash
git add src/tree/dragDropLogic.ts src/tree/DragDropController.ts src/tree/ProjectTreeProvider.ts src/test/dragDropLogic.test.ts
git commit -m "feat: show empty folders, mark linked nodes, exclude linked from drag"
```

---

### Task 6: 命令层——addType 系列 / addFolder / exclude / 多选删除

**Files:**
- Modify: `src/commands/fileCommands.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: fileCommands.ts 重构添加类命令为 addType 系列**

import 增加：`import { TypeKind } from '../services/FileTemplateService';`、`import { DragNodeData, dedupeDragData, isLinkedPath } from '../tree/dragDropLogic';`

删除原 `--- 添加类 ---` 块和文件末尾的 `DEFAULT_CLASS_TEMPLATE` 常量，替换为：

```typescript
// --- 新增文件（类/接口/枚举/结构体）---
const registerAddType = (commandId: string, kind: TypeKind, label: string) => {
    context.subscriptions.push(
        vscode.commands.registerCommand(commandId, async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'folder')) return;
            if (node.type === 'folder' && isLinkedPath(node.relPath)) return;

            const projectPath = node.type === 'project' ? node.project.path : node.projectPath;
            const dirPath = node.type === 'folder' ? node.relPath : '';
            const projectName = path.basename(projectPath, '.csproj');

            const name = await vscode.window.showInputBox({
                prompt: `请输入${label}名`,
                placeHolder: kind === 'interface' ? 'INewInterface' : `New${kind.charAt(0).toUpperCase()}${kind.slice(1)}`,
                validateInput: (value) => {
                    if (!FileTemplateService.isValidClassName(value)) {
                        if (!value.trim()) return `${label}名不能为空`;
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
                            return `${label}名必须为合法的 C# 标识符`;
                        }
                        return `"${value}" 是 C# 关键字，不能用作${label}名`;
                    }
                    return null;
                },
            });
            if (!name) return;

            try {
                const config = vscode.workspace.getConfiguration('csharpsolution');
                const defaultNs = config.get<string>('defaultNamespace', '') || projectName;
                await CsprojService.addType(projectPath, dirPath, name, kind, defaultNs);
                vscode.window.showInformationMessage(`已创建${label}: ${name}.cs`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `添加${label}失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );
};
registerAddType('csharpsolution.addClass', 'class', '类');
registerAddType('csharpsolution.addInterface', 'interface', '接口');
registerAddType('csharpsolution.addEnum', 'enum', '枚举');
registerAddType('csharpsolution.addStruct', 'struct', '结构体');
```

- [ ] **Step 2: 新增 addFolder 命令**

```typescript
// --- 新建文件夹 ---
context.subscriptions.push(
    vscode.commands.registerCommand('csharpsolution.addFolder', async (node: ProjectNode) => {
        if (!node || (node.type !== 'project' && node.type !== 'folder')) return;
        if (node.type === 'folder' && isLinkedPath(node.relPath)) return;

        const projectPath = node.type === 'project' ? node.project.path : node.projectPath;
        const parentDir = node.type === 'folder' ? node.relPath : '';

        const folderName = await vscode.window.showInputBox({
            prompt: '请输入文件夹名',
            validateInput: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return '文件夹名不能为空';
                if (/[/\\:*?"<>|]/.test(trimmed)) return '文件夹名包含非法字符';
                if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(trimmed)) return '文件夹名是 Windows 保留名称';
                if (/[. ]$/.test(trimmed)) return '文件夹名不能以点或空格结尾';
                return null;
            },
        });
        if (!folderName?.trim()) return;

        try {
            await CsprojService.addFolder(projectPath, parentDir, folderName.trim());
            vscode.window.showInformationMessage(`已创建文件夹: ${folderName.trim()}`);
            vscode.commands.executeCommand('csharpsolution.refresh');
        } catch (err) {
            vscode.window.showErrorMessage(
                `新建文件夹失败: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    })
);
```

- [ ] **Step 3: 新增模块级 collectBatchNodes 辅助函数**

在 `registerFileCommands` 函数之外（文件底部）新增：

```typescript
type FileOrFolderNode = ProjectNode & ({ type: 'file' } | { type: 'folder' });

/**
 * 收集批量操作的目标节点：
 * 右键多选时 VS Code 传 (clicked, selection[])，优先 nodes；键盘触发回退 treeView.selection。
 * 过滤为 file/folder；以首个有效节点的 projectPath 为准过滤跨项目节点；
 * 可选剔除 linked 节点；后代去重（复用 dedupeDragData）。
 */
function collectBatchNodes(
    node: ProjectNode | undefined,
    nodes: ProjectNode[] | undefined,
    treeView: vscode.TreeView<ProjectNode>,
    options: { excludeLinked: boolean }
): FileOrFolderNode[] {
    const raw: ProjectNode[] = (nodes && nodes.length > 0)
        ? nodes
        : (node ? [node] : [...treeView.selection]);

    let targets = raw.filter(
        (n): n is FileOrFolderNode => n.type === 'file' || n.type === 'folder'
    );
    if (targets.length === 0) return [];

    const projectPath = targets[0].projectPath;
    targets = targets.filter(n => n.projectPath === projectPath);

    if (options.excludeLinked) {
        targets = targets.filter(
            n => !isLinkedPath(n.type === 'file' ? n.compile.include : n.relPath)
        );
    }

    // 后代去重：文件夹与其子项同选时只保留文件夹
    const asDrag: DragNodeData[] = targets.map(n => ({
        type: n.type,
        projectPath: n.projectPath,
        nodePath: n.type === 'file' ? n.compile.include : n.relPath,
    }));
    const keep = new Set(
        dedupeDragData(asDrag).map(d => `${d.type}:${d.nodePath.replace(/\\/g, '/')}`)
    );
    return targets.filter(n => {
        const p = (n.type === 'file' ? n.compile.include : n.relPath).replace(/\\/g, '/');
        return keep.has(`${n.type}:${p}`);
    });
}
```

- [ ] **Step 4: 改造 deleteFile 支持多选**

将现有 `--- 删除文件/文件夹 ---` 块替换为（单目标分支保留原提示语与流程，批量走汇总确认）：

```typescript
// --- 删除文件/文件夹（支持多选批量）---
context.subscriptions.push(
    vscode.commands.registerCommand('csharpsolution.deleteFile', async (node?: ProjectNode, nodes?: ProjectNode[]) => {
        const targets = collectBatchNodes(node, nodes, treeView, { excludeLinked: true });
        if (targets.length === 0) return;

        const project = treeProvider.allProjects.find(p => p.path === targets[0].projectPath);
        if (!project) {
            vscode.window.showErrorMessage('未找到项目，请刷新后重试');
            return;
        }

        // --- 单目标：保留原有确认语 ---
        if (targets.length === 1) {
            const t = targets[0];
            if (t.type === 'file') {
                const fileName = path.basename(t.compile.include);
                const confirm = await vscode.window.showWarningMessage(
                    `确定要删除 "${fileName}" 吗？\n文件将移至回收站，并从项目中移除。`,
                    { modal: true },
                    '确定删除'
                );
                if (confirm !== '确定删除') return;
                try {
                    await FileService.deleteFile(t.projectPath, t.compile);
                    vscode.window.showInformationMessage(`已删除: ${fileName}`);
                    vscode.commands.executeCommand('csharpsolution.refresh');
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `删除失败: ${err instanceof Error ? err.message : String(err)}`
                    );
                }
                return;
            }

            const folderName = path.basename(t.relPath);
            const normalizedFolder = t.relPath.replace(/\\/g, '/');
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
                await FileService.deleteFolder(t.projectPath, t.relPath, project.compiles);
                vscode.window.showInformationMessage(`已删除文件夹: ${folderName}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `删除失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
            return;
        }

        // --- 批量 ---
        const fileCount = targets.filter(t => t.type === 'file').length;
        const folderCount = targets.filter(t => t.type === 'folder').length;
        const parts: string[] = [];
        if (fileCount > 0) parts.push(`${fileCount} 个文件`);
        if (folderCount > 0) parts.push(`${folderCount} 个文件夹`);

        const confirm = await vscode.window.showWarningMessage(
            `确定要删除选中的 ${parts.join('和')} 吗？\n将移至回收站，并从项目中移除。`,
            { modal: true },
            '确定删除'
        );
        if (confirm !== '确定删除') return;

        let ok = 0;
        let fail = 0;
        for (const t of targets) {
            try {
                if (t.type === 'file') {
                    await FileService.deleteFile(t.projectPath, t.compile);
                } else {
                    await FileService.deleteFolder(t.projectPath, t.relPath, project.compiles);
                }
                ok++;
            } catch (err) {
                fail++;
                vscode.window.showErrorMessage(
                    `删除失败: ${t.type === 'file' ? t.compile.include : t.relPath}\n` +
                    `${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
        if (ok > 0) {
            vscode.window.showInformationMessage(
                `已删除 ${ok} 个项目${fail > 0 ? `，失败 ${fail} 个` : ''}`
            );
            vscode.commands.executeCommand('csharpsolution.refresh');
        }
    })
);
```

- [ ] **Step 5: 新增 excludeFromProject 命令**

```typescript
// --- 从项目排除（不删除物理文件，支持多选）---
context.subscriptions.push(
    vscode.commands.registerCommand('csharpsolution.excludeFromProject', async (node?: ProjectNode, nodes?: ProjectNode[]) => {
        const targets = collectBatchNodes(node, nodes, treeView, { excludeLinked: false });
        if (targets.length === 0) return;

        const project = treeProvider.allProjects.find(p => p.path === targets[0].projectPath);
        if (!project) {
            vscode.window.showErrorMessage('未找到项目，请刷新后重试');
            return;
        }

        // 展开：文件 → include；文件夹 → 前缀匹配收集条目
        const includes: string[] = [];
        const seen = new Set<string>();
        const push = (include: string) => {
            const key = include.replace(/\\/g, '/');
            if (!seen.has(key)) {
                seen.add(key);
                includes.push(include);
            }
        };
        for (const t of targets) {
            if (t.type === 'file') {
                push(t.compile.include);
            } else {
                const nf = t.relPath.replace(/\\/g, '/');
                const prefix = nf + '/';
                for (const c of project.compiles) {
                    const p = c.include.replace(/\\/g, '/');
                    if (p === nf || p.startsWith(prefix)) {
                        push(c.include);
                    }
                }
            }
        }
        if (includes.length === 0) {
            vscode.window.showInformationMessage('没有可排除的条目');
            return;
        }

        const sdkNote = project.isSdk
            ? '\n（SDK 项目通过 Compile Remove 排除，重新包含需手动编辑 .csproj）'
            : '';
        const confirm = await vscode.window.showWarningMessage(
            `将从项目排除 ${includes.length} 个条目（不删除物理文件）？${sdkNote}`,
            { modal: true },
            '确定排除'
        );
        if (confirm !== '确定排除') return;

        try {
            const n = await CsprojService.excludeFiles(project.path, includes);
            vscode.window.showInformationMessage(`已排除 ${n} 个条目`);
            vscode.commands.executeCommand('csharpsolution.refresh');
        } catch (err) {
            vscode.window.showErrorMessage(
                `排除失败: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    })
);
```

- [ ] **Step 6: renameFile 加 linked 卫语句**

`--- 重命名文件/文件夹 ---` 块的类型守卫之后加：

```typescript
if (isLinkedPath(node.type === 'file' ? node.compile.include : node.relPath)) return;
```

- [ ] **Step 7: extension.ts 开启多选**

`createTreeView` 选项加 `canSelectMany: true,`。

- [ ] **Step 8: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（112 个）

- [ ] **Step 9: Commit**

```bash
git add src/commands/fileCommands.ts src/extension.ts
git commit -m "feat: typed add commands, new folder, exclude from project, multi-select batch ops"
```

---

### Task 7: package.json 贡献点

**Files:**
- Modify: `package.json`

- [ ] **Step 1: submenus + commands**

`contributes` 新增（与 menus 平级）：

```json
"submenus": [
  { "id": "csharpsolution.addFileMenu", "label": "新增文件" }
]
```

`contributes.commands` 新增：

```json
{ "command": "csharpsolution.addInterface", "title": "添加接口..." },
{ "command": "csharpsolution.addEnum", "title": "添加枚举..." },
{ "command": "csharpsolution.addStruct", "title": "添加结构体..." },
{ "command": "csharpsolution.addFolder", "title": "新建文件夹..." },
{ "command": "csharpsolution.excludeFromProject", "title": "从项目排除" }
```

- [ ] **Step 2: 菜单矩阵**

`menus["view/item/context"]` 变更：

1. **删除**原两条 addClass 条目（`viewItem == project` navigation@1 和 `viewItem == dirFolder` navigation@1）
2. **新增**子菜单入口 + 新建文件夹 + 排除：

```json
{ "submenu": "csharpsolution.addFileMenu", "when": "view == csharpsolution-projects && viewItem == project", "group": "navigation@1" },
{ "submenu": "csharpsolution.addFileMenu", "when": "view == csharpsolution-projects && viewItem == dirFolder", "group": "navigation@1" },
{ "command": "csharpsolution.addFolder", "when": "view == csharpsolution-projects && viewItem == project", "group": "navigation@2" },
{ "command": "csharpsolution.addFolder", "when": "view == csharpsolution-projects && viewItem == dirFolder", "group": "navigation@2" },
{ "command": "csharpsolution.excludeFromProject", "when": "view == csharpsolution-projects && viewItem == file", "group": "navigation@3" },
{ "command": "csharpsolution.excludeFromProject", "when": "view == csharpsolution-projects && viewItem == dirFolder", "group": "navigation@5" },
{ "command": "csharpsolution.excludeFromProject", "when": "view == csharpsolution-projects && viewItem == linkedFile", "group": "navigation@1" },
{ "command": "csharpsolution.excludeFromProject", "when": "view == csharpsolution-projects && viewItem == linkedFolder", "group": "navigation@1" },
{ "command": "csharpsolution.revealInExplorer", "when": "view == csharpsolution-projects && viewItem == linkedFile", "group": "group4@1" },
{ "command": "csharpsolution.revealInExplorer", "when": "view == csharpsolution-projects && viewItem == linkedFolder", "group": "group4@1" },
{ "command": "csharpsolution.openInTerminal", "when": "view == csharpsolution-projects && viewItem == linkedFile", "group": "group4@2" },
{ "command": "csharpsolution.openInTerminal", "when": "view == csharpsolution-projects && viewItem == linkedFolder", "group": "group4@2" }
```

3. **调整**现有 `addExistingFile`（project）分组 `navigation@2` → `navigation@3`
4. **新增**子菜单内容段（`menus` 对象内与 `view/item/context` 平级）：

```json
"csharpsolution.addFileMenu": [
  { "command": "csharpsolution.addClass", "group": "1_add@1" },
  { "command": "csharpsolution.addInterface", "group": "1_add@2" },
  { "command": "csharpsolution.addEnum", "group": "1_add@3" },
  { "command": "csharpsolution.addStruct", "group": "1_add@4" }
]
```

注：现有 `file`/`dirFolder` 的 重命名/删除 菜单条目不动（linkedFile/linkedFolder 自然拿不到——contextValue 不同）。

- [ ] **Step 3: 校验 + 编译**

Run: `node -e "require('./package.json')" && pnpm run compile`
Expected: JSON 合法，编译通过

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: contribute addFile submenu, new commands, linked node menus"
```

---

### Task 8: 完整验证

- [ ] **Step 1: 全量编译 + 测试**

Run: `pnpm run compile && pnpm test`
Expected: 112 个测试全部通过，lint 0 error

- [ ] **Step 2: 手动验证清单**

F5 启动扩展开发宿主：

| # | 场景 | 预期 |
|---|------|------|
| 1 | project/dirFolder 右键 | 「新增文件」子菜单（类/接口/枚举/结构体）+「新建文件夹」 |
| 2 | 新增接口/枚举/结构体 | 文件内容关键字正确、csproj 注册、命名空间含目录 |
| 3 | 传统项目新建文件夹 | csproj 出现 Folder 条目、树立即显示空文件夹 |
| 4 | SDK 项目新建文件夹 | 物理目录创建、树显示空文件夹 |
| 5 | 空文件夹里新增类 | 正常创建、树不出现重复文件夹 |
| 6 | 文件/文件夹右键「从项目排除」 | 条目移除、物理文件保留 |
| 7 | SDK 项目排除 | csproj 出现 Compile Remove、树中文件消失、确认框含 SDK 提示 |
| 8 | Ctrl 多选文件+文件夹 → Delete | 单确认框汇总数量、批量删除 |
| 9 | 多选 → 右键排除 | 批量排除 |
| 10 | 多选文件夹+其子文件 → 删除 | 后代去重，只按文件夹删一次 |
| 11 | linked 文件/文件夹右键 | 只有 排除/资源管理器/终端；描述带「→ 链接」 |
| 12 | 拖拽 linked 节点 | 不可拖动（无移动发生） |
| 13 | linked 节点按 Delete/F2 | 无反应 |
| 14 | 原有功能回归 | 添加类/重命名/删除/拖拽/构建照常 |

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: address issues found in file management verification"
```
