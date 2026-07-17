# MSBuild 支持 — 实现计划（子项目 C）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `buildTool` 配置（auto/dotnet/msbuild）+ vswhere 定位链，让传统非 SDK 项目走 MSBuild 构建；顺带修复 `matchesGlob` 通配符转换失效的存量 bug。

**Architecture:** 新建 `MsBuildLocator` 服务承载三级定位链（msbuildPath 配置 → vswhere → PATH，探测结果缓存）；`BuildService` 的 `runDotnet` 泛化为 `runTool`，新增 `resolveTool` 按配置与项目类型决策；命令层计算 `hasLegacyProject` 传入。

**Tech Stack:** TypeScript, VS Code Extension API, child_process, vswhere

---

## 文件结构

| 文件 | 操作 |
|------|------|
| `src/serialization/CsprojSerializer.ts` | 修改：matchesGlob 通配符修复 |
| `src/services/MsBuildLocator.ts` | 新建 |
| `src/services/BuildService.ts` | 修改：resolveTool / runTool / getMsBuildArgs / 签名扩展 |
| `src/commands/projectCommands.ts` | 修改：hasLegacyProject 计算，签名加 treeProvider |
| `src/extension.ts` | 修改：传 treeProvider、配置变更监听 |
| `package.json` | 修改：buildTool / msbuildPath 配置 |
| 测试 | `CsprojSerializer.test.ts` +3；新建 `MsBuildLocator.test.ts` +4；`BuildService.test.ts` +1 |

---

### Task 1: matchesGlob 通配符修复

**Files:**
- Modify: `src/serialization/CsprojSerializer.ts`（matchesGlob 方法）
- Test: `src/test/CsprojSerializer.test.ts`

- [ ] **Step 1: 写测试（经 SDK parse 往返验证）**

在 `src/test/CsprojSerializer.test.ts` 末尾（suite 闭合前）新增：

```typescript
test('Compile Remove 支持 ** 通配符（往返）', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'csproj-glob2-'));
    try {
        fs.mkdirSync(path.join(tmpRoot, 'Generated', 'Deep'), { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, 'Generated', 'A.cs'), 'class A { }');
        fs.writeFileSync(path.join(tmpRoot, 'Generated', 'Deep', 'B.cs'), 'class B { }');
        fs.writeFileSync(path.join(tmpRoot, 'Keep.cs'), 'class K { }');

        const xml = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup><Compile Remove="Generated/**" /></ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, path.join(tmpRoot, 'Test.csproj'));
        const includes = project.compiles.map(c => c.include.replace(/\\/g, '/'));
        assert.deepStrictEqual(includes, ['Keep.cs']);
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('Compile Remove 的 * 只匹配单层', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'csproj-glob3-'));
    try {
        fs.mkdirSync(path.join(tmpRoot, 'Sub'));
        fs.writeFileSync(path.join(tmpRoot, 'Root.cs'), 'class R { }');
        fs.writeFileSync(path.join(tmpRoot, 'Sub', 'Nested.cs'), 'class N { }');

        const xml = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup><Compile Remove="*.cs" /></ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, path.join(tmpRoot, 'Test.csproj'));
        const includes = project.compiles.map(c => c.include.replace(/\\/g, '/'));
        assert.deepStrictEqual(includes, ['Sub/Nested.cs'], '* 不应跨目录匹配');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('Compile Remove 的 ? 匹配单字符', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'csproj-glob4-'));
    try {
        fs.writeFileSync(path.join(tmpRoot, 'A1.cs'), 'class A1 { }');
        fs.writeFileSync(path.join(tmpRoot, 'A22.cs'), 'class A22 { }');

        const xml = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup><Compile Remove="A?.cs" /></ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, path.join(tmpRoot, 'Test.csproj'));
        const includes = project.compiles.map(c => c.include.replace(/\\/g, '/'));
        assert.deepStrictEqual(includes, ['A22.cs']);
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm run compile && pnpm test`
Expected: 3 个新测试 FAIL（通配符按字面匹配，未生效）

- [ ] **Step 3: 修复 matchesGlob**

`src/serialization/CsprojSerializer.ts` 的 `matchesGlob` 中，转换链修正为（保持先 `**` 后 `*` 的顺序；分隔符归一化行保留 d3d2b61 引入的逻辑不动）：

