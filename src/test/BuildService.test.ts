import * as assert from 'assert';
import { BuildService } from '../services/BuildService';

suite('BuildService', () => {

    test('getBuildArgs 返回正确参数', () => {
        const args = BuildService.getBuildArgs('/path/to/Test.csproj');
        assert.deepStrictEqual(args, ['build', '/path/to/Test.csproj']);
    });

    test('getCleanArgs 返回正确参数', () => {
        const args = BuildService.getCleanArgs('/path/to/Test.csproj');
        assert.deepStrictEqual(args, ['clean', '/path/to/Test.csproj']);
    });
});
