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
});