```typescript
private static matchesGlob(relPath: string, patterns: string[]): boolean {
    for (const rawPat of patterns) {
        const pat = rawPat.replace(/\\/g, '/');
        const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexStr = '^' + escaped
            .replace(/\\\*\\\*/g, '.*')      // ** → 任意（含分隔符）
            .replace(/\\\*/g, '[^/]*')       // *  → 单层
            .replace(/\\\?/g, '.') + '$';    // ?  → 单字符
        if (new RegExp(regexStr).test(relPath)) return true;
    }
    return false;
}
```

- [ ] **Step 4: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（115 + 3 = 118）

- [ ] **Step 5: Commit**

```bash
git add src/serialization/CsprojSerializer.ts src/test/CsprojSerializer.test.ts
git commit -m "fix: glob wildcard conversion in matchesGlob never fired"
```

---

### Task 2: MsBuildLocator

**Files:**
- Create: `src/services/MsBuildLocator.ts`
- Test: `src/test/MsBuildLocator.test.ts`（新建）

- [ ] **Step 1: 写测试**

新建 `src/test/MsBuildLocator.test.ts`：

```typescript
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { MsBuildLocator } from '../services/MsBuildLocator';

suite('MsBuildLocator', () => {

    setup(() => {
        MsBuildLocator.reset();
    });

    test('configuredPath 指向存在的文件时直接返回', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msbuild-loc-'));
        const fakeMsbuild = path.join(tmpDir, 'MSBuild.exe');
        try {
            fs.writeFileSync(fakeMsbuild, '');
            const result = await MsBuildLocator.locate(fakeMsbuild);
            assert.strictEqual(result, fakeMsbuild);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('configuredPath 指向不存在的文件时抛错', async () => {
        await assert.rejects(
            () => MsBuildLocator.locate('C:/NoSuchDir/MSBuild.exe'),
            /msbuildPath/
        );
    });

    test('探测结果稳定（同会话两次调用结果一致）', async () => {
        const first = await MsBuildLocator.locate('');
        const second = await MsBuildLocator.locate('');
        assert.strictEqual(second, first);
    });

    test('reset 后可重新探测（不抛错且结果类型合法）', async () => {
        await MsBuildLocator.locate('');
        MsBuildLocator.reset();
        const result = await MsBuildLocator.locate('');
        assert.ok(result === null || typeof result === 'string');
    });
});
```

（探测分支依赖系统环境——vswhere/PATH 是否存在因机器而异，测试只断言稳定性与类型，不断言具体值。）

- [ ] **Step 2: 运行验证失败**

Run: `pnpm run compile`
Expected: 编译错误 —— MsBuildLocator 不存在

- [ ] **Step 3: 实现 MsBuildLocator**

新建 `src/services/MsBuildLocator.ts`：

```typescript
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * msbuild.exe 定位器。
 * 定位链：msbuildPath 配置（显式，不缓存）→ vswhere 探测 → PATH，探测结果会话内缓存。
 */
export class MsBuildLocator {

    /** undefined = 未探测；null = 已探测未找到；string = 已找到 */
    private static cached: string | null | undefined;

    /**
     * 定位 msbuild。
     * configuredPath 非空时：文件存在 → 直接返回；不存在 → 抛错（显式配置错误必须暴露，不降级）。
     * 否则走 vswhere → PATH 探测（结果缓存，reset 后重探）。
     * 返回 null 表示未找到。
     */
    static async locate(configuredPath: string): Promise<string | null> {
        if (configuredPath) {
            try {
                await fs.promises.access(configuredPath);
                return configuredPath;
            } catch {
                throw new Error(`配置的 msbuildPath 不存在: ${configuredPath}`);
            }
        }

        if (this.cached !== undefined) {
            return this.cached;
        }

        this.cached = this.findViaVswhere() ?? this.findInPath();
        return this.cached;
    }

    /** 清除探测缓存（buildTool/msbuildPath 配置变更时调用） */
    static reset(): void {
        this.cached = undefined;
    }

    /** 通过 vswhere 查询 VS/Build Tools 安装的 MSBuild */
    private static findViaVswhere(): string | null {
        const programFilesX86 = process.env['ProgramFiles(x86)'];
        if (!programFilesX86) return null;

        const vswhere = path.join(
            programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'
        );
        if (!fs.existsSync(vswhere)) return null;

        try {
            const result = cp.spawnSync(vswhere, [
                '-latest',
                '-requires', 'Microsoft.Component.MSBuild',
                '-find', 'MSBuild\\**\\Bin\\MSBuild.exe',
            ], { encoding: 'utf-8' });
            if (result.status !== 0 || !result.stdout) return null;

            const first = result.stdout.split(/\r?\n/).find(line => line.trim());
            return first ? first.trim() : null;
        } catch {
            return null;
        }
    }

    /** PATH 中的 msbuild（VS 开发者命令行 / Mono 环境） */
    private static findInPath(): string | null {
        try {
            const result = cp.spawnSync('msbuild', ['-version'], { shell: true });
            return result.status === 0 ? 'msbuild' : null;
        } catch {
            return null;
        }
    }
}
```

