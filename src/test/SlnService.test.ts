import * as assert from 'assert';
import * as path from 'path';
import { SlnService } from '../services/SlnService';

suite('SlnService', () => {

    test('getAddArgs returns correct args', () => {
        const args = SlnService.getAddArgs('/path/to/Test.sln', '/path/to/App.csproj');
        assert.deepStrictEqual(args, ['sln', '/path/to/Test.sln', 'add', '/path/to/App.csproj']);
    });

    test('getRemoveArgs returns correct args', () => {
        const args = SlnService.getRemoveArgs('/path/to/Test.sln', '/path/to/App.csproj');
        assert.deepStrictEqual(args, ['sln', '/path/to/Test.sln', 'remove', '/path/to/App.csproj']);
    });

    test('getNewArgs returns correct args', () => {
        const args = SlnService.getNewArgs('classlib', 'MyLib', '/path/to/Src');
        assert.deepStrictEqual(args, ['new', 'classlib', '-n', 'MyLib', '-o', path.join('/path/to/Src', 'MyLib')]);
    });

    test('getDefaultTemplates returns non-empty list', () => {
        const templates = SlnService.getDefaultTemplates();
        assert.ok(templates.length > 0);
        assert.ok(templates.find(t => t.id === 'classlib'));
        assert.ok(templates.find(t => t.id === 'console'));
    });
});
