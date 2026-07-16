import * as assert from 'assert';
import { SlnParser } from '../serialization/SlnParser';

suite('SlnParser', () => {

    test('解析有效的 .sln 文件', () => {
        const sln = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "MyApp", "MyApp\\MyApp.csproj", "{A1B2C3D4-1234-5678-9ABC-DEF012345678}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "MyApp.Tests", "Tests\\MyApp.Tests.csproj", "{B2C3D4E5-2345-6789-ABCD-EF0123456789}"
EndProject
`;
        const solution = SlnParser.parse(sln, '/fake/MySolution.sln');
        assert.strictEqual(solution.name, 'MySolution');
        assert.strictEqual(solution.projects.length, 2);
        assert.strictEqual(solution.projects[0].name, 'MyApp');
        assert.strictEqual(solution.projects[0].relPath, 'MyApp\\MyApp.csproj');
    });

    test('过滤解决方案文件夹', () => {
        const sln = `
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "{C3D4E5F6-3456-789A-BCDE-F01234567890}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Lib", "Lib\\Lib.csproj", "{D4E5F6A7-4567-89AB-CDEF-012345678901}"
EndProject
`;
        const solution = SlnParser.parse(sln, '/fake/Test.sln');
        assert.strictEqual(solution.projects.length, 1);
        assert.strictEqual(solution.projects[0].name, 'Lib');
    });

    test('解析空 .sln', () => {
        const sln = `Microsoft Visual Studio Solution File, Format Version 12.00`;
        const solution = SlnParser.parse(sln, '/fake/Empty.sln');
        assert.strictEqual(solution.name, 'Empty');
        assert.strictEqual(solution.projects.length, 0);
    });

    test('格式异常不抛异常', () => {
        const solution = SlnParser.parse('garbage', '/fake/Bad.sln');
        assert.strictEqual(solution.projects.length, 0);
    });

    test('解析 .slnx 文件', () => {
        const slnx = `<Solution>
  <Project Path="MyApp\\MyApp.csproj" />
  <Project Path="Tests\\MyApp.Tests.csproj" />
</Solution>`;
        const solution = SlnParser.parse(slnx, '/fake/MySolution.slnx');
        assert.strictEqual(solution.name, 'MySolution');
        assert.strictEqual(solution.projects.length, 2);
        assert.strictEqual(solution.projects[0].name, 'MyApp');
        assert.strictEqual(solution.projects[0].relPath, 'MyApp\\MyApp.csproj');
        assert.strictEqual(solution.projects[1].name, 'MyApp.Tests');
    });

    test('解析空 .slnx', () => {
        const solution = SlnParser.parse('<Solution></Solution>', '/fake/Empty.slnx');
        assert.strictEqual(solution.name, 'Empty');
        assert.strictEqual(solution.projects.length, 0);
    });
});
