import * as assert from 'assert';
import { ProjectPropertiesModel, ReferenceChanges } from '../services/ProjectPropertiesModel';

const SDK = `<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <RootNamespace>Game.World</RootNamespace>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <ProjectReference Include="..\\Core\\Core.csproj" />
  </ItemGroup>
</Project>
`;

const LEGACY = `<Project ToolsVersion="15.0">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <RootNamespace>Legacy.App</RootNamespace>
    <TargetFrameworkVersion>v4.8</TargetFrameworkVersion>
  </PropertyGroup>
  <PropertyGroup Condition=" '$(Configuration)|$(Platform)' == 'Debug|AnyCPU' ">
    <DefineConstants>DEBUG;TRACE</DefineConstants>
    <Optimize>false</Optimize>
  </PropertyGroup>
  <PropertyGroup Condition=" '$(Configuration)|$(Platform)' == 'Release|AnyCPU' ">
    <DefineConstants>TRACE</DefineConstants>
    <Optimize>true</Optimize>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="MyLib">
      <HintPath>..\\libs\\MyLib.dll</HintPath>
    </Reference>
    <Analyzer Include="..\\analyzers\\Rules.dll" />
  </ItemGroup>
</Project>
`;

function emptyRefs(): ReferenceChanges {
    return {
        addPackages: [],
        setPackageVersions: [],
        removePackages: [],
        addProjectReferences: [],
        removeProjectReferences: [],
        addAssemblyReferences: [],
        removeAssemblyReferences: [],
        removeAnalyzers: [],
    };
}

