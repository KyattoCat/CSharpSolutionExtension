# C# 老项目管理插件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 VS Code 扩展，在资源管理器新增【项目管理】面板，支持浏览/增删传统 .csproj 项目中的文件与引用。

**Architecture:** 模型驱动分层架构——模型层定义纯数据结构，序列化层处理 .csproj XML 读写（保持原有格式），服务层编排业务逻辑，视图层通过 TreeDataProvider 渲染树节点。零第三方 XML 依赖，使用 regex 行级操作保证格式不变。

**Tech Stack:** TypeScript, VS Code Extension API, Mocha + @vscode/test-electron

---

### Task 1: 数据模型定义

**Files:**
- Create: `src/models/CsprojModel.ts`
- Create: `src/models/ProjectNode.ts`

- [ ] **Step 1: 创建 CsprojModel 接口**

```typescript
// src/models/CsprojModel.ts

/** 表示一个 .csproj 项目解析后的完整数据 */
export interface CsprojProject {
    /** .csproj 文件的绝对路径 */
    path: string;
    /** 项目名称（不含 .csproj 扩展名） */
    name: string;
    compiles: CompileItem[];
    references: ReferenceItem[];
    projectReferences: ProjectReferenceItem[];
    packages: PackageItem[];
    analyzers: AnalyzerItem[];
}

export interface CompileItem {
    /** Include 属性值，相对路径，如 "Models\\User.cs" */
    include: string;
    /** Link 子元素（可选），用于链接文件 */
    link?: string;
    /** DependentUpon 子元素（可选），如 "Global.asax" */
    dependentUpon?: string;
}

export interface ReferenceItem {
    /** Include 属性值，如 "System.Data" */
    include: string;
    /** HintPath 子元素（可选） */
    hintPath?: string;
}

export interface ProjectReferenceItem {
    /** Include 属性值，相对路径 */
    include: string;
    /** Name 子元素（可选） */
    name?: string;
}

export interface PackageItem {
    /** NuGet 包 ID */
    id: string;
    /** 版本号 */
    version: string;
    /** 目标框架（可选） */
    targetFramework?: string;
}

export interface AnalyzerItem {
    /** Include 属性值 */
    include: string;
}
```

- [ ] **Step 2: 创建 ProjectNode 类型**

```typescript
// src/models/ProjectNode.ts

import { CsprojProject, CompileItem, ReferenceItem, ProjectReferenceItem, PackageItem, AnalyzerItem } from './CsprojModel';

/** 树节点联合类型 —— 每种节点携带自身所需数据 */
export type ProjectNode =
    | { type: 'project'; project: CsprojProject }
    | { type: 'refGroup'; projectPath: string }
    | { type: 'refSubGroup'; label: string; projectPath: string }
    | { type: 'reference'; item: ReferenceItem; projectPath: string }
    | { type: 'projectRef'; item: ProjectReferenceItem; projectPath: string }
    | { type: 'package'; item: PackageItem; projectPath: string }
    | { type: 'analyzer'; item: AnalyzerItem; projectPath: string }
    | { type: 'folder'; relPath: string; projectPath: string }
    | { type: 'file'; compile: CompileItem; projectPath: string };
```

- [ ] **Step 3: 编译验证**

```bash
npx tsc -p ./tsconfig.json --noEmit
```

Expected: 编译通过，无类型错误。

- [ ] **Step 4: Commit**

```bash
git add src/models/CsprojModel.ts src/models/ProjectNode.ts
git commit -m "feat: add data model interfaces and tree node types"
```

---

### Task 2: CsprojSerializer — 解析 Compile

**Files:**
- Create: `src/serialization/CsprojSerializer.ts`
- Create: `src/test/CsprojSerializer.test.ts`

- [ ] **Step 1: 编写解析 Compile 的失败测试**

```typescript
// src/test/CsprojSerializer.test.ts
import * as assert from 'assert';
import { CsprojSerializer } from '../../serialization/CsprojSerializer';

suite('CsprojSerializer — parse', () => {

    test('解析 Compile 元素（自闭合标签）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Program.cs" />
    <Compile Include="Models\\User.cs" />
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.compiles.length, 2);
        assert.strictEqual(project.compiles[0].include, 'Program.cs');
        assert.strictEqual(project.compiles[1].include, 'Models\\User.cs');
    });

    test('解析 Compile 元素（带子元素）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Global.asax.cs">
      <DependentUpon>Global.asax</DependentUpon>
    </Compile>
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.compiles.length, 1);
        assert.strictEqual(project.compiles[0].include, 'Global.asax.cs');
        assert.strictEqual(project.compiles[0].dependentUpon, 'Global.asax');
    });

    test('解析 Compile 带 Link 子元素', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="..\\Shared\\Common.cs">
      <Link>Shared\\Common.cs</Link>
    </Compile>
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.compiles[0].link, 'Shared\\Common.cs');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vscode-test --test-path out/test/CsprojSerializer.test.js
```

Expected: FAIL — `CsprojSerializer.parse is not a function`

- [ ] **Step 3: 实现 parse 方法（Compile 部分）**

