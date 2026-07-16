import { CsprojProject, CompileItem, ReferenceItem, ProjectReferenceItem, AnalyzerItem } from '../models/CsprojModel';
import * as path from 'path';

export class CsprojSerializer {

    /**
     * 解析 .csproj 文件内容为 CsprojProject 模型。
     * 使用正则表达式逐类提取，不依赖外部 XML 库。
     */
    static parse(xml: string, filePath: string): CsprojProject {
        const name = path.basename(filePath, '.csproj');

        return {
            path: filePath,
            name,
            compiles: this.parseCompiles(xml),
            references: this.parseReferences(xml),
            projectReferences: this.parseProjectReferences(xml),
            packages: [],    // packages 由 PackagesConfigSerializer 处理
            analyzers: this.parseAnalyzers(xml),
        };
    }

    /** 解析所有 <Compile Include="..."> 元素，支持自闭合和带子元素两种形式 */
    static parseCompiles(xml: string): CompileItem[] {
        const results: CompileItem[] = [];

        // 匹配自闭合的 Compile（以 /> 结束）。
        const selfClosingRegex = /<Compile\s+Include="([^"]*)"[^>]*\/>/g;
        let match: RegExpExecArray | null;
        while ((match = selfClosingRegex.exec(xml)) !== null) {
            results.push({ include: match[1] });
        }

        // 匹配带子元素的 Compile（</Compile> 闭合）。
        // (?<!\/)> 排除自闭合 />，避免误吞后续标签。
        const withChildrenRegex = /<Compile\s+Include="([^"]*)"[^>]*(?<!\/)>([\s\S]*?)<\/Compile>/g;
        while ((match = withChildrenRegex.exec(xml)) !== null) {
            const include = match[1];
            const inner = match[2];
            const item: CompileItem = { include };

            const linkMatch = inner.match(/<Link>([\s\S]*?)<\/Link>/);
            if (linkMatch) {
                item.link = linkMatch[1].trim();
            }

            const dependentUponMatch = inner.match(/<DependentUpon>([\s\S]*?)<\/DependentUpon>/);
            if (dependentUponMatch) {
                item.dependentUpon = dependentUponMatch[1].trim();
            }

            results.push(item);
        }

        return results;
    }

    /** 解析 <Reference Include="..."> 元素，支持自闭合和带子元素两种形式 */
    static parseReferences(xml: string): ReferenceItem[] {
        const results: ReferenceItem[] = [];

        // 匹配自闭合的 Reference（以 /> 结束）。无 HintPath。
        const selfClosingRegex = /<Reference\s+Include="([^"]*)"[^>]*\/>/g;
        let match: RegExpExecArray | null;
        while ((match = selfClosingRegex.exec(xml)) !== null) {
            results.push({ include: match[1] });
        }

        // 匹配带子元素的 Reference（</Reference> 闭合）。
        // (?<!\/)> 排除自闭合 />，避免误吞后续标签。
        const withChildrenRegex = /<Reference\s+Include="([^"]*)"[^>]*(?<!\/)>([\s\S]*?)<\/Reference>/g;
        while ((match = withChildrenRegex.exec(xml)) !== null) {
            const item: ReferenceItem = { include: match[1] };
            const hintMatch = match[2].match(/<HintPath>([\s\S]*?)<\/HintPath>/);
            if (hintMatch) {
                item.hintPath = hintMatch[1].trim();
            }
            results.push(item);
        }

        return results;
    }

    /** 解析 <ProjectReference Include="..."> 元素，支持自闭合和带子元素两种形式 */
    static parseProjectReferences(xml: string): ProjectReferenceItem[] {
        const results: ProjectReferenceItem[] = [];

        // 匹配自闭合的 ProjectReference（以 /> 结束）。无 Name。
        const selfClosingRegex = /<ProjectReference\s+Include="([^"]*)"[^>]*\/>/g;
        let match: RegExpExecArray | null;
        while ((match = selfClosingRegex.exec(xml)) !== null) {
            results.push({ include: match[1] });
        }

        // 匹配带子元素的 ProjectReference（</ProjectReference> 闭合）。
        // (?<!\/)> 排除自闭合 />，避免误吞后续标签。
        const withChildrenRegex = /<ProjectReference\s+Include="([^"]*)"[^>]*(?<!\/)>([\s\S]*?)<\/ProjectReference>/g;
        while ((match = withChildrenRegex.exec(xml)) !== null) {
            const item: ProjectReferenceItem = { include: match[1] };
            const nameMatch = match[2].match(/<Name>([\s\S]*?)<\/Name>/);
            if (nameMatch) {
                item.name = nameMatch[1].trim();
            }
            results.push(item);
        }

        return results;
    }

    /** 解析 <Analyzer Include="..."> 元素 */
    static parseAnalyzers(xml: string): AnalyzerItem[] {
        const results: AnalyzerItem[] = [];
        const regex = /<Analyzer\s+Include="([^"]*)"[^>]*\/?>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
            results.push({ include: match[1] });
        }
        return results;
    }
}