suite('ProjectPropertiesModel', () => {

    test('snapshot 读取 SDK 项目的字段与引用', () => {
        const snapshot = ProjectPropertiesModel.snapshot(SDK, { projectPath: 'C:\\ws\\Game\\Game.csproj' });
        assert.strictEqual(snapshot.projectName, 'Game');
        assert.strictEqual(snapshot.isSdk, true);
        assert.deepStrictEqual(snapshot.configurations, ['Debug', 'Release']);
        assert.deepStrictEqual(snapshot.platforms, ['AnyCPU']);

        const field = (id: string) => snapshot.fields.find(item => item.id === id);
        assert.strictEqual(field('rootNamespace')?.value, 'Game.World');
        assert.strictEqual(field('targetFramework')?.value, 'net8.0');
        assert.strictEqual(field('outputType')?.value, 'Exe');
        assert.strictEqual(field('nullable')?.value, 'enable');
        assert.strictEqual(field('packageId')?.present, false);

        assert.deepStrictEqual(snapshot.packages, [{ id: 'Newtonsoft.Json', version: '13.0.3' }]);
        assert.deepStrictEqual(snapshot.projectReferences, [{ include: '..\\Core\\Core.csproj', name: undefined }]);
    });

    test('snapshot 按配置读取条件组，并统计未展示项', () => {
        const debug = ProjectPropertiesModel.snapshot(LEGACY, { projectPath: '/ws/Legacy.csproj', configuration: 'Debug' });
        assert.strictEqual(debug.fields.find(field => field.id === 'defineConstants')?.value, 'DEBUG;TRACE');
        assert.strictEqual(debug.fields.find(field => field.id === 'defineConstants')?.conditional, true);

        const release = ProjectPropertiesModel.snapshot(LEGACY, { projectPath: '/ws/Legacy.csproj', configuration: 'Release' });
        assert.strictEqual(release.fields.find(field => field.id === 'defineConstants')?.value, 'TRACE');

        // TargetFrameworkVersion 不在 schema 中 → 计入未展示
        assert.ok(release.untouchedCount >= 1);
        assert.strictEqual(release.assemblyReferences[0].hintPath, '..\\libs\\MyLib.dll');
        assert.deepStrictEqual(release.analyzers, [{ include: '..\\analyzers\\Rules.dll' }]);
    });

    test('apply 写入项目级属性（无条件组）', () => {
        const result = ProjectPropertiesModel.apply(SDK, [
            { id: 'rootNamespace', scope: 'project', value: 'Game.Core' },
            { id: 'assemblyName', scope: 'project', value: 'Game.Core.Assembly' },
        ], emptyRefs());
        assert.deepStrictEqual(result.errors, []);
        assert.ok(result.xml.includes('<RootNamespace>Game.Core</RootNamespace>'));
        assert.ok(result.xml.includes('<AssemblyName>Game.Core.Assembly</AssemblyName>'));
        assert.ok(result.xml.includes('<ProjectReference'));
    });

    test('apply 写入当前配置的条件组，不影响另一配置', () => {
        const result = ProjectPropertiesModel.apply(LEGACY, [
            { id: 'defineConstants', scope: 'configuration', configuration: 'Debug', platform: 'AnyCPU', value: 'DEBUG;TRACE;NEW' },
        ], emptyRefs());
        assert.deepStrictEqual(result.errors, []);
        const debugSection = result.xml.slice(result.xml.indexOf("'Debug|AnyCPU'"), result.xml.indexOf("'Release|AnyCPU'"));
        const releaseSection = result.xml.slice(result.xml.indexOf("'Release|AnyCPU'"));
        assert.ok(debugSection.includes('<DefineConstants>DEBUG;TRACE;NEW</DefineConstants>'));
        assert.ok(releaseSection.includes('<DefineConstants>TRACE</DefineConstants>'));
    });

    test('apply 空值删除属性（恢复默认）', () => {
        const result = ProjectPropertiesModel.apply(SDK, [
            { id: 'nullable', scope: 'project', value: null },
        ], emptyRefs());
        assert.deepStrictEqual(result.errors, []);
        assert.ok(!result.xml.includes('<Nullable>'));
    });

    test('apply 引用变更：增删包、项目引用与程序集引用', () => {
        const refs = emptyRefs();
        refs.addPackages = [{ id: 'Serilog', version: '3.1.1' }];
        refs.removePackages = ['Newtonsoft.Json'];
        refs.removeProjectReferences = ['..\\Core\\Core.csproj'];
        refs.addAssemblyReferences = [{ include: 'MyLib2', hintPath: '..\\libs\\MyLib2.dll' }];
        refs.removeAnalyzers = ['..\\analyzers\\Rules.dll'];
        refs.setPackageVersions = [{ id: 'Serilog', version: '3.1.1' }];

        const result = ProjectPropertiesModel.apply(LEGACY, [], refs);
        assert.deepStrictEqual(result.errors, []);
        assert.ok(!result.xml.includes('Newtonsoft.Json'));
        assert.ok(!result.xml.includes('Core.csproj'));
        assert.ok(!result.xml.includes('Rules.dll'));
        assert.ok(result.xml.includes('<Reference Include="MyLib2">'));
    });

    test('apply 校验非法值并返回错误', () => {
        const tfm = ProjectPropertiesModel.apply(SDK, [
            { id: 'targetFramework', scope: 'project', value: 'net-8' },
        ], emptyRefs());
        assert.strictEqual(tfm.errors.length, 1);
        assert.ok(tfm.errors[0].includes('目标框架'));

        const ns = ProjectPropertiesModel.apply(SDK, [
            { id: 'rootNamespace', scope: 'project', value: 'Game..World' },
        ], emptyRefs());
        assert.strictEqual(ns.errors.length, 1);
        assert.ok(ns.errors[0].includes('命名空间'));
    });

    test('多目标项目写回 TargetFrameworks 而不是新增 TargetFramework', () => {
        const multi = SDK.replace('<TargetFramework>net8.0</TargetFramework>', '<TargetFrameworks>net8.0;net48</TargetFrameworks>');
        const result = ProjectPropertiesModel.apply(multi, [
            { id: 'targetFramework', scope: 'project', value: 'net8.0;netstandard2.0' },
        ], emptyRefs());
        assert.deepStrictEqual(result.errors, []);
        assert.ok(result.xml.includes('<TargetFrameworks>net8.0;netstandard2.0</TargetFrameworks>'));
        assert.ok(!result.xml.includes('<TargetFramework>net8.0</TargetFramework>'));
    });
});