```typescript
// src/serialization/CsprojSerializer.ts
import { CsprojProject, CompileItem, ReferenceItem, ProjectReferenceItem, PackageItem, AnalyzerItem } from '../models/CsprojModel';
import * as path from 'path';

export class CsprojSerializer {

    /**
     * 解析 .csproj 文件内容为 CsprojProject 模型。
     * 使用正则表达式逐类提取，不依赖外部 XML 库。
     */
    static parse(xml: string, filePath: string): CsprojProject {
        const name = path.basename(filePath, '.csproj');

        return {
            path: filePath,
            name,
            compiles: this.parseCompiles(xml),
            references: this.parseReferences(xml),
            projectReferences: this.parseProjectReferences(xml),
            packages: [],    // packages 由 PackagesConfigSerializer 处理
            analyzers: this.parseAnalyzers(xml),
        };
    }

    /** 解析所有 <Compile Include="..."> 元素，支持自闭合和带子元素两种形式 */
    static parseCompiles(xml: string): CompileItem[] {
        const results: CompileItem[] = [];

        // 匹配带子元素的 Compile（</Compile> 闭合）
        const withChildrenRegex = /<Compile\s+Include="([^"]*)"\s*>([\s\S]*?)<\/Compile>/g;
        const matchedPositions = new Set<number>();

        let match: RegExpExecArray | null;
        while ((match = withChildrenRegex.exec(xml)) !== null) {
            const include = match[1];
            const inner = match[2];
            const item: CompileItem = { include };

            const linkMatch = inner.match(/<Link>([\s\S]*?)<\/Link>/);
            if (linkMatch) {
                item.link = linkMatch[1].trim();
            }

            const dependentUponMatch = inner.match(/<DependentUpon>([\s\S]*?)<\/DependentUpon>/);
            if (dependentUponMatch) {
                item.dependentUpon = dependentUponMatch[1].trim();
            }

            results.push(item);
            matchedPositions.add(match.index);
        }

        // 匹配自闭合的 Compile（以 /> 结束），排除已匹配的位置
        const selfClosingRegex = /<Compile\s+Include="([^"]*)"\s*\/>/g;
        while ((match = selfClosingRegex.exec(xml)) !== null) {
            if (!matchedPositions.has(match.index)) {
                results.push({ include: match[1] });
            }
        }

        return results;
    }

    /** 解析 <Reference Include="..."> 元素 */
    static parseReferences(xml: string): ReferenceItem[] {
        const results: ReferenceItem[] = [];
        const regex = /<Reference\s+Include="([^"]*)"\s*>([\s\S]*?)<\/Reference>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
            const item: ReferenceItem = { include: match[1] };
            const hintMatch = match[2].match(/<HintPath>([\s\S]*?)<\/HintPath>/);
            if (hintMatch) {
                item.hintPath = hintMatch[1].trim();
            }
            results.push(item);
        }
        return results;
    }

    /** 解析 <ProjectReference Include="..."> 元素 */
    static parseProjectReferences(xml: string): ProjectReferenceItem[] {
        const results: ProjectReferenceItem[] = [];
        const regex = /<ProjectReference\s+Include="([^"]*)"\s*>([\s\S]*?)<\/ProjectReference>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
            const item: ProjectReferenceItem = { include: match[1] };
            const nameMatch = match[2].match(/<Name>([\s\S]*?)<\/Name>/);
            if (nameMatch) {
                item.name = nameMatch[1].trim();
            }
            results.push(item);
        }
        return results;
    }

    /** 解析 <Analyzer Include="..."> 元素 */
    static parseAnalyzers(xml: string): AnalyzerItem[] {
        const results: AnalyzerItem[] = [];
        const regex = /<Analyzer\s+Include="([^"]*)"\s*\/?>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
            results.push({ include: match[1] });
        }
        return results;
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vscode-test --test-path out/test/CsprojSerializer.test.js
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/serialization/CsprojSerializer.ts src/test/CsprojSerializer.test.ts
git commit -m "feat: add CsprojSerializer with Compile/Reference/ProjectReference/Analyzer parsing"
```

---

### Task 3: CsprojSerializer — 添加与移除 Compile

**Files:**
- Modify: `src/serialization/CsprojSerializer.ts`
- Modify: `src/test/CsprojSerializer.test.ts`

- [ ] **Step 1: 编写添加/移除 Compile 的测试**

在 `src/test/CsprojSerializer.test.ts` 末尾追加：

