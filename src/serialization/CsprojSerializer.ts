import { CsprojProject, CompileItem, ReferenceItem, ProjectReferenceItem, AnalyzerItem, PackageItem } from '../models/CsprojModel';
import * as path from 'path';
import * as fs from 'fs';

export class CsprojSerializer {

    /** 判断是否为 SDK 风格项目（<Project Sdk="...">） */
    static isSdk(xml: string): boolean {
        return /<Project\s+Sdk="[^"]*"/.test(xml);
    }

    /**
     * 解析 .csproj 文件内容为 CsprojProject 模型。
     * 使用正则表达式逐类提取，不依赖外部 XML 库。
     * 自动检测 SDK 风格项目并路由到对应的解析逻辑。
     */
    static parse(xml: string, filePath: string): CsprojProject {
        const name = path.basename(filePath, '.csproj');
        const isSdk = this.isSdk(xml);

        if (isSdk) {
            return this.parseSdk(xml, filePath, name);
        }
        return this.parseLegacy(xml, filePath, name);
    }

    private static parseLegacy(xml: string, filePath: string, name: string): CsprojProject {
        return {
            path: filePath, name, isSdk: false,
            compiles: this.parseCompiles(xml),
            references: this.parseReferences(xml),
            projectReferences: this.parseProjectReferences(xml),
            packages: [],
            analyzers: this.parseAnalyzers(xml),
        };
    }

    private static parseSdk(xml: string, filePath: string, name: string): CsprojProject {
        const projectDir = path.dirname(filePath);
        return {
            path: filePath, name, isSdk: true,
            compiles: this.globSourceFiles(projectDir, xml),
            references: this.parseReferences(xml),
            projectReferences: this.parseProjectReferences(xml),
            packages: this.parsePackageReferences(xml),
            analyzers: this.parseAnalyzers(xml),
        };
    }

    /** Glob .cs files in project dir, applying Compile Remove and None rules */
    static globSourceFiles(projectDir: string, xml: string): CompileItem[] {
        // Parse Compile Remove patterns
        const removePatterns: string[] = [];
        const removeRegex = /<Compile\s+Remove="([^"]*)"/g;
        let rm: RegExpExecArray | null;
        while ((rm = removeRegex.exec(xml)) !== null) {
            removePatterns.push(rm[1]);
        }

        // Parse None Include patterns (exclude from compilation)
        const nonePatterns: string[] = [];
        const noneRegex = /<None\s+Include="([^"]*)"/g;
        let nm: RegExpExecArray | null;
        while ((nm = noneRegex.exec(xml)) !== null) {
            nonePatterns.push(nm[1]);
        }

        const files = this.walkDir(projectDir, projectDir);

        return files
            .filter(f => {
                const rel = path.relative(projectDir, f).replace(/\\/g, '/');
                return !this.matchesGlob(rel, removePatterns) && !this.matchesGlob(rel, nonePatterns);
            })
            .sort((a, b) => a.localeCompare(b))
            .map(f => ({ include: path.relative(projectDir, f) }));
    }

    private static walkDir(dir: string, root: string): string[] {
        const results: string[] = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'bin' || entry.name === 'obj' || entry.name === 'node_modules') continue;
                    results.push(...this.walkDir(full, root));
                } else if (entry.name.endsWith('.cs')) {
                    results.push(full);
                }
            }
        } catch { /* dir not readable */ }
        return results;
    }

    private static matchesGlob(relPath: string, patterns: string[]): boolean {
        for (const pat of patterns) {
            const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regexStr = '^' + escaped
                .replace(/\\\\\*\\\\\*/g, '.*')
                .replace(/\\\\\*/g, '[^/]*')
                .replace(/\\\\\?/g, '.') + '$';
            if (new RegExp(regexStr).test(relPath)) return true;
        }
        return false;
    }

    /** Parse <PackageReference Include="..." Version="..." /> elements */
    static parsePackageReferences(xml: string): PackageItem[] {
        const results: PackageItem[] = [];
        const regex = /<PackageReference\s+Include="([^"]*)"\s+Version="([^"]*)"[^>]*\/?>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
            const item: PackageItem = { id: match[1], version: match[2] };
            const tfm = match[0].match(/TargetFramework="([^"]*)"/);
            if (tfm) item.targetFramework = tfm[1];
            results.push(item);
        }
        return results;
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

    /**
     * 向 .csproj 内容中添加一个 <Compile Include="..."> 元素。
     * 策略：找到最后一个已有 Compile 的位置，在其后插入新行。
     * 如果项目中尚无 Compile，则在 </Project> 之前创建 ItemGroup。
     */
    static addCompile(xml: string, include: string): string {
        const newLine = `    <Compile Include="${include}" />`;

        // 查找所有 Compile Include 行
        const compileRegex = /^\s*<Compile\s+Include="[^"]*"/gm;
        const matches = [...xml.matchAll(compileRegex)];

        if (matches.length > 0) {
            // 找到最后一个 Compile 块的结束位置
            const lastMatch = matches[matches.length - 1];
            const startIndex = lastMatch.index!;

            // 查找这个 Compile 元素的结束位置（/> 或 </Compile>）
            const rest = xml.slice(startIndex);
            const selfCloseEnd = rest.indexOf('/>');
            const closeTagEnd = rest.indexOf('</Compile>');

            let insertPos: number;
            if (selfCloseEnd !== -1 && (closeTagEnd === -1 || selfCloseEnd < closeTagEnd)) {
                insertPos = startIndex + selfCloseEnd + 2; // 跳过 />
            } else {
                insertPos = startIndex + closeTagEnd + '</Compile>'.length;
            }

            // 跳到该行末尾（下一个换行符之后）
            const newlineAfter = xml.indexOf('\n', insertPos);
            insertPos = newlineAfter !== -1 ? newlineAfter + 1 : xml.length;

            return xml.slice(0, insertPos) + newLine + '\n' + xml.slice(insertPos);
        }

        // 无 Compile —— 在 </Project> 前创建 ItemGroup
        const projectClose = xml.lastIndexOf('</Project>');
        const itemGroup = `  <ItemGroup>\n${newLine}\n  </ItemGroup>\n`;
        if (projectClose !== -1) {
            return xml.slice(0, projectClose) + itemGroup + xml.slice(projectClose);
        }
        return xml + '\n' + itemGroup;
    }

    /**
     * 从 .csproj 内容中移除指定 Include 的 <Compile> 元素。
     * 同时处理自闭合和带子元素两种形式。
     */
    static removeCompile(xml: string, include: string): string {
        // 转义所有正则元字符
        const escaped = include.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // 先尝试匹配带子元素形式（注意使用 (?<!\/)> 来避免匹配自闭合标签）
        const withChildren = new RegExp(
            `[^\\S\\n]*<Compile\\s+Include="${escaped}"[^>]*(?<!\/)>[\\s\\S]*?<\\/Compile>[^\\S\\n]*\\n?`,
            'g'
        );
        const withChildrenResult = xml.replace(withChildren, '');
        if (withChildrenResult !== xml) {
            return withChildrenResult;
        }

        // 再尝试自闭合形式
        const selfClosing = new RegExp(
            `[^\\S\\n]*<Compile\\s+Include="${escaped}"[^>]*\\/>[^\\S\\n]*\\n?`,
            'g'
        );
        return xml.replace(selfClosing, '');
    }

    /**
     * 更新 .csproj 中某个 <Compile> 的 Include 路径。
     * oldInclude → newInclude，处理自闭合和带子元素两种形式。
     * 如果找不到匹配的 oldInclude，返回原 xml 不变。
     */
    static updateCompilePath(xml: string, oldInclude: string, newInclude: string): string {
        const escaped = oldInclude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // 尝试替换带子元素形式
        const withChildren = new RegExp(
            `(<Compile\\s+Include=")${escaped}("[^>]*(?<!\/)>[\\s\\S]*?<\\/Compile>)`,
            'g'
        );
        if (withChildren.test(xml)) {
            withChildren.lastIndex = 0;
            return xml.replace(withChildren, `$1${newInclude}$2`);
        }

        // 尝试替换自闭合形式
        const selfClosing = new RegExp(
            `(<Compile\\s+Include=")${escaped}("[^>]*\\/>)`,
            'g'
        );
        return xml.replace(selfClosing, `$1${newInclude}$2`);
    }
}
