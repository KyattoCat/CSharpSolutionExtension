import * as assert from 'assert';
import { CsprojSerializer } from '../serialization/CsprojSerializer';

suite('CsprojSerializer — parse', () => {

    test('解析 Compile 元素（自闭合标签）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Program.cs" />
    <Compile Include="Models\\User.cs" />
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.compiles.length, 2);
        assert.strictEqual(project.compiles[0].include, 'Program.cs');
        assert.strictEqual(project.compiles[1].include, 'Models\\User.cs');
    });

    test('解析 Compile 元素（带子元素）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Global.asax.cs">
      <DependentUpon>Global.asax</DependentUpon>
    </Compile>
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.compiles.length, 1);
        assert.strictEqual(project.compiles[0].include, 'Global.asax.cs');
        assert.strictEqual(project.compiles[0].dependentUpon, 'Global.asax');
    });

    test('解析 Compile 带 Link 子元素', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="..\\Shared\\Common.cs">
      <Link>Shared\\Common.cs</Link>
    </Compile>
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.compiles[0].link, 'Shared\\Common.cs');
    });

    test('解析 Compile 同时带 Link 和 DependentUpon', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Global.asax.cs">
      <DependentUpon>Global.asax</DependentUpon>
      <Link>Global.asax.cs</Link>
    </Compile>
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.compiles[0].dependentUpon, 'Global.asax');
        assert.strictEqual(project.compiles[0].link, 'Global.asax.cs');
    });

    test('解析 Compile 带额外属性（Condition）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Program.cs" Condition="'$(Configuration)'=='Debug'" />
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.compiles.length, 1);
        assert.strictEqual(project.compiles[0].include, 'Program.cs');
    });

    test('解析 Reference 元素（带子元素）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Reference Include="System.Data">
      <HintPath>..\\lib\\System.Data.dll</HintPath>
    </Reference>
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.references.length, 1);
        assert.strictEqual(project.references[0].include, 'System.Data');
        assert.strictEqual(project.references[0].hintPath, '..\\lib\\System.Data.dll');
    });

    test('解析 Reference 元素（自闭合标签）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Reference Include="System" />
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.references.length, 1);
        assert.strictEqual(project.references[0].include, 'System');
    });

    test('解析 Reference 混合自闭合和带子元素', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Reference Include="System" />
    <Reference Include="System.Data">
      <HintPath>..\\lib\\System.Data.dll</HintPath>
    </Reference>
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.references.length, 2);
        assert.strictEqual(project.references[0].include, 'System');
        assert.strictEqual(project.references[1].include, 'System.Data');
        assert.strictEqual(project.references[1].hintPath, '..\\lib\\System.Data.dll');
    });

    test('解析 ProjectReference 元素（带子元素）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <ProjectReference Include="..\\Lib\\Lib.csproj">
      <Name>Lib</Name>
    </ProjectReference>
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.projectReferences.length, 1);
        assert.strictEqual(project.projectReferences[0].include, '..\\Lib\\Lib.csproj');
        assert.strictEqual(project.projectReferences[0].name, 'Lib');
    });

    test('解析 ProjectReference 元素（自闭合标签）', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <ProjectReference Include="..\\X\\X.csproj" />
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.projectReferences.length, 1);
        assert.strictEqual(project.projectReferences[0].include, '..\\X\\X.csproj');
    });

    test('解析 Analyzer 元素', () => {
        const xml = `<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Analyzer Include="..\\packages\\SomeAnalyzer.dll" />
  </ItemGroup>
</Project>`;
        const project = CsprojSerializer.parse(xml, '/fake/Test.csproj');
        assert.strictEqual(project.analyzers.length, 1);
        assert.strictEqual(project.analyzers[0].include, '..\\packages\\SomeAnalyzer.dll');
    });
});
