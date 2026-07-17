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
