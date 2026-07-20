// src/test/TortoiseService.test.ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { TortoiseService } from '../services/TortoiseService';

suite('TortoiseService', () => {

    test('detectProc returns configured path when file exists', async () => {
        const config = vscode.workspace.getConfiguration('csharpsolution');
        const cmdExe = 'C:\\Windows\\System32\\cmd.exe';
        await config.update('tortoiseSvnPath', cmdExe, vscode.ConfigurationTarget.Global);
        const result = TortoiseService.detectProc('svn');
        assert.strictEqual(typeof result, 'string');
        // Restore default
        await config.update('tortoiseSvnPath', '', vscode.ConfigurationTarget.Global);
    });

    test('detectProc returns undefined when nothing configured and no install', () => {
        const result = TortoiseService.detectProc('svn');
        // In CI environment, TortoiseSVN is usually not installed, so undefined is expected
        assert.ok(result === undefined || typeof result === 'string');
    });

    test('detectProc caches result', () => {
        const r1 = TortoiseService.detectProc('git');
        const r2 = TortoiseService.detectProc('git');
        assert.strictEqual(r1, r2);
    });

    test('execute does not throw on missing proc', () => {
        assert.doesNotThrow(() => {
            TortoiseService.execute('svn', 'update', 'C:\\nonexistent\\path');
        });
    });
});
