import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { FileService } from '../services/FileService';
import { CompileItem } from '../models/CsprojModel';

suite('FileService', () => {

    const tmpDir = path.join(os.tmpdir(), 'csharpsolution-test-' + Date.now());
    const projectPath = path.join(tmpDir, 'Test.csproj');
    const csprojContent = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="OldName.cs" />
  </ItemGroup>
</Project>`;

    suiteSetup(async () => {
        await fs.promises.mkdir(tmpDir, { recursive: true });
    });

    suiteTeardown(async () => {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    setup(async () => {
        // Clean up any files/dirs from previous tests except the csproj
        const entries = await fs.promises.readdir(tmpDir);
        for (const entry of entries) {
            const fullPath = path.join(tmpDir, entry);
            const stat = await fs.promises.stat(fullPath);
            if (stat.isDirectory()) {
                await fs.promises.rm(fullPath, { recursive: true, force: true });
            } else if (entry.endsWith('.cs')) {
                await fs.promises.unlink(fullPath);
            }
        }
        await fs.promises.writeFile(projectPath, csprojContent, 'utf-8');
    });

    test('renameFile 重命名文件并更新 .csproj', async () => {
        const oldContent = 'namespace Test { public class OldName { } }';
        await fs.promises.writeFile(path.join(tmpDir, 'OldName.cs'), oldContent, 'utf-8');

        const compileItem: CompileItem = { include: 'OldName.cs' };
        await FileService.renameFile(projectPath, compileItem, 'NewName');

        try {
            await fs.promises.access(path.join(tmpDir, 'OldName.cs'));
            assert.fail('old file should be deleted');
        } catch { /* expected */ }

        const newContent = await fs.promises.readFile(path.join(tmpDir, 'NewName.cs'), 'utf-8');
        assert.ok(newContent.includes('public class NewName'));

        const csproj = await fs.promises.readFile(projectPath, 'utf-8');
        assert.ok(csproj.includes('NewName.cs'));
        assert.ok(!csproj.includes('OldName.cs'));
    });

    test('renameFile 同步更新构造函数名', async () => {
        const oldContent = `namespace Test {
    public class OldName {
        public OldName() { }
        public OldName(string x) { }
    }
}`;
        await fs.promises.writeFile(path.join(tmpDir, 'OldName.cs'), oldContent, 'utf-8');

        const compileItem: CompileItem = { include: 'OldName.cs' };
        await FileService.renameFile(projectPath, compileItem, 'NewName');

        const newContent = await fs.promises.readFile(path.join(tmpDir, 'NewName.cs'), 'utf-8');
        assert.ok(!newContent.includes('class OldName'));
        assert.ok(newContent.includes('class NewName'));
        assert.ok(!newContent.includes('OldName('));
        assert.ok(newContent.includes('NewName('));
    });

    test('renameFile 目标文件已存在时报错', async () => {
        await fs.promises.writeFile(path.join(tmpDir, 'OldName.cs'), 'content', 'utf-8');
        await fs.promises.writeFile(path.join(tmpDir, 'NewName.cs'), 'existing', 'utf-8');

        const compileItem: CompileItem = { include: 'OldName.cs' };
        await assert.rejects(
            () => FileService.renameFile(projectPath, compileItem, 'NewName'),
            /file already exists/i
        );

        const oldContent = await fs.promises.readFile(path.join(tmpDir, 'OldName.cs'), 'utf-8');
        assert.strictEqual(oldContent, 'content');
    });

    test('renameFile 禁用代码同步时不修改文件内容', async () => {
        const oldContent = 'namespace Test { public class OldName { } }';
        await fs.promises.writeFile(path.join(tmpDir, 'OldName.cs'), oldContent, 'utf-8');

        const compileItem: CompileItem = { include: 'OldName.cs' };
        await FileService.renameFile(projectPath, compileItem, 'NewName', false);

        const newContent = await fs.promises.readFile(path.join(tmpDir, 'NewName.cs'), 'utf-8');
        assert.ok(newContent.includes('class OldName'));
    });

    test('deleteFile 从 csproj 移除并删除物理文件', async () => {
        await fs.promises.writeFile(path.join(tmpDir, 'ToDelete.cs'), 'content', 'utf-8');
        const compileItem: CompileItem = { include: 'ToDelete.cs' };
        await FileService.deleteFile(projectPath, compileItem);

        // Verify file removed from csproj
        const csproj = await fs.promises.readFile(projectPath, 'utf-8');
        assert.ok(!csproj.includes('ToDelete.cs'));

        // Note: vscode.workspace.fs.delete with useTrash is not testable in unit tests
        // (requires VS Code API), but we verify the csproj update worked
    });

    test('renameFile 处理子目录中的文件', async () => {
        const subDir = path.join(tmpDir, 'Models');
        await fs.promises.mkdir(subDir, { recursive: true });
        await fs.promises.writeFile(path.join(subDir, 'OldModel.cs'), 'class OldModel { }', 'utf-8');

        // Update csproj to point to subdirectory (use OS-native separator)
        const includePath = path.join('Models', 'OldModel.cs');
        const newIncludePath = path.join('Models', 'NewModel.cs');
        const csprojWithSubdir = csprojContent.replace('OldName.cs', includePath);
        await fs.promises.writeFile(projectPath, csprojWithSubdir, 'utf-8');

        const compileItem: CompileItem = { include: includePath };
        await FileService.renameFile(projectPath, compileItem, 'NewModel');

        const csproj = await fs.promises.readFile(projectPath, 'utf-8');
        assert.ok(csproj.includes(newIncludePath));
    });

    test('renameFile 同步更新 struct 声明', async () => {
        const oldContent = 'namespace Test { public struct OldStruct { } }';
        await fs.promises.writeFile(path.join(tmpDir, 'OldStruct.cs'), oldContent, 'utf-8');

        // Update csproj to reference the struct file
        const csprojWithStruct = csprojContent.replace('OldName.cs', 'OldStruct.cs');
        await fs.promises.writeFile(projectPath, csprojWithStruct, 'utf-8');

        const compileItem: CompileItem = { include: 'OldStruct.cs' };
        await FileService.renameFile(projectPath, compileItem, 'NewStruct');
        const newContent = await fs.promises.readFile(path.join(tmpDir, 'NewStruct.cs'), 'utf-8');
        assert.ok(newContent.includes('struct NewStruct'));
    });
});