```typescript
    test('添加 Compile 到已有 ItemGroup', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Program.cs" />
    <Compile Include="Models\\User.cs" />
  </ItemGroup>
</Project>`;
        const result = CsprojSerializer.addCompile(xml, 'Models\\Order.cs');
        // 新元素应插入到最后一个 Compile 之后
        assert.ok(result.includes('<Compile Include="Models\\Order.cs" />'));
        // 原有内容不变
        assert.ok(result.includes('<Compile Include="Program.cs" />'));
        assert.ok(result.includes('<Compile Include="Models\\User.cs" />'));
        // 验证顺序：User.cs 在 Order.cs 之前
        const userIndex = result.indexOf('User.cs');
        const orderIndex = result.indexOf('Order.cs');
        assert.ok(userIndex < orderIndex);
    });

    test('移除自闭合 Compile 元素', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Program.cs" />
    <Compile Include="Models\\User.cs" />
  </ItemGroup>
</Project>`;
        const result = CsprojSerializer.removeCompile(xml, 'Models\\User.cs');
        assert.ok(!result.includes('User.cs'));
        assert.ok(result.includes('Program.cs'));
    });

    test('移除带子元素的 Compile', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Global.asax.cs">
      <DependentUpon>Global.asax</DependentUpon>
    </Compile>
  </ItemGroup>
</Project>`;
        const result = CsprojSerializer.removeCompile(xml, 'Global.asax.cs');
        assert.ok(!result.includes('Global.asax.cs'));
        assert.ok(!result.includes('DependentUpon'));
    });

    test('添加到没有 Compile 的项目（创建 ItemGroup）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <TargetFramework>net48</TargetFramework>
  </PropertyGroup>
  <Import Project="$(MSBuildToolsPath)\\Microsoft.CSharp.targets" />
</Project>`;
        const result = CsprojSerializer.addCompile(xml, 'NewFile.cs');
        assert.ok(result.includes('<Compile Include="NewFile.cs" />'));
        assert.ok(result.includes('<ItemGroup>'));
    });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vscode-test --test-path out/test/CsprojSerializer.test.js
```

Expected: 3 个新增测试 FAIL（`addCompile is not a function`）

- [ ] **Step 3: 实现 addCompile 和 removeCompile**

在 `CsprojSerializer` 类中追加：

```typescript
    /**
     * 向 .csproj 内容中添加一个 <Compile Include="..."> 元素。
     * 策略：找到最后一个已有 Compile 的位置，在其后插入新行。
     * 如果项目中尚无 Compile，则在 </Project> 之前创建 ItemGroup。
     */
    static addCompile(xml: string, include: string): string {
        const newLine = `    <Compile Include="${include}" />`;

        // 查找所有 Compile Include 行
        const compileRegex = /^\s*<Compile\s+Include="[^"]*"/gm;
        const matches = [...xml.matchAll(compileRegex)];

        if (matches.length > 0) {
            // 找到最后一个 Compile 块的结束位置
            const lastMatch = matches[matches.length - 1];
            const startIndex = lastMatch.index!;

            // 查找这个 Compile 元素的结束位置（/> 或 </Compile>）
            const rest = xml.slice(startIndex);
            const selfCloseEnd = rest.indexOf('/>');
            const closeTagEnd = rest.indexOf('</Compile>');

            let insertPos: number;
            if (selfCloseEnd !== -1 && (closeTagEnd === -1 || selfCloseEnd < closeTagEnd)) {
                insertPos = startIndex + selfCloseEnd + 2; // 跳过 />
            } else {
                insertPos = startIndex + closeTagEnd + '</Compile>'.length;
            }

            // 跳到该行末尾（下一个换行符之后）
            const newlineAfter = xml.indexOf('\n', insertPos);
            insertPos = newlineAfter !== -1 ? newlineAfter + 1 : xml.length;

            return xml.slice(0, insertPos) + newLine + '\n' + xml.slice(insertPos);
        }

        // 无 Compile —— 在 </Project> 前创建 ItemGroup
        const projectClose = xml.lastIndexOf('</Project>');
        const itemGroup = `  <ItemGroup>\n${newLine}\n  </ItemGroup>\n`;
        if (projectClose !== -1) {
            return xml.slice(0, projectClose) + itemGroup + xml.slice(projectClose);
        }
        return xml + '\n' + itemGroup;
    }

    /**
     * 从 .csproj 内容中移除指定 Include 的 <Compile> 元素。
     * 同时处理自闭合和带子元素两种形式。
     */
    static removeCompile(xml: string, include: string): string {
        // 转义 include 路径中的反斜杠用于正则
        const escaped = include.replace(/\\/g, '\\\\');

        // 先尝试匹配带子元素形式
        const withChildren = new RegExp(
            `\\s*<Compile\\s+Include="${escaped}"\\s*>[\\s\\S]*?<\\/Compile>\\s*\\n?`,
            'g'
        );
        if (withChildren.test(xml)) {
            withChildren.lastIndex = 0;
            const result = xml.replace(withChildren, '');
            if (result !== xml) {
                return result;
            }
        }

        // 再尝试自闭合形式
        const selfClosing = new RegExp(
            `\\s*<Compile\\s+Include="${escaped}"\\s*\\/>\\s*\\n?`,
            'g'
        );
        return xml.replace(selfClosing, '');
    }
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vscode-test --test-path out/test/CsprojSerializer.test.js
```

Expected: 全部 6 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/serialization/CsprojSerializer.ts src/test/CsprojSerializer.test.ts
git commit -m "feat: add addCompile and removeCompile to CsprojSerializer"
```

---

### Task 4: PackagesConfigSerializer

**Files:**
- Create: `src/serialization/PackagesConfigSerializer.ts`
- Create: `src/test/PackagesConfigSerializer.test.ts`

- [ ] **Step 1: 编写 packages.config 解析测试**

```typescript
// src/test/PackagesConfigSerializer.test.ts
import * as assert from 'assert';
import { PackagesConfigSerializer } from '../../serialization/PackagesConfigSerializer';

suite('PackagesConfigSerializer', () => {

    test('解析 packages.config', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Newtonsoft.Json" version="13.0.1" targetFramework="net48" />
  <package id="EntityFramework" version="6.4.4" targetFramework="net48" />
</packages>`;
        const packages = PackagesConfigSerializer.parse(xml);
        assert.strictEqual(packages.length, 2);
        assert.strictEqual(packages[0].id, 'Newtonsoft.Json');
        assert.strictEqual(packages[0].version, '13.0.1');
        assert.strictEqual(packages[0].targetFramework, 'net48');
        assert.strictEqual(packages[1].id, 'EntityFramework');
    });

    test('移除 package', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="A" version="1.0.0" />
  <package id="B" version="2.0.0" />
</packages>`;
        const result = PackagesConfigSerializer.removePackage(xml, 'A');
        assert.ok(!result.includes('id="A"'));
        assert.ok(result.includes('id="B"'));
    });

    test('解析空 packages.config', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<packages>
</packages>`;
        const packages = PackagesConfigSerializer.parse(xml);
        assert.strictEqual(packages.length, 0);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vscode-test --test-path out/test/PackagesConfigSerializer.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: 实现 PackagesConfigSerializer**

```typescript
// src/serialization/PackagesConfigSerializer.ts
import { PackageItem } from '../models/CsprojModel';

export class PackagesConfigSerializer {

    /** 解析 packages.config 内容，提取所有 NuGet 包引用 */
    static parse(xml: string): PackageItem[] {
        const results: PackageItem[] = [];
        const regex = /<package\s+id="([^"]*)"\s+version="([^"]*)"(?:\s+targetFramework="([^"]*)")?\s*\/>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
            const item: PackageItem = {
                id: match[1],
                version: match[2],
            };
            if (match[3]) {
                item.targetFramework = match[3];
            }
            results.push(item);
        }
        return results;
    }

    /** 从 packages.config 内容中移除指定 ID 的 <package> 元素 */
    static removePackage(xml: string, packageId: string): string {
        const regex = new RegExp(
            `\\s*<package\\s+id="${packageId}"\\s+version="[^"]*"[^>]*\\/>\\s*\\n?`,
            'g'
        );
        return xml.replace(regex, '');
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vscode-test --test-path out/test/PackagesConfigSerializer.test.js
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/serialization/PackagesConfigSerializer.ts src/test/PackagesConfigSerializer.test.ts
git commit -m "feat: add PackagesConfigSerializer for reading/removing NuGet packages"
```

---

### Task 5: FileTemplateService

**Files:**
- Create: `src/services/FileTemplateService.ts`
- Create: `src/test/FileTemplateService.test.ts`

- [ ] **Step 1: 编写 FileTemplateService 测试**

```typescript
// src/test/FileTemplateService.test.ts
import * as assert from 'assert';
import { FileTemplateService } from '../../services/FileTemplateService';

suite('FileTemplateService', () => {

    test('生成类文件内容，替换命名空间和类名', () => {
        const template = [
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
        ];
        const result = FileTemplateService.generate('MyApp.Models', 'User', template);
        assert.ok(result.includes('namespace MyApp.Models'));
        assert.ok(result.includes('public class User'));
    });

    test('推断命名空间：根命名空间 + 子目录', () => {
        const ns = FileTemplateService.inferNamespace('MyApp', 'Models\\Entities');
        assert.strictEqual(ns, 'MyApp.Models.Entities');
    });

    test('推断命名空间：仅有根命名空间（根目录）', () => {
        const ns = FileTemplateService.inferNamespace('MyApp', '');
        assert.strictEqual(ns, 'MyApp');
    });

    test('验证合法类名', () => {
        assert.ok(FileTemplateService.isValidClassName('User'));
        assert.ok(FileTemplateService.isValidClassName('_MyClass'));
        assert.ok(FileTemplateService.isValidClassName('MyClass123'));
        assert.ok(!FileTemplateService.isValidClassName('123Invalid'));
        assert.ok(!FileTemplateService.isValidClassName('class'));
        assert.ok(!FileTemplateService.isValidClassName('my-class'));
    });

    test('验证合法类名：空字符串、空格', () => {
        assert.ok(!FileTemplateService.isValidClassName(''));
        assert.ok(!FileTemplateService.isValidClassName('   '));
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vscode-test --test-path out/test/FileTemplateService.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: 实现 FileTemplateService**

```typescript
// src/services/FileTemplateService.ts

export class FileTemplateService {

    /** 根据模板生成 C# 类文件内容 */
    static generate(
        namespace: string,
        className: string,
        template: string[]
    ): string {
        return template
            .map(line =>
                line.replace(/\{namespace\}/g, namespace)
                    .replace(/\{className\}/g, className)
            )
            .join('\n');
    }

    /**
     * 根据根命名空间和相对目录推断完整命名空间。
     * 例: inferNamespace('MyApp', 'Models\\Entities') → 'MyApp.Models.Entities'
     */
    static inferNamespace(rootNamespace: string, dirPath: string): string {
        if (!dirPath) {
            return rootNamespace;
        }
        const nsPart = dirPath.replace(/[\\\/]/g, '.');
        return `${rootNamespace}.${nsPart}`;
    }

    /**
     * 验证类名是否合法。
     * 规则: 非空、首字符为字母或下划线、其余为字母数字下划线、不是 C# 关键字。
     */
    static isValidClassName(name: string): boolean {
        const trimmed = name.trim();
        if (!trimmed) {
            return false;
        }
        // C# 标识符：首字符为字母或 _，其余为字母数字或 _
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
            return false;
        }
        // 排除 C# 关键字
        const keywords = new Set([
            'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch',
            'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default',
            'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern',
            'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if',
            'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock', 'long',
            'namespace', 'new', 'null', 'object', 'operator', 'out', 'override',
            'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return',
            'sbyte', 'sealed', 'short', 'sizeof', 'stackalloc', 'static', 'string',
            'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'uint',
            'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void',
            'volatile', 'while',
        ]);
        return !keywords.has(trimmed);
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vscode-test --test-path out/test/FileTemplateService.test.js
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/FileTemplateService.ts src/test/FileTemplateService.test.ts
git commit -m "feat: add FileTemplateService for class generation and validation"
```

---

### Task 6: ProjectDiscovery

**Files:**
- Create: `src/services/ProjectDiscovery.ts`

注意：`ProjectDiscovery` 依赖 VS Code API（`vscode.workspace.findFiles`），因此其测试为集成测试。这里先实现服务本身，测试在 Task 10 中作为集成测试完成。

- [ ] **Step 1: 实现 ProjectDiscovery**

```typescript
// src/services/ProjectDiscovery.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojProject } from '../models/CsprojModel';
import { CsprojSerializer } from '../serialization/CsprojSerializer';
import { PackagesConfigSerializer } from '../serialization/PackagesConfigSerializer';

export class ProjectDiscovery {

    /** 默认排除目录 */
    private static readonly DEFAULT_EXCLUDE = [
        '**/node_modules/**',
        '**/bin/**',
        '**/obj/**',
    ];

    /**
     * 扫描工作区中所有 .csproj 文件，解析后返回 CsprojProject 数组。
     * @param extraExcludes 用户配置的额外排除模式
     */
    static async scan(extraExcludes: string[] = []): Promise<CsprojProject[]> {
        const allExcludes = [...this.DEFAULT_EXCLUDE, ...extraExcludes];

        // 查找所有 .csproj 文件
        const uris = await vscode.workspace.findFiles('**/*.csproj', `{${allExcludes.join(',')}}`);

        const projects: CsprojProject[] = [];

        for (const uri of uris) {
            try {
                const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
                const project = CsprojSerializer.parse(content, uri.fsPath);

                // 尝试读取 packages.config
                const pkgConfigPath = path.join(path.dirname(uri.fsPath), 'packages.config');
                try {
                    const pkgContent = await fs.promises.readFile(pkgConfigPath, 'utf-8');
                    project.packages = PackagesConfigSerializer.parse(pkgContent);
                } catch {
                    // packages.config 不存在，保持空数组
                    project.packages = [];
                }

                projects.push(project);
            } catch (err) {
                vscode.window.showErrorMessage(
                    `解析项目失败: ${uri.fsPath} — ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }

        return projects;
    }

    /** 获取 packages.config 的文件路径（如果存在） */
    static getPackagesConfigPath(projectPath: string): string {
        return path.join(path.dirname(projectPath), 'packages.config');
    }
}
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc -p ./tsconfig.json --noEmit
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/services/ProjectDiscovery.ts
git commit -m "feat: add ProjectDiscovery for workspace .csproj scanning"
```

---

### Task 7: CsprojService

**Files:**
- Create: `src/services/CsprojService.ts`

`CsprojService` 作为纯编排层，不直接操作 VS Code API（文件读写通过传入的 workspace 能力）。这样可以在单元测试中 mock。

- [ ] **Step 1: 实现 CsprojService**

```typescript
// src/services/CsprojService.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CsprojSerializer } from '../serialization/CsprojSerializer';
import { PackagesConfigSerializer } from '../serialization/PackagesConfigSerializer';
import { FileTemplateService } from './FileTemplateService';
import { CompileItem } from '../models/CsprojModel';

export class CsprojService {

    /**
     * 在项目中添加一个新的 C# 类文件。
     * @returns 创建的 .cs 文件 URI
     */
    static async addClass(
        projectPath: string,
        dirPath: string,
        className: string,
        rootNamespace: string,
        classTemplate: string[]
    ): Promise<vscode.Uri> {
        // 1. 验证类名
        if (!FileTemplateService.isValidClassName(className)) {
            throw new Error(`无效的类名: "${className}"。类名必须为合法的 C# 标识符。`);
        }

        // 2. 计算文件路径
        const projectDir = path.dirname(projectPath);
        const fileRelPath = dirPath
            ? path.join(dirPath, `${className}.cs`)
            : `${className}.cs`;
        const fileAbsPath = path.join(projectDir, fileRelPath);
        const fileUri = vscode.Uri.file(fileAbsPath);

        // 3. 检查文件是否已存在
        try {
            await fs.promises.access(fileAbsPath);
            throw new Error(`文件已存在: ${fileRelPath}`);
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('文件已存在')) {
                throw err;
            }
            // 文件不存在，继续
        }

        // 4. 生成类内容
        const namespace = rootNamespace || path.basename(projectPath, '.csproj');
        const fullNs = FileTemplateService.inferNamespace(namespace, dirPath);
        const classContent = FileTemplateService.generate(fullNs, className, classTemplate);

        // 5. 创建目录（如果不存在）
        const targetDir = path.dirname(fileAbsPath);
        await fs.promises.mkdir(targetDir, { recursive: true });

        // 6. 写入 .cs 文件
        await fs.promises.writeFile(fileAbsPath, classContent, 'utf-8');

        // 7. 更新 .csproj
        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const updatedContent = CsprojSerializer.addCompile(csprojContent, fileRelPath);
        await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');

        return fileUri;
    }

    /**
     * 删除文件：从 .csproj 移除 Compile 条目，并将物理文件移至回收站。
     */
    static async deleteFile(
        projectPath: string,
        compileItem: CompileItem
    ): Promise<void> {
        // 1. 从 .csproj 移除
        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const updatedContent = CsprojSerializer.removeCompile(csprojContent, compileItem.include);
        await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');

        // 2. 删除物理文件（移至回收站）
        const projectDir = path.dirname(projectPath);
        const filePath = path.join(projectDir, compileItem.include);
        const fileUri = vscode.Uri.file(filePath);
        try {
            await vscode.workspace.fs.delete(fileUri, { useTrash: true });
        } catch (err) {
            // 文件可能已被删除，仅记录
            console.warn(`删除文件失败: ${filePath}`, err);
        }
    }

    /**
     * 添加现有文件到项目：复制文件到项目目录，并加入 Compile。
     */
    static async addExistingFile(
        projectPath: string,
        sourceFileUri: vscode.Uri
    ): Promise<void> {
        const projectDir = path.dirname(projectPath);
        const sourceFileName = path.basename(sourceFileUri.fsPath);
        const destPath = path.join(projectDir, sourceFileName);

        // 1. 复制文件
        const sourceContent = await fs.promises.readFile(sourceFileUri.fsPath);
        await fs.promises.writeFile(destPath, sourceContent);

        // 2. 更新 .csproj
        const csprojContent = await fs.promises.readFile(projectPath, 'utf-8');
        const updatedContent = CsprojSerializer.addCompile(csprojContent, sourceFileName);
        await fs.promises.writeFile(projectPath, updatedContent, 'utf-8');
    }

    /**
     * 从 packages.config 中移除 NuGet 包引用。
     */
    static async removePackage(
        projectPath: string,
        packageId: string
    ): Promise<void> {
        const pkgConfigPath = path.join(path.dirname(projectPath), 'packages.config');

        try {
            const content = await fs.promises.readFile(pkgConfigPath, 'utf-8');
            const updated = PackagesConfigSerializer.removePackage(content, packageId);
            await fs.promises.writeFile(pkgConfigPath, updated, 'utf-8');
        } catch (err) {
            throw new Error(`移除包失败: ${packageId} — ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc -p ./tsconfig.json --noEmit
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/services/CsprojService.ts
git commit -m "feat: add CsprojService for add/delete file and NuGet package operations"
```

---

### Task 8: ProjectTreeProvider

**Files:**
- Create: `src/tree/ProjectTreeProvider.ts`

- [ ] **Step 1: 实现 ProjectTreeProvider**

```typescript
// src/tree/ProjectTreeProvider.ts
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
                    node.projectPath
                );
            case 'projectRef':
                return this.leafTreeItem(
                    `🔗 ${node.item.name || path.basename(node.item.include, '.csproj')}`,
                    node.item.include,
                    node.projectPath
                );
            case 'package':
                return this.leafTreeItem(
                    `📦 ${node.item.id} v${node.item.version}`,
                    node.item.targetFramework || '',
                    node.projectPath
                );
            case 'analyzer':
                return this.leafTreeItem(
                    `⚙ ${path.basename(node.item.include)}`,
                    node.item.include,
                    node.projectPath
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
            // 根级别：返回所有项目
            if (this.projects.length === 0) {
                return undefined; // 触发空状态消息
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

    /** 获取空状态消息 */
    getParent(): undefined { return undefined; }

    // --- 私有方法 ---

    private projectTreeItem(project: CsprojProject): vscode.TreeItem {
        const item = new vscode.TreeItem(
            `📦 ${project.name}`,
            vscode.TreeItemCollapsibleState.Expanded
        );
        item.contextValue = 'project';
        item.tooltip = project.path;
        item.description = path.relative(
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
            project.path
        );
        return item;
    }

    private folderTreeItem(label: string, collapsible: vscode.TreeItemCollapsibleState): vscode.TreeItem {
        const item = new vscode.TreeItem(`📂 ${label}`, collapsible);
        item.contextValue = 'folder';
        return item;
    }

    private leafTreeItem(label: string, tooltip: string, projectPath: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.tooltip = tooltip;
        item.contextValue = this.getLeafContext(item);
        return item;
    }

    private getLeafContext(item: vscode.TreeItem): string {
        if (item.label?.startsWith('📦')) return 'package';
        return 'reference';
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

        // 引用分组
        const hasRefs = project.references.length > 0
            || project.projectReferences.length > 0
            || project.packages.length > 0
            || project.analyzers.length > 0;

        if (hasRefs) {
            children.push({ type: 'refGroup', projectPath: project.path });
        }

        // 文件树：从 compiles 构建目录结构
        const folderMap = this.buildFolderTree(project.compiles, project.path);
        children.push(...folderMap);

        return children;
    }

    private getRefChildren(projectPath: string): ProjectNode[] {
        // 读取当前项目数据来获取引用
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
                    type: 'projectRef' as const,
                    item,
                    projectPath: node.projectPath,
                }));
            case '程序集引用':
                return project.references.map(item => ({
                    type: 'reference' as const,
                    item,
                    projectPath: node.projectPath,
                }));
            case 'NuGet 包':
                return project.packages.map(item => ({
                    type: 'package' as const,
                    item,
                    projectPath: node.projectPath,
                }));
            case '分析器':
                return project.analyzers.map(item => ({
                    type: 'analyzer' as const,
                    item,
                    projectPath: node.projectPath,
                }));
            default:
                return [];
        }
    }

    /**
     * 从 Compile 数组构建文件/文件夹节点树。
     * 按目录聚合：Models/User.cs → folder "Models" → file "User.cs"
     */
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

        // 根级文件
        for (const compile of rootFiles) {
            result.push({ type: 'file', compile, projectPath });
        }

        // 文件夹及其包含的文件、子文件夹
        for (const [folderRelPath, folderFiles] of folderMap) {
            result.push({ type: 'folder', relPath: folderRelPath, projectPath });
        }

        return result;
    }

    private getFolderChildren(node: ProjectNode & { type: 'folder' }): ProjectNode[] {
        const project = this.projects.find(p => p.path === node.projectPath);
        if (!project) return [];

        const folderPrefix = node.relPath + '/';
        const folderPrefixAlt = node.relPath + '\\';

        // 直接位于该文件夹下的文件
        const directFiles = project.compiles.filter(c => {
            const dir = path.dirname(c.include).replace(/\\/g, '/');
            return dir === node.relPath.replace(/\\/g, '/');
        });

        // 直接子文件夹（更深一层）
        const subFolders = new Set<string>();
        for (const compile of project.compiles) {
            const dir = path.dirname(compile.include).replace(/\\/g, '/');
            if (dir.startsWith(folderPrefix) && dir !== node.relPath.replace(/\\/g, '/')) {
                const relative = dir.slice(folderPrefix.length);
                const firstSegment = relative.split('/')[0];
                if (firstSegment) {
                    subFolders.add(node.relPath.replace(/\\/g, '/') + '/' + firstSegment);
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
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc -p ./tsconfig.json --noEmit
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/tree/ProjectTreeProvider.ts
git commit -m "feat: add ProjectTreeProvider for Explorer tree view"
```

---

### Task 9: extension.ts 入口

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: 实现 extension.ts**

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/ProjectTreeProvider';
import { ProjectDiscovery } from './services/ProjectDiscovery';
import { CsprojService } from './services/CsprojService';
import { FileTemplateService } from './services/FileTemplateService';
import { ProjectNode } from './models/ProjectNode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('C# Project Manager extension activated');

    // 创建 TreeDataProvider
    const treeProvider = new ProjectTreeProvider();

    // 注册 TreeView
    const treeView = vscode.window.createTreeView('csharpsolution-projects', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });

    // 空状态消息
    treeView.message = '扫描中...';
    context.subscriptions.push(treeView);

    // --- 命令注册 ---

    // 刷新面板
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.refresh', async () => {
            treeView.message = '扫描中...';
            const config = vscode.workspace.getConfiguration('csharpsolution');
            const excludes = config.get<string[]>('excludePatterns', []);
            const projects = await ProjectDiscovery.scan(excludes);
            treeProvider.refresh(projects);
            treeView.message = projects.length === 0 ? '未发现 C# 项目' : undefined;
        })
    );

    // 添加类
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addClass', async (node: ProjectNode) => {
            if (!node || (node.type !== 'project' && node.type !== 'folder')) {
                return;
            }

            const projectPath = node.projectPath;
            const dirPath = node.type === 'folder' ? node.relPath : '';
            const projectName = path.basename(projectPath, '.csproj');

            // 弹出输入框
            const className = await vscode.window.showInputBox({
                prompt: '请输入类名',
                placeHolder: 'NewClass',
                validateInput: (value) => {
                    if (!FileTemplateService.isValidClassName(value)) {
                        if (!value.trim()) return '类名不能为空';
                        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
                            return '类名必须为合法的 C# 标识符';
                        }
                        return `"${value}" 是 C# 关键字，不能用作类名`;
                    }
                    return null;
                },
            });

            if (!className) return; // 用户取消

            try {
                const config = vscode.workspace.getConfiguration('csharpsolution');
                const defaultNs = config.get<string>('defaultNamespace', '') || projectName;
                const template = config.get<string[]>('classTemplate', getDefaultTemplate());

                await CsprojService.addClass(projectPath, dirPath, className, defaultNs, template);
                vscode.window.showInformationMessage(`已创建类: ${className}.cs`);
                // 刷新面板
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `添加类失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // 删除文件
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.deleteFile', async (node: ProjectNode) => {
            if (!node || node.type !== 'file') return;

            const fileName = path.basename(node.compile.include);
            const confirm = await vscode.window.showWarningMessage(
                `确定要删除 "${fileName}" 吗？\n文件将移至回收站，并从项目中移除。`,
                { modal: true },
                '确定删除'
            );

            if (confirm !== '确定删除') return;

            try {
                await CsprojService.deleteFile(node.projectPath, node.compile);
                vscode.window.showInformationMessage(`已删除: ${fileName}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `删除失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // 添加现有文件
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.addExistingFile', async (node: ProjectNode) => {
            if (!node || node.type !== 'project') return;

            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: '选择 C# 文件',
                filters: { 'C# 文件': ['cs'] },
            });

            if (!files || files.length === 0) return;

            try {
                await CsprojService.addExistingFile(node.project.path, files[0]);
                vscode.window.showInformationMessage(
                    `已添加: ${path.basename(files[0].fsPath)}`
                );
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `添加文件失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // 移除 NuGet 包
    context.subscriptions.push(
        vscode.commands.registerCommand('csharpsolution.removePackage', async (node: ProjectNode) => {
            if (!node || node.type !== 'package') return;

            const confirm = await vscode.window.showWarningMessage(
                `确定要从 packages.config 中移除 "${node.item.id}" 吗？`,
                { modal: true },
                '确定移除'
            );

            if (confirm !== '确定移除') return;

            try {
                await CsprojService.removePackage(node.projectPath, node.item.id);
                vscode.window.showInformationMessage(`已移除包: ${node.item.id}`);
                vscode.commands.executeCommand('csharpsolution.refresh');
            } catch (err) {
                vscode.window.showErrorMessage(
                    `移除包失败: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        })
    );

    // --- 文件监听 ---
    const watcher = vscode.workspace.createFileSystemWatcher(
        '**/*.csproj',
        false, // ignoreCreate
        false, // ignoreChange
        false  // ignoreDelete
    );

    let debounceTimer: NodeJS.Timeout | undefined;
    const debouncedRefresh = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            vscode.commands.executeCommand('csharpsolution.refresh');
        }, 500);
    };

    watcher.onDidCreate(debouncedRefresh);
    watcher.onDidChange(debouncedRefresh);
    watcher.onDidDelete(debouncedRefresh);
    context.subscriptions.push(watcher);

    // --- 初始扫描 ---
    vscode.commands.executeCommand('csharpsolution.refresh');
}

export function deactivate() {}

function getDefaultTemplate(): string[] {
    return [
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
    ];
}
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc -p ./tsconfig.json --noEmit
```

Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire extension entry point with commands, watcher, and refresh"
```

---

### Task 10: package.json 扩展配置

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 更新 package.json 添加 contributes**

将现有 `package.json` 中的 `contributes` 和 `activationEvents` 替换为以下内容。保留现有 `name`, `displayName`, `description`, `version` 等元数据字段不变。

在 `package.json` 中添加/修改以下字段：

```json
{
    "activationEvents": [
        "workspaceContains:**/*.csproj"
    ],
    "contributes": {
        "viewsContainers": {
            "activitybar": [
                {
                    "id": "csharpsolution",
                    "title": "C# 项目管理",
                    "icon": "$(folder-library)"
                }
            ]
        },
        "views": {
            "csharpsolution": [
                {
                    "id": "csharpsolution-projects",
                    "name": "项目管理"
                }
            ]
        },
        "commands": [
            {
                "command": "csharpsolution.refresh",
                "title": "刷新项目管理",
                "icon": "$(refresh)"
            },
            {
                "command": "csharpsolution.addClass",
                "title": "添加类..."
            },
            {
                "command": "csharpsolution.deleteFile",
                "title": "删除"
            },
            {
                "command": "csharpsolution.addExistingFile",
                "title": "添加现有文件..."
            },
            {
                "command": "csharpsolution.removePackage",
                "title": "移除包"
            }
        ],
        "menus": {
            "view/title": [
                {
                    "command": "csharpsolution.refresh",
                    "when": "view == csharpsolution-projects",
                    "group": "navigation"
                }
            ],
            "view/item/context": [
                {
                    "command": "csharpsolution.addClass",
                    "when": "view == csharpsolution-projects && viewItem == project",
                    "group": "navigation@1"
                },
                {
                    "command": "csharpsolution.addExistingFile",
                    "when": "view == csharpsolution-projects && viewItem == project",
                    "group": "navigation@2"
                },
                {
                    "command": "csharpsolution.addClass",
                    "when": "view == csharpsolution-projects && viewItem == folder",
                    "group": "navigation@1"
                },
                {
                    "command": "csharpsolution.deleteFile",
                    "when": "view == csharpsolution-projects && viewItem == file",
                    "group": "navigation@1"
                },
                {
                    "command": "csharpsolution.removePackage",
                    "when": "view == csharpsolution-projects && viewItem == package",
                    "group": "navigation@1"
                }
            ]
        },
        "configuration": {
            "title": "C# Project Manager",
            "properties": {
                "csharpsolution.excludePatterns": {
                    "type": "array",
                    "items": { "type": "string" },
                    "default": [],
                    "description": "额外的排除 glob 模式（与默认的 node_modules/bin/obj 合并）"
                },
                "csharpsolution.defaultNamespace": {
                    "type": "string",
                    "default": "",
                    "description": "默认根命名空间（留空则使用项目名称作为命名空间）"
                },
                "csharpsolution.classTemplate": {
                    "type": "array",
                    "items": { "type": "string" },
                    "default": [
                        "using System;",
                        "",
                        "namespace {namespace}",
                        "{",
                        "    public class {className}",
                        "    {",
                        "        ",
                        "    }",
                        "}",
                        ""
                    ],
                    "description": "类文件模板，支持 {namespace} 和 {className} 变量"
                }
            }
        }
    }
}
```

- [ ] **Step 2: 验证 package.json 语法**

```bash
node -e "const p = require('./package.json'); console.log('Valid JSON:', p.name, p.version);"
```

Expected: `Valid JSON: csharpsolution <version>`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add views, commands, menus, and configuration to package.json"
```

---

### Task 11: 端到端验证与修复

**Files:**
- 检查所有文件

- [ ] **Step 1: 完整编译检查**

```bash
npx tsc -p ./tsconfig.json --noEmit
```

Expected: 零错误。如有类型错误，逐一修复。

- [ ] **Step 2: 运行所有单元测试**

```bash
npx vscode-test
```

Expected: 所有测试 PASS。

- [ ] **Step 3: 手动端到端测试清单**

在 VS Code 中按 `F5` 启动扩展开发窗口：

1. 打开一个包含 .csproj 的工作区 → 确认【项目管理】面板显示在侧边栏
2. 面板中列出所有 .csproj 项目 → 展开项目可见引用和文件
3. 右键项目节点 → "添加类..." → 输入类名 → 确认 .cs 文件已创建且 .csproj 已更新
4. 右键文件夹节点 → 同样的操作 → 确认类创建在正确目录，namespace 正确
5. 右键 .cs 文件 → "删除" → 确认文件进入回收站，.csproj 中 Compile 条目已移除
6. 右键项目 → "添加现有文件..." → 选择 .cs 文件 → 确认已复制并加入项目
7. 在 VS Code 外部修改 .csproj → 确认面板自动刷新
8. 空工作区 → 确认面板显示"未发现 C# 项目"

- [ ] **Step 4: 修复发现的问题并提交**

```bash
git add -A
git commit -m "fix: e2e validation fixes"
```

---

## Self-Review Checklist

在提交计划前，确认：

1. **Spec coverage:** 每个 spec 需求都有对应任务
   - Tree View 面板 → Task 8 (ProjectTreeProvider) + Task 10 (package.json views)
   - 项目引用显示 → Task 2 (CsprojSerializer.parse) + Task 8 (getRefSubGroupChildren)
   - 右键添加类 → Task 9 (addClass command) + Task 7 (CsprojService.addClass)
   - 删除文件 → Task 9 (deleteFile command) + Task 7 (CsprojService.deleteFile)
   - 配置项 → Task 10 (configuration)
   - 文件监听 → Task 9 (FileSystemWatcher)

2. **Placeholder scan:** 无 TBD/TODO/待定
3. **Type consistency:** 所有接口和类型在各 Task 间保持一致
