/** 项目属性界面的字段声明：新增字段只需往 FIELD_SPECS 里加一行 */

export type PropertyTab = 'application' | 'build' | 'package';
export type FieldType = 'text' | 'bool' | 'select' | 'multiline';
export type FieldScope = 'project' | 'configuration';

export interface FieldSpec {
    id: string;
    tab: PropertyTab;
    label: string;
    type: FieldType;
    /**
     * 对应的 MSBuild 属性名，按顺序取第一个存在的；
     * 都不存在时用第一个写入（如 SDK 多目标项目写 TargetFrameworks）。
     */
    properties: string[];
    /** project = 无条件属性；configuration = 按当前 Debug/Release 写入条件组 */
    scope: FieldScope;
    options?: string[];
    placeholder?: string;
    hint?: string;
    validate?: 'tfm' | 'namespace';
    /** 仅 SDK 风格项目显示（打包相关） */
    sdkOnly?: boolean;
}

export const TAB_LABELS: Record<PropertyTab, string> = {
    application: '应用程序',
    build: '生成',
    package: '包',
};

export const FIELD_SPECS: FieldSpec[] = [
    // --- 应用程序 ---
    {
        id: 'targetFramework',
        tab: 'application',
        label: '目标框架',
        type: 'text',
        properties: ['TargetFrameworks', 'TargetFramework'],
        scope: 'project',
        placeholder: 'net8.0',
        hint: '多目标框架用分号分隔，如 net8.0;net48',
        validate: 'tfm',
    },
    {
        id: 'outputType',
        tab: 'application',
        label: '输出类型',
        type: 'select',
        properties: ['OutputType'],
        scope: 'project',
        options: ['Library', 'Exe', 'WinExe', 'Module', 'AppContainerExe'],
        placeholder: 'Library',
    },
    {
        id: 'assemblyName',
        tab: 'application',
        label: '程序集名称',
        type: 'text',
        properties: ['AssemblyName'],
        scope: 'project',
        placeholder: '默认与项目文件名相同',
    },
    {
        id: 'rootNamespace',
        tab: 'application',
        label: '根命名空间',
        type: 'text',
        properties: ['RootNamespace'],
        scope: 'project',
        placeholder: '默认与程序集名称相同',
        hint: '新建类时用作命名空间前缀',
        validate: 'namespace',
    },
    {
        id: 'startupObject',
        tab: 'application',
        label: '启动对象',
        type: 'text',
        properties: ['StartupObject'],
        scope: 'project',
        placeholder: '命名空间.类名',
    },

    // --- 生成（按 Debug / Release 分别保存） ---
    {
        id: 'defineConstants',
        tab: 'build',
        label: '条件编译符号',
        type: 'text',
        properties: ['DefineConstants'],
        scope: 'configuration',
        placeholder: 'DEBUG;TRACE',
    },
    {
        id: 'langVersion',
        tab: 'build',
        label: 'C# 语言版本',
        type: 'text',
        properties: ['LangVersion'],
        scope: 'configuration',
        placeholder: 'latest',
    },
    {
        id: 'nullable',
        tab: 'build',
        label: '可空引用类型',
        type: 'select',
        properties: ['Nullable'],
        scope: 'configuration',
        options: ['enable', 'disable', 'annotations', 'warnings'],
    },
    {
        id: 'implicitUsings',
        tab: 'build',
        label: '隐式 using',
        type: 'select',
        properties: ['ImplicitUsings'],
        scope: 'configuration',
        options: ['enable', 'disable'],
    },
    {
        id: 'allowUnsafeBlocks',
        tab: 'build',
        label: '允许不安全代码',
        type: 'bool',
        properties: ['AllowUnsafeBlocks'],
        scope: 'configuration',
    },
    {
        id: 'generateDocumentationFile',
        tab: 'build',
        label: '生成 XML 文档',
        type: 'bool',
        properties: ['GenerateDocumentationFile'],
        scope: 'configuration',
    },
    {
        id: 'treatWarningsAsErrors',
        tab: 'build',
        label: '将警告视为错误',
        type: 'bool',
        properties: ['TreatWarningsAsErrors'],
        scope: 'configuration',
    },
    {
        id: 'optimize',
        tab: 'build',
        label: '优化代码',
        type: 'bool',
        properties: ['Optimize'],
        scope: 'configuration',
    },
    {
        id: 'debugType',
        tab: 'build',
        label: '调试符号',
        type: 'select',
        properties: ['DebugType'],
        scope: 'configuration',
        options: ['portable', 'full', 'pdbonly', 'embedded', 'none'],
    },
    {
        id: 'platformTarget',
        tab: 'build',
        label: '目标平台',
        type: 'select',
        properties: ['PlatformTarget'],
        scope: 'configuration',
        options: ['AnyCPU', 'x86', 'x64', 'ARM64'],
    },
    {
        id: 'noWarn',
        tab: 'build',
        label: '忽略的警告',
        type: 'text',
        properties: ['NoWarn'],
        scope: 'configuration',
        placeholder: 'CS1591;CS8618',
    },
    {
        id: 'preBuildEvent',
        tab: 'build',
        label: '生成前事件',
        type: 'multiline',
        properties: ['PreBuildEvent'],
        scope: 'configuration',
        placeholder: '生成前执行的命令行',
    },
    {
        id: 'postBuildEvent',
        tab: 'build',
        label: '生成后事件',
        type: 'multiline',
        properties: ['PostBuildEvent'],
        scope: 'configuration',
        placeholder: '生成后执行的命令行',
    },

    // --- 包（仅 SDK 项目） ---
    {
        id: 'packageId',
        tab: 'package',
        label: '包 ID',
        type: 'text',
        properties: ['PackageId'],
        scope: 'project',
        sdkOnly: true,
    },
    {
        id: 'packageVersion',
        tab: 'package',
        label: '包版本',
        type: 'text',
        properties: ['Version', 'PackageVersion'],
        scope: 'project',
        sdkOnly: true,
        placeholder: '1.0.0',
    },
    {
        id: 'authors',
        tab: 'package',
        label: '作者',
        type: 'text',
        properties: ['Authors'],
        scope: 'project',
        sdkOnly: true,
    },
    {
        id: 'company',
        tab: 'package',
        label: '公司',
        type: 'text',
        properties: ['Company'],
        scope: 'project',
        sdkOnly: true,
    },
    {
        id: 'description',
        tab: 'package',
        label: '描述',
        type: 'multiline',
        properties: ['Description'],
        scope: 'project',
        sdkOnly: true,
    },
    {
        id: 'packageLicenseExpression',
        tab: 'package',
        label: '许可证表达式',
        type: 'text',
        properties: ['PackageLicenseExpression'],
        scope: 'project',
        sdkOnly: true,
        placeholder: 'MIT',
    },
    {
        id: 'repositoryUrl',
        tab: 'package',
        label: '仓库地址',
        type: 'text',
        properties: ['RepositoryUrl'],
        scope: 'project',
        sdkOnly: true,
    },
    {
        id: 'isPackable',
        tab: 'package',
        label: '可打包',
        type: 'bool',
        properties: ['IsPackable'],
        scope: 'project',
        sdkOnly: true,
    },
    {
        id: 'generatePackageOnBuild',
        tab: 'package',
        label: '生成时打包',
        type: 'bool',
        properties: ['GeneratePackageOnBuild'],
        scope: 'project',
        sdkOnly: true,
    },
];

/** 界面已覆盖的属性名集合（用于统计"未展示"的配置项） */
export const KNOWN_PROPERTIES = new Set(FIELD_SPECS.flatMap(spec => spec.properties));

export function getFieldSpec(id: string): FieldSpec | undefined {
    return FIELD_SPECS.find(spec => spec.id === id);
}
