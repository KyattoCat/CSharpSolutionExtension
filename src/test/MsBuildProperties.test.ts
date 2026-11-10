import * as assert from 'assert';
import { MsBuildProperties } from '../services/MsBuildProperties';

const LEGACY = `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <!-- 这是注释，必须保留 -->
  <PropertyGroup>
    <Configuration Condition=" '$(Configuration)' == '' ">Debug</Configuration>
    <Platform Condition=" '$(Platform)' == '' ">AnyCPU</Platform>
    <OutputType>Library</OutputType>
    <RootNamespace>Legacy.App</RootNamespace>
    <AssemblyName>Legacy.App</AssemblyName>
  </PropertyGroup>
  <PropertyGroup Condition=" '$(Configuration)|$(Platform)' == 'Debug|AnyCPU' ">
    <DebugType>full</DebugType>
    <Optimize>false</Optimize>
    <DefineConstants>DEBUG;TRACE</DefineConstants>
  </PropertyGroup>
  <PropertyGroup Condition=" '$(Configuration)|$(Platform)' == 'Release|AnyCPU' ">
    <DebugType>pdbonly</DebugType>
    <Optimize>true</Optimize>
    <DefineConstants>TRACE</DefineConstants>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Class1.cs" />
  </ItemGroup>
</Project>
`;

