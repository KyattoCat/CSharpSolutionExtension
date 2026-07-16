import { CsprojProject, CompileItem, ReferenceItem, ProjectReferenceItem, PackageItem, AnalyzerItem, Solution } from './CsprojModel';

/** 树节点联合类型 —— 每种节点携带自身所需数据 */
export type ProjectNode =
    | { type: 'project'; project: CsprojProject }
    | { type: 'refGroup'; projectPath: string }
    | { type: 'refSubGroup'; label: string; projectPath: string }
    | { type: 'reference'; item: ReferenceItem; projectPath: string }
    | { type: 'projectRef'; item: ProjectReferenceItem; projectPath: string }
    | { type: 'package'; item: PackageItem; projectPath: string }
    | { type: 'analyzer'; item: AnalyzerItem; projectPath: string }
    | { type: 'folder'; relPath: string; projectPath: string }
    | { type: 'file'; compile: CompileItem; projectPath: string }
    | { type: 'solution'; solution: Solution };
