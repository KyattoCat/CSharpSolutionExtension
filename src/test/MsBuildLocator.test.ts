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
