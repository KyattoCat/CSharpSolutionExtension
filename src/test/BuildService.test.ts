import * as assert from 'assert';
import { BuildService } from '../services/BuildService';

suite('BuildService', () => {

    test('getBuildArgs returns correct args with configuration', () => {
        const args = BuildService.getBuildArgs('/path/to/Test.csproj', 'Release');
        assert.deepStrictEqual(args, ['build', '/path/to/Test.csproj', '-c', 'Release']);
    });

    test('getBuildArgs with Debug configuration', () => {
        const args = BuildService.getBuildArgs('/path/to/Test.csproj', 'Debug');
        assert.deepStrictEqual(args, ['build', '/path/to/Test.csproj', '-c', 'Debug']);
    });

    test('getCleanArgs returns correct args with configuration', () => {
        const args = BuildService.getCleanArgs('/path/to/Test.csproj', 'Release');
        assert.deepStrictEqual(args, ['clean', '/path/to/Test.csproj', '-c', 'Release']);
    });

    test('getMsBuildArgs returns correct args with configuration', () => {
        assert.deepStrictEqual(
            BuildService.getMsBuildArgs('C:/proj/Test.csproj', 'Build', 'Debug'),
            ['C:/proj/Test.csproj', '/t:Build', '/p:Configuration=Debug']
        );
        assert.deepStrictEqual(
            BuildService.getMsBuildArgs('C:/proj/Test.csproj', 'Clean', 'Release'),
            ['C:/proj/Test.csproj', '/t:Clean', '/p:Configuration=Release']
        );
        assert.deepStrictEqual(
            BuildService.getMsBuildArgs('C:/proj/Test.csproj', 'Rebuild', 'Debug'),
            ['C:/proj/Test.csproj', '/t:Rebuild', '/p:Configuration=Debug']
        );
    });
});
