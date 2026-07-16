/** 表示一个 .csproj 项目解析后的完整数据 */
export interface CsprojProject {
    /** .csproj 文件的绝对路径 */
    path: string;
    /** 项目名称（不含 .csproj 扩展名） */
    name: string;
    compiles: CompileItem[];
    references: ReferenceItem[];
    projectReferences: ProjectReferenceItem[];
    packages: PackageItem[];
    analyzers: AnalyzerItem[];
}

export interface CompileItem {
    /** Include 属性值，相对路径，如 "Models\\User.cs" */
    include: string;
    /** Link 子元素（可选），用于链接文件 */
    link?: string;
    /** DependentUpon 子元素（可选），如 "Global.asax" */
    dependentUpon?: string;
}

export interface ReferenceItem {
    /** Include 属性值，如 "System.Data" */
    include: string;
    /** HintPath 子元素（可选） */
    hintPath?: string;
}

export interface ProjectReferenceItem {
    /** Include 属性值，相对路径 */
    include: string;
    /** Name 子元素（可选） */
    name?: string;
}

export interface PackageItem {
    /** NuGet 包 ID */
    id: string;
    /** 版本号 */
    version: string;
    /** 目标框架（可选） */
    targetFramework?: string;
}

export interface AnalyzerItem {
    /** Include 属性值 */
    include: string;
}

export interface Solution {
    name: string;
    path: string;
    projects: SolutionProject[];
}

export interface SolutionProject {
    name: string;
    relPath: string;
    guid: string;
}