suite('MsBuildProperties', () => {

    test('parseGroups 识别条件组与属性区间', () => {
        const groups = MsBuildProperties.parseGroups(LEGACY);
        assert.strictEqual(groups.length, 3);
        assert.strictEqual(groups[1].condition?.includes('Debug|AnyCPU'), true);
        assert.strictEqual(groups[0].properties.some(p => p.name === 'RootNamespace'), true);
        const root = groups[0].properties.find(p => p.name === 'RootNamespace');
        assert.strictEqual(root?.value, 'Legacy.App');
    });

    test('evaluateCondition 支持常见写法', () => {
        assert.strictEqual(
            MsBuildProperties.evaluateCondition(" '$(Configuration)|$(Platform)' == 'Debug|AnyCPU' ", 'Debug', 'AnyCPU'),
            true
        );
        assert.strictEqual(
            MsBuildProperties.evaluateCondition(" '$(Configuration)|$(Platform)' == 'Debug|AnyCPU' ", 'Release', 'AnyCPU'),
            false
        );
        assert.strictEqual(
            MsBuildProperties.evaluateCondition("'$(Configuration)' == 'Release'", 'Release', 'AnyCPU'),
            true
        );
        assert.strictEqual(
            MsBuildProperties.evaluateCondition("'$(Configuration)'=='Debug' And '$(Platform)'=='AnyCPU'", 'Debug', 'AnyCPU'),
            true
        );
        assert.strictEqual(
            MsBuildProperties.evaluateCondition("'$(Configuration)'=='Debug' Or '$(Configuration)'=='Release'", 'Release', 'AnyCPU'),
            true
        );
        // 无法识别的条件 → undefined，避免误判/覆盖
        assert.strictEqual(
            MsBuildProperties.evaluateCondition("'$(TargetFramework)'=='net8.0'", 'Debug', 'AnyCPU'),
            undefined
        );
    });

    test('getEffective 按当前配置取值', () => {
        assert.strictEqual(MsBuildProperties.getEffective(LEGACY, 'DefineConstants', { configuration: 'Debug' })?.value, 'DEBUG;TRACE');
        assert.strictEqual(MsBuildProperties.getEffective(LEGACY, 'DefineConstants', { configuration: 'Release' })?.value, 'TRACE');
        const debugType = MsBuildProperties.getEffective(LEGACY, 'DebugType', { configuration: 'Release' });
        assert.strictEqual(debugType?.value, 'pdbonly');
        assert.strictEqual(debugType?.conditional, true);
        assert.strictEqual(MsBuildProperties.getEffective(LEGACY, 'RootNamespace')?.conditional, false);
    });

    test('setProperty 替换条件组内的既有值，且其余内容逐字节保留', () => {
        const updated = MsBuildProperties.setProperty(LEGACY, 'DefineConstants', 'DEBUG;TRACE;EXTRA', {
            configuration: 'Debug',
            platform: 'AnyCPU',
        });
        assert.ok(updated.includes('<DefineConstants>DEBUG;TRACE;EXTRA</DefineConstants>'));
        // Release 组不受影响
        assert.ok(updated.includes('<DefineConstants>TRACE</DefineConstants>'));
        assert.ok(updated.includes('<!-- 这是注释，必须保留 -->'));
        assert.strictEqual(updated.replace('<DefineConstants>DEBUG;TRACE;EXTRA</DefineConstants>', '<DefineConstants>DEBUG;TRACE</DefineConstants>'), LEGACY);
    });

    test('setProperty 在目标组内追加新属性', () => {
        const updated = MsBuildProperties.setProperty(LEGACY, 'NoWarn', 'CS1591', {
            configuration: 'Release',
            platform: 'AnyCPU',
        });
        const releaseIndex = updated.indexOf("'Release|AnyCPU'");
        const noWarnIndex = updated.indexOf('<NoWarn>CS1591</NoWarn>');
        assert.ok(releaseIndex > 0 && noWarnIndex > releaseIndex);
        assert.ok(updated.includes('    <NoWarn>CS1591</NoWarn>'));
    });

    test('setProperty 无匹配条件组时新建条件组', () => {
        const withoutStaging = LEGACY.replace(/<PropertyGroup Condition=" '\\$\(Configuration\)\|\\$\(Platform\)' == 'Release\|AnyCPU' ">[\s\S]*?<\/PropertyGroup>\n/, '');
        const updated = MsBuildProperties.setProperty(withoutStaging, 'Optimize', 'true', {
            configuration: 'Staging',
            platform: 'AnyCPU',
        });
        assert.ok(updated.includes(`<PropertyGroup Condition="'$(Configuration)|$(Platform)' == 'Staging|AnyCPU'">`));
        assert.ok(updated.includes('<Optimize>true</Optimize>'));
    });

    test('setProperty 无条件属性写入第一个无条件组', () => {
        const updated = MsBuildProperties.setProperty(LEGACY, 'AssemblyName', 'Legacy.Renamed');
        assert.ok(updated.includes('<AssemblyName>Legacy.Renamed</AssemblyName>'));
        assert.ok(!updated.includes('<AssemblyName>Legacy.App</AssemblyName>'));
        assert.strictEqual(MsBuildProperties.getEffective(updated, 'AssemblyName')?.value, 'Legacy.Renamed');
    });

    test('removeProperty 删除整行并保留相邻内容', () => {
        const updated = MsBuildProperties.removeProperty(LEGACY, 'Optimize', { configuration: 'Debug', platform: 'AnyCPU' });
        assert.ok(!updated.includes('<Optimize>false</Optimize>'));
        // Release 组的 Optimize 仍在
        assert.ok(updated.includes('<Optimize>true</Optimize>'));
        assert.ok(updated.includes('<DebugType>full</DebugType>'));
    });

    test('CRLF 文件保持 CRLF', () => {
        const crlf = LEGACY.replace(/\n/g, '\r\n');
        const updated = MsBuildProperties.setProperty(crlf, 'NoWarn', 'CS8618', {
            configuration: 'Debug',
            platform: 'AnyCPU',
        });
        assert.ok(updated.includes('<NoWarn>CS8618</NoWarn>\r\n'));
        assert.strictEqual(updated.includes('\n') && !updated.includes('\r\n'), false);
    });

    test('getConfigurations / getPlatforms 收集并补默认值', () => {
        assert.deepStrictEqual(MsBuildProperties.getConfigurations(LEGACY), ['Debug', 'Release']);
        assert.deepStrictEqual(MsBuildProperties.getPlatforms(LEGACY), ['AnyCPU']);

        const minimal = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>';
        assert.deepStrictEqual(MsBuildProperties.getConfigurations(minimal), ['Debug', 'Release']);
        assert.deepStrictEqual(MsBuildProperties.getPlatforms(minimal), ['AnyCPU']);

        const custom = LEGACY.replace(/Release\|AnyCPU/g, 'Staging|x64');
        assert.deepStrictEqual(MsBuildProperties.getConfigurations(custom), ['Debug', 'Staging']);
        assert.deepStrictEqual(MsBuildProperties.getPlatforms(custom), ['AnyCPU', 'x64']);
    });

    test('自闭合属性写入时展开为成对标签', () => {
        const xml = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><ImplicitUsings /></PropertyGroup></Project>';
        const updated = MsBuildProperties.setProperty(xml, 'ImplicitUsings', 'enable');
        assert.ok(updated.includes('<ImplicitUsings>enable</ImplicitUsings>'));
    });
});