- [ ] **Step 4: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（118 + 4 = 122）

- [ ] **Step 5: Commit**

```bash
git add src/services/MsBuildLocator.ts src/test/MsBuildLocator.test.ts
git commit -m "feat: add MsBuildLocator with config/vswhere/PATH resolution chain"
```

---

### Task 3: BuildService 改造 + 调用方接线

**Files:**
- Modify: `src/services/BuildService.ts`
- Modify: `src/commands/projectCommands.ts`
- Modify: `src/extension.ts`
- Test: `src/test/BuildService.test.ts`

（签名变更与调用方必须同一提交，保持每步可编译。）

- [ ] **Step 1: 写 getMsBuildArgs 测试**

在 `src/test/BuildService.test.ts` 的现有测试之后新增：

```typescript
test('getMsBuildArgs 返回正确参数', () => {
    assert.deepStrictEqual(
        BuildService.getMsBuildArgs('C:/proj/Test.csproj', 'Build'),
        ['C:/proj/Test.csproj', '/t:Build']
    );
    assert.deepStrictEqual(
        BuildService.getMsBuildArgs('C:/proj/Test.csproj', 'Clean'),
        ['C:/proj/Test.csproj', '/t:Clean']
    );
    assert.deepStrictEqual(
        BuildService.getMsBuildArgs('C:/proj/Test.csproj', 'Rebuild'),
        ['C:/proj/Test.csproj', '/t:Rebuild']
    );
});
```

- [ ] **Step 2: 运行验证失败**

Run: `pnpm run compile`
Expected: 编译错误 —— getMsBuildArgs 不存在

- [ ] **Step 3: 改造 BuildService**

`src/services/BuildService.ts` 整体改造（import 增加 `MsBuildLocator`）：

