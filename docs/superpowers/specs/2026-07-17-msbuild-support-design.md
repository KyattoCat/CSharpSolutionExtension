# MSBuild 支持 — 设计文档（子项目 C）

> 日期：2026-07-17 | 状态：设计完成
> 系列：技术债清理（A，完成）→ 文件管理增强（B，完成）→ MSBuild 支持（C）

## 1. 概述

1. **buildTool 配置** — `auto`（默认，按项目类型选择）/ `dotnet` / `msbuild`；传统非 SDK 项目在 Windows 上通常需要完整 MSBuild（WinForms/WPF/老 .NET Framework），dotnet CLI 无法构建
2. **msbuild 定位** — `msbuildPath` 配置 → vswhere 探测 → PATH，会话缓存
3. **顺带修复** — `CsprojSerializer.matchesGlob` 通配符转换从未生效的存量 bug

## 2. 决策记录

| 维度 | 决定 |
|------|------|
| auto 语义 | 构建目标含传统（非 SDK）项目 → 优先 msbuild，找不到回退 dotnet 并警告；纯 SDK → dotnet |
| 定位链 | ① `msbuildPath` 配置（存在→用；配置了但文件不存在→**抛错**不降级）② vswhere ③ PATH；全败缓存 null |
| rebuild 语义 | msbuild 用原生 `/t:Rebuild` 单次调用；dotnet 保持 clean→build 两段 |
| msbuild 参数 | `/t:Build` / `/t:Clean` / `/t:Rebuild`，无额外 verbosity/nologo 标志 |
| 结构 | 定位逻辑独立为 `MsBuildLocator` 服务（方案二，可测性优先） |
| 缓存失效 | `onDidChangeConfiguration` 影响 buildTool/msbuildPath 时 `MsBuildLocator.reset()` |

## 3. MsBuildLocator（新建 `src/services/MsBuildLocator.ts`）

```typescript
export class MsBuildLocator {
    private static cached: string | null | undefined; // undefined=未探测, null=已探测未找到

    /**
     * 定位 msbuild：
     * 1. configuredPath 非空：文件存在→返回；不存在→抛错（显式配置错误必须暴露）
     * 2. vswhere：%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe 存在则执行
     *    vswhere -latest -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe
     *    取 stdout 第一行非空路径
     * 3. PATH：spawnSync('msbuild', ['-version']) 退出码 0 → 返回 'msbuild'
     * 4. 全部失败 → 缓存并返回 null
     * 注意：configuredPath 分支不参与缓存（配置读取本身便宜且需即时生效）；
     * vswhere/PATH 探测结果缓存。
     */
    static async locate(configuredPath: string): Promise<string | null>;

    /** 清除探测缓存（配置变更时调用） */
    static reset(): void;
}
```

## 4. BuildService 改造

### 公开签名（增加 hasLegacyProject 参数）

```typescript
static async build(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void>;
static async clean(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void>;
static async rebuild(projectPath: string, projectName: string, hasLegacyProject: boolean): Promise<void>;
```

### 内部结构

```typescript
/** 按配置与项目类型决定工具；返回 null 表示无可用工具（已弹错误） */
private static async resolveTool(hasLegacyProject: boolean): Promise<{ tool: 'dotnet' | 'msbuild'; exe: string } | null>;

/** 泛化自现有 runDotnet：spawn exe + args，输出面板回显（回显实际命令行） */
private static async runTool(exe: string, args: string[], projectName: string, projectPath: string, label: string): Promise<boolean>;
```

`resolveTool` 逻辑：

| buildTool 配置 | 行为 |
|----------------|------|
| `dotnet` | dotnet 可用性检查（现有逻辑）；不可用 → 错误「未找到 .NET SDK」 |
| `msbuild` | `MsBuildLocator.locate(msbuildPath)`；null → 错误「未找到 MSBuild。请安装 Visual Studio/Build Tools 或配置 csharpsolution.msbuildPath」；locate 抛错（配置路径无效）→ 错误提示原文 |
| `auto` | `hasLegacyProject` 且 locate 成功 → msbuild；否则 dotnet（hasLegacyProject 但 locate 失败时，输出面板追加一行警告「检测到传统项目但未找到 MSBuild，回退 dotnet」后走 dotnet） |

### 参数映射

| 操作 | dotnet | msbuild |
|------|--------|---------|
| 生成 | `dotnet build <path>` | `msbuild <path> /t:Build` |
| 清理 | `dotnet clean <path>` | `msbuild <path> /t:Clean` |
| 重新生成 | clean 成功后 build（两次） | `msbuild <path> /t:Rebuild`（单次） |

### 测试辅助

现有 `getBuildArgs`/`getCleanArgs` 保留；新增：

```typescript
static getMsBuildArgs(projectPath: string, target: 'Build' | 'Clean' | 'Rebuild'): string[] {
    return [projectPath, `/t:${target}`];
}
```

## 5. 命令层（projectCommands.ts）

- `registerProjectCommands(context, treeProvider)` —— 签名加 treeProvider（extension.ts 同步）
- build/clean/rebuild 处理器计算 `hasLegacyProject`：
  - `project` 节点：`!node.project.isSdk`
  - `solution` 节点：`ProjectDiscovery.findProjectsForSolution(node.solution, treeProvider.allProjects).some(p => !p.isSdk)`

## 6. 配置与缓存失效

package.json `contributes.configuration.properties` 新增：

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

extension.ts 注册：

```typescript
vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('csharpsolution.buildTool') || e.affectsConfiguration('csharpsolution.msbuildPath')) {
        MsBuildLocator.reset();
    }
});
```

## 7. matchesGlob 修复（CsprojSerializer）

存量 bug：转义产物是 `\*`（单反斜杠），而转换正则 `/\\\\\*\\\\\*/g` 匹配 `\\*`（双反斜杠），从未命中——`Remove="**/*.cs"` 等通配模式只做字面匹配。修正：

```typescript
const regexStr = '^' + escaped
    .replace(/\\\*\\\*/g, '.*')      // ** → 任意（含分隔符）
    .replace(/\\\*/g, '[^/]*')       // *  → 单层
    .replace(/\\\?/g, '.') + '$';    // ?  → 单字符
```

顺序保持先 `**` 后 `*`。仅影响树显示过滤（MSBuild 本身一直正确执行 glob），修复后树与实际编译集一致。

## 8. 边界情况

| 场景 | 行为 |
|------|------|
| msbuildPath 配置了不存在的路径 | 构建时报错提示配置无效（不静默降级） |
| auto + 传统项目 + 无 MSBuild | 输出面板警告后回退 dotnet（尽力而为，dotnet 可能失败但错误可见） |
| 显式 msbuild + 未找到 | 错误提示安装指引 |
| 配置变更 | 缓存重置，下次构建重新探测 |
| 非 Windows 平台 | vswhere 路径不存在自然跳过；PATH 中的 msbuild（Mono）仍可探测到 |

## 9. 测试要点

| 对象 | 用例 |
|------|------|
| MsBuildLocator | configuredPath 存在 → 返回该路径；不存在 → 抛错；探测结果缓存（二次不重探，用计数或临时状态验证）；reset 后重探 |
| BuildService | `getMsBuildArgs` 三种 target 的参数 |
| matchesGlob | 经 SDK parse 往返：`Remove="Generated/**"` 排除嵌套；`Remove="*.cs"` 只排根层不排子目录；`Remove="A?.cs"` 单字符 |

手动验证：三种 buildTool × 传统/SDK 项目构建、msbuild 缺失回退/报错、配置变更后重探测、输出面板回显正确命令行。
