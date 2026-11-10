import * as assert from 'assert';
import { CsprojItems } from '../serialization/CsprojItems';

const SDK = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <ProjectReference Include="..\\Core\\Core.csproj" />
  </ItemGroup>
</Project>
`;

const LEGACY = `<Project ToolsVersion="15.0">
  <ItemGroup>
    <Reference Include="System" />
    <Analyzer Include="..\\packages\\Analyzer.1.0\\analyzers\\dotnet\\cs\\Analyzer.dll" />
  </ItemGroup>
</Project>
`;

suite('CsprojItems', () => {

    test('addPackageReference 追加到已有 ItemGroup', () => {
        const updated = CsprojItems.addPackageReference(SDK, 'Serilog', '3.1.1');
        assert.ok(updated.includes('<PackageReference Include="Serilog" Version="3.1.1" />'));
        assert.ok(updated.indexOf('Serilog') > updated.indexOf('Newtonsoft.Json'));
        // 其余内容不变
        assert.strictEqual(updated.replace('    <PackageReference Include="Serilog" Version="3.1.1" />\n', ''), SDK);
    });

    test('addPackageReference 对同 ID 去重', () => {
        assert.strictEqual(CsprojItems.addPackageReference(SDK, 'Newtonsoft.Json', '13.0.3'), SDK);
    });

    test('addPackageReference 转义特殊字符', () => {
        const updated = CsprojItems.addPackageReference(SDK, 'A&B', '1.0');
        assert.ok(updated.includes('Include="A&amp;B"'));
    });

    test('setPackageVersion 修改已有版本', () => {
        const updated = CsprojItems.setPackageVersion(SDK, 'Newtonsoft.Json', '13.0.4');
        assert.ok(updated.includes('Version="13.0.4"'));
        assert.ok(!updated.includes('Version="13.0.3"'));
    });

    test('removePackageReference 删除整行', () => {
        const updated = CsprojItems.removePackageReference(SDK, 'Newtonsoft.Json');
        assert.ok(!updated.includes('Newtonsoft.Json'));
        assert.ok(updated.includes('ProjectReference'));
    });

    test('addProjectReference 使用反斜杠路径', () => {
        const updated = CsprojItems.addProjectReference(SDK, '..\\Infra\\Infra.csproj');
        assert.ok(updated.includes('<ProjectReference Include="..\\Infra\\Infra.csproj" />'));
    });

    test('addAssemblyReference 生成带 HintPath 的多行元素', () => {
        const updated = CsprojItems.addAssemblyReference(LEGACY, 'MyLib', '..\\libs\\MyLib.dll');
        assert.ok(updated.includes('<Reference Include="MyLib">'));
        assert.ok(updated.includes('<HintPath>..\\libs\\MyLib.dll</HintPath>'));
        assert.ok(updated.includes('</Reference>'));
        // 新元素插在最后一个 Reference 之后
        assert.ok(updated.indexOf('MyLib') > updated.indexOf('<Reference Include="System" />'));
    });

    test('removeAnalyzer 删除分析器条目', () => {
        const updated = CsprojItems.removeAnalyzer(LEGACY, '..\\packages\\Analyzer.1.0\\analyzers\\dotnet\\cs\\Analyzer.dll');
        assert.ok(!updated.includes('Analyzer Include'));
    });

    test('没有对应 ItemGroup 时新建', () => {
        const empty = '<Project Sdk="Microsoft.NET.Sdk">\n</Project>\n';
        const updated = CsprojItems.addPackageReference(empty, 'Serilog', '3.1.1');
        assert.ok(updated.includes('<ItemGroup>'));
        assert.ok(updated.includes('<PackageReference Include="Serilog" Version="3.1.1" />'));
        assert.ok(updated.indexOf('</ItemGroup>') < updated.indexOf('</Project>'));
    });

    test('removeAssemblyReference 删除带子元素的多行引用', () => {
        const xml = `<Project>\n  <ItemGroup>\n    <Reference Include="MyLib">\n      <HintPath>..\\libs\\MyLib.dll</HintPath>\n    </Reference>\n    <Reference Include="System" />\n  </ItemGroup>\n</Project>\n`;
        const updated = CsprojItems.removeAssemblyReference(xml, 'MyLib');
        assert.ok(!updated.includes('MyLib'));
        assert.ok(updated.includes('<Reference Include="System" />'));
    });
});