```typescript
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { MsBuildLocator } from './MsBuildLocator';

type ResolvedTool = { tool: 'dotnet' | 'msbuild'; exe: string };

export class BuildService {

    private static channel: vscode.OutputChannel | undefined;

    private static getChannel(): vscode.OutputChannel {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel('C# Build');
        }
        return this.channel;
    }

    static async build(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void> {
        const resolved = await this.resolveTool(hasLegacyProject);
        if (!resolved) return;
        const args = resolved.tool === 'msbuild'
            ? this.getMsBuildArgs(projectPath, 'Build')
            : this.getBuildArgs(projectPath);
        await this.runTool(resolved.exe, args, projectPath, projectName, '生成');
    }

    static async clean(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void> {
        const resolved = await this.resolveTool(hasLegacyProject);
        if (!resolved) return;
        const args = resolved.tool === 'msbuild'
            ? this.getMsBuildArgs(projectPath, 'Clean')
            : this.getCleanArgs(projectPath);
        await this.runTool(resolved.exe, args, projectPath, projectName, '清理');
    }

    static async rebuild(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void> {
        const resolved = await this.resolveTool(hasLegacyProject);
        if (!resolved) return;
        if (resolved.tool === 'msbuild') {
            // MSBuild 原生 Rebuild target，单次调用
            await this.runTool(resolved.exe, this.getMsBuildArgs(projectPath, 'Rebuild'), projectPath, projectName, '重新生成');
            return;
        }
        const cleanOk = await this.runTool(resolved.exe, this.getCleanArgs(projectPath), projectPath, projectName, '清理');
        if (!cleanOk) return;
        await this.runTool(resolved.exe, this.getBuildArgs(projectPath), projectPath, projectName, '生成');
    }

    // Test helpers
    static getBuildArgs(projectPath: string): string[] {
        return ['build', projectPath];
    }

    static getCleanArgs(projectPath: string): string[] {
        return ['clean', projectPath];
    }

    static getMsBuildArgs(projectPath: string, target: 'Build' | 'Clean' | 'Rebuild'): string[] {
        return [projectPath, `/t:${target}`];
    }

    /**
     * 按 buildTool 配置与项目类型决定构建工具。
     * 返回 null 表示无可用工具（已向用户弹出错误）。
     */
    private static async resolveTool(hasLegacyProject: boolean): Promise<ResolvedTool | null> {
        const config = vscode.workspace.getConfiguration('csharpsolution');
        const buildTool = config.get<string>('buildTool', 'auto');
        const msbuildPath = config.get<string>('msbuildPath', '');

        if (buildTool === 'dotnet') {
            return this.resolveDotnet();
        }

        if (buildTool === 'msbuild') {
            let located: string | null;
            try {
                located = await MsBuildLocator.locate(msbuildPath);
            } catch (err) {
                vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
                return null;
            }
            if (!located) {
                vscode.window.showErrorMessage(
                    '未找到 MSBuild。请安装 Visual Studio/Build Tools 或配置 csharpsolution.msbuildPath。'
                );
                return null;
            }
            return { tool: 'msbuild', exe: located };
        }

        // auto：含传统项目时优先 msbuild，找不到回退 dotnet 并警告
        if (hasLegacyProject) {
            let located: string | null = null;
            try {
                located = await MsBuildLocator.locate(msbuildPath);
            } catch (err) {
                vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
                return null;
            }
            if (located) {
                return { tool: 'msbuild', exe: located };
            }
            this.getChannel().appendLine('⚠ 检测到传统项目但未找到 MSBuild，回退 dotnet');
        }
        return this.resolveDotnet();
    }

    private static resolveDotnet(): ResolvedTool | null {
        if (!this.isDotnetAvailable()) {
            vscode.window.showErrorMessage('未找到 .NET SDK。请安装 .NET SDK 后重试。');
            return null;
        }
        return { tool: 'dotnet', exe: 'dotnet' };
    }

    private static async runTool(
        exe: string,
        args: string[],
        projectPath: string,
        projectName: string,
        label: string
    ): Promise<boolean> {
        const channel = this.getChannel();
        channel.clear();
        channel.show(true);

        const timestamp = new Date().toLocaleTimeString();
        channel.appendLine(`[${timestamp}] ${label} ${projectName}...`);
        channel.appendLine(`${exe} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
        channel.appendLine('');

        return new Promise<boolean>((resolve) => {
            const projectDir = path.dirname(projectPath);
            // shell:true 下参数不会自动引号包裹；exe 与含空格参数显式加引号
            // （vswhere 返回的 MSBuild 路径含 "Program Files"，项目路径也可能含空格）
            const quotedExe = exe.includes(' ') ? `"${exe}"` : exe;
            const quotedArgs = args.map(a => (a.includes(' ') ? `"${a}"` : a));
            const proc = cp.spawn(quotedExe, quotedArgs, {
                cwd: projectDir,
                shell: true,
            });

            proc.stdout?.on('data', (data: Buffer) => {
                channel.appendLine(data.toString().trimEnd());
            });

            proc.stderr?.on('data', (data: Buffer) => {
                const lines = data.toString().trimEnd().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        channel.appendLine(`❌ ${line}`);
                    }
                }
            });

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    channel.appendLine('');
                    channel.appendLine(`✅ ${label}成功`);
                    resolve(true);
                } else {
                    channel.appendLine('');
                    channel.appendLine(`❌ ${label}失败 (exit code: ${code})`);
                    vscode.window.showErrorMessage(`${label}失败，详见输出面板。`);
                    resolve(false);
                }
            });

            proc.on('error', (err: Error) => {
                channel.appendLine(`❌ 启动 ${exe} 失败: ${err.message}`);
                vscode.window.showErrorMessage(`启动 ${exe} 失败: ${err.message}`);
                resolve(false);
            });
        });
    }

    private static isDotnetAvailable(): boolean {
        try {
            const result = cp.spawnSync('dotnet', ['--version'], { shell: true });
            return result.status === 0;
        } catch {
            return false;
        }
    }
}
```

注意与原实现的三处有意差异：① `runDotnet` → 泛化 `runTool`（exe 参数化、回显实际命令行）；② 显式引号包裹含空格的 exe/参数（顺带修复 dotnet 路径含空格项目的潜在问题）；③ `isDotnetAvailable` 去掉了多余的 async（原实现内部就是同步 spawnSync）。

- [ ] **Step 4: 改造 projectCommands + extension.ts**

`src/commands/projectCommands.ts`：

1. import 增加：`import { ProjectTreeProvider } from '../tree/ProjectTreeProvider';`、`import { ProjectDiscovery } from '../services/ProjectDiscovery';`
2. 签名：`export function registerProjectCommands(context: vscode.ExtensionContext, treeProvider: ProjectTreeProvider): void`
3. 在函数体开头加辅助函数：

```typescript
/** 构建目标是否含传统（非 SDK）项目：project 节点看自身，solution 节点看其成员 */
const hasLegacyProject = (node: ProjectNode): boolean => {
    if (node.type === 'project') {
        return !node.project.isSdk;
    }
    if (node.type === 'solution') {
        const projects = ProjectDiscovery.findProjectsForSolution(node.solution, treeProvider.allProjects);
        return projects.some(p => !p.isSdk);
    }
    return false;
};
```

4. build/clean/rebuild 三个处理器的调用处各加第三个参数：

```typescript
await BuildService.build(targetPath, targetName, hasLegacyProject(node));
// clean / rebuild 同理
```

`src/extension.ts`：

1. `registerProjectCommands(context)` → `registerProjectCommands(context, treeProvider)`
2. import 增加 `MsBuildLocator`，在 register 调用之后新增配置监听：

```typescript
// --- buildTool/msbuildPath 配置变更时重置 MSBuild 探测缓存 ---
context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('csharpsolution.buildTool') ||
            e.affectsConfiguration('csharpsolution.msbuildPath')) {
            MsBuildLocator.reset();
        }
    })
);
```

- [ ] **Step 5: 编译并测试**

Run: `pnpm run compile && pnpm test`
Expected: 全部通过（122 + 1 = 123）

- [ ] **Step 6: Commit**

```bash
git add src/services/BuildService.ts src/commands/projectCommands.ts src/extension.ts src/test/BuildService.test.ts
git commit -m "feat: buildTool resolution with MSBuild support in BuildService"
```

---

### Task 4: package.json 配置

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 新增配置项**

`contributes.configuration.properties` 新增：

```json
"csharpsolution.buildTool": {
  "type": "string",
  "enum": ["auto", "dotnet", "msbuild"],
  "default": "auto",
  "description": "构建工具：auto 按项目类型选择（传统项目优先 MSBuild），或强制指定"
},
"csharpsolution.msbuildPath": {
  "type": "string",
  "default": "",
  "description": "msbuild.exe 完整路径（留空则通过 vswhere/PATH 自动探测）"
}
```

- [ ] **Step 2: 校验 + 编译**

Run: `node -e "require('./package.json')" && pnpm run compile && pnpm test`
Expected: JSON 合法，123 通过

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: contribute buildTool and msbuildPath configuration"
```

---

### Task 5: 完整验证

- [ ] **Step 1: 全量编译 + 测试**

Run: `pnpm run compile && pnpm test`
Expected: 123 个测试全部通过，lint 0 error

- [ ] **Step 2: 手动验证清单**

F5 启动扩展开发宿主：

| # | 场景 | 预期 |
|---|------|------|
| 1 | auto + 传统项目构建 | 输出面板回显 msbuild 完整路径 + `/t:Build`（本机装了 VS） |
| 2 | auto + SDK 项目构建 | 走 `dotnet build` |
| 3 | auto + 混合解决方案构建 | 任一传统项目 → msbuild |
| 4 | buildTool=dotnet + 传统项目 | 强制 dotnet |
| 5 | buildTool=msbuild + SDK 项目 | 强制 msbuild |
| 6 | msbuildPath 配置无效路径 | 构建报错提示配置无效 |
| 7 | 重新生成（msbuild） | 单次 `/t:Rebuild` 调用 |
| 8 | 修改 buildTool 配置后再构建 | 生效（缓存已重置） |
| 9 | SDK 项目带 `Remove="Generated/**"` | 树中被排除（glob 修复生效） |
| 10 | 原有构建回归（清理/生成） | 正常 |

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: address issues found in msbuild verification"
```
