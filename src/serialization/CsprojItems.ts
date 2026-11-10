import {
    findElements,
    getAttribute,
    indentAt,
    insertBlockAfterElement,
    insertLineAfterLastElement,
    removeElementAt,
    xmlAttributeEscape,
    detectEol,
} from './xmlText';

/**
 * csproj 条目（ItemGroup 子元素）的增删改：
 * PackageReference / ProjectReference / Reference（程序集）/ Analyzer。
 *
 * 与 CsprojSerializer 一样采用文本级最小编辑，保留注释与格式。
 */
export class CsprojItems {

    /** 添加 <PackageReference Include="id" Version="v" />；已存在同 id 则原样返回 */
    static addPackageReference(xml: string, id: string, version: string): string {
        if (this.findByInclude(xml, 'PackageReference', id)) {
            return xml;
        }
        const indent = this.itemIndent(xml, 'PackageReference');
        const line = `${indent}<PackageReference Include="${xmlAttributeEscape(id)}" Version="${xmlAttributeEscape(version)}" />`;
        return insertLineAfterLastElement(xml, 'PackageReference', line, this.groupIndent(xml));
    }

    /** 修改 PackageReference 的 Version 属性 */
    static setPackageVersion(xml: string, id: string, version: string): string {
        const element = this.findByInclude(xml, 'PackageReference', id);
        if (!element) {
            return xml;
        }
        const escaped = xmlAttributeEscape(version);
        const versionAttribute = /\sVersion\s*=\s*("([^"]*)"|'([^']*)')/.exec(element.text);
        if (versionAttribute) {
            const start = element.start + versionAttribute.index;
            const replacement = ` Version="${escaped}"`;
            return xml.slice(0, start) + replacement + xml.slice(start + versionAttribute[0].length);
        }
        const insertAt = element.start + element.text.lastIndexOf('/>');
        return xml.slice(0, insertAt) + ` Version="${escaped}" ` + xml.slice(insertAt);
    }

    /** 移除 PackageReference；不存在则原样返回 */
    static removePackageReference(xml: string, id: string): string {
        return this.removeByInclude(xml, 'PackageReference', id);
    }

    /** 添加 <ProjectReference Include="..\X\X.csproj" /> */
    static addProjectReference(xml: string, include: string): string {
        if (this.findByInclude(xml, 'ProjectReference', include)) {
            return xml;
        }
        const indent = this.itemIndent(xml, 'ProjectReference');
        const line = `${indent}<ProjectReference Include="${xmlAttributeEscape(include)}" />`;
        return insertLineAfterLastElement(xml, 'ProjectReference', line, this.groupIndent(xml));
    }

    /** 移除 ProjectReference */
    static removeProjectReference(xml: string, include: string): string {
        return this.removeByInclude(xml, 'ProjectReference', include);
    }

    /** 添加程序集引用；有 hintPath 时生成带 <HintPath> 的多行元素 */
    static addAssemblyReference(xml: string, include: string, hintPath?: string): string {
        if (this.findByInclude(xml, 'Reference', include)) {
            return xml;
        }
        const indent = this.itemIndent(xml, 'Reference');
        const eol = detectEol(xml);
        const block = hintPath
            ? [
                `${indent}<Reference Include="${xmlAttributeEscape(include)}">`,
                `${indent}  <HintPath>${xmlAttributeEscape(hintPath)}</HintPath>`,
                `${indent}</Reference>`,
            ].join(eol)
            : `${indent}<Reference Include="${xmlAttributeEscape(include)}" />`;

        const elements = findElements(xml, 'Reference');
        if (elements.length > 0) {
            return insertBlockAfterElement(xml, elements[elements.length - 1], block);
        }
        return insertLineAfterLastElement(xml, 'Reference', block, this.groupIndent(xml));
    }

    /** 移除程序集引用 */
    static removeAssemblyReference(xml: string, include: string): string {
        return this.removeByInclude(xml, 'Reference', include);
    }

    /** 移除 <Analyzer Include="..." /> */
    static removeAnalyzer(xml: string, include: string): string {
        return this.removeByInclude(xml, 'Analyzer', include);
    }

    private static findByInclude(xml: string, tagName: string, include: string) {
        return findElements(xml, tagName).find(element => getAttribute(element.text, 'Include') === include);
    }

    private static removeByInclude(xml: string, tagName: string, include: string): string {
        const element = this.findByInclude(xml, tagName, include);
        return element ? removeElementAt(xml, element) : xml;
    }

    /** 同类条目已有则沿用其缩进，否则用 4 空格 */
    private static itemIndent(xml: string, tagName: string): string {
        const elements = findElements(xml, tagName);
        if (elements.length > 0) {
            return indentAt(xml, elements[0].start);
        }
        return `${this.groupIndent(xml)}  `;
    }

    /** 推断 ItemGroup 的缩进（默认 2 空格） */
    private static groupIndent(xml: string): string {
        const groups = findElements(xml, 'ItemGroup');
        if (groups.length > 0) {
            return indentAt(xml, groups[0].start);
        }
        return '  ';
    }
}
