/**
 * csproj 文本编辑的通用工具。
 *
 * 全部采用「定位元素区间 + 最小文本替换」的方式，不重建 XML DOM，
 * 因此注释、缩进、空行与换行风格（CRLF/LF）都能原样保留。
 */

/** 检测行尾风格 */
export function detectEol(xml: string): string {
    return xml.includes('\r\n') ? '\r\n' : '\n';
}

/** index 所在行的起始下标 */
export function lineStartOf(xml: string, index: number): number {
    const nl = xml.lastIndexOf('\n', Math.max(0, index - 1));
    return nl === -1 ? 0 : nl + 1;
}

/** index 所在行的结束下标（不含换行符） */
export function lineEndOf(xml: string, index: number): number {
    const nl = xml.indexOf('\n', index);
    return nl === -1 ? xml.length : nl;
}

/** index 所在行的前导空白 */
export function indentAt(xml: string, index: number): string {
    const start = lineStartOf(xml, index);
    const m = /^[ \t]*/.exec(xml.slice(start, index));
    return m ? m[0] : '';
}

export interface ElementRange {
    start: number;
    end: number;
    text: string;
}

/**
 * 找出所有 `<tag ... />` 或 `<tag ...>...</tag>` 元素的区间。
 * `(?=[\s/>])` 保证不会误匹配 `<ReferencePath` 这类前缀相同的标签。
 */
export function findElements(xml: string, tagName: string): ElementRange[] {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<${escapedTag}(?=[\\s/>])[^>]*(?:/>|>[\\s\\S]*?</${escapedTag}>)`, 'g');
    const result: ElementRange[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        result.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        if (m[0].length === 0) {
            re.lastIndex++;
        }
    }
    return result;
}

/** 读取元素上的属性值（双引号或单引号） */
export function getAttribute(elementText: string, name: string): string | undefined {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`\\b${escaped}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(elementText);
    if (!m) {
        return undefined;
    }
    return m[2] ?? m[3];
}

/** 把 block（可多行，行间用当前文件的 EOL 分隔）插入到元素所在行之后 */
export function insertBlockAfterElement(xml: string, element: ElementRange, block: string): string {
    const eol = detectEol(xml);
    const lineEnd = lineEndOf(xml, Math.max(element.start, element.end - 1));
    if (lineEnd >= xml.length) {
        return xml + eol + block;
    }
    return xml.slice(0, lineEnd) + eol + block + xml.slice(lineEnd);
}

/** 在最后一个 `<tag>` 元素后插入一行；没有同类元素时新建 ItemGroup */
export function insertLineAfterLastElement(xml: string, tagName: string, line: string, groupIndent = '  '): string {
    const elements = findElements(xml, tagName);
    if (elements.length > 0) {
        return insertBlockAfterElement(xml, elements[elements.length - 1], line);
    }
    return appendBlockBeforeProjectClose(xml, `ItemGroup`, line, groupIndent);
}

/** 在 `</Project>` 前插入一个包裹块（ItemGroup / PropertyGroup），content 已含缩进 */
export function appendBlockBeforeProjectClose(
    xml: string,
    groupTag: 'ItemGroup' | 'PropertyGroup',
    content: string,
    groupIndent = '  ',
    groupAttributes = ''
): string {
    const eol = detectEol(xml);
    const block = `${groupIndent}<${groupTag}${groupAttributes}>${eol}${content}${eol}${groupIndent}</${groupTag}>`;
    const closeIdx = xml.lastIndexOf('</Project>');
    if (closeIdx === -1) {
        return xml + eol + block;
    }
    const at = lineStartOf(xml, closeIdx);
    return xml.slice(0, at) + block + eol + xml.slice(at);
}

/** 删除元素；若该元素独占整行则连同整行（含换行）一起删除 */
export function removeElementAt(xml: string, element: ElementRange): string {
    const lineStart = lineStartOf(xml, element.start);
    const lineEnd = lineEndOf(xml, Math.max(element.start, element.end - 1));
    const before = xml.slice(lineStart, element.start);
    const after = xml.slice(element.end, lineEnd);
    if (/^[ \t]*$/.test(before) && /^[ \t]*$/.test(after)) {
        const next = xml[lineEnd] === '\n' ? lineEnd + 1 : lineEnd;
        return xml.slice(0, lineStart) + xml.slice(next);
    }
    return xml.slice(0, element.start) + xml.slice(element.end);
}

/** 转义 XML 文本节点 */
export function xmlEscape(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** 转义 XML 属性值 */
export function xmlAttributeEscape(value: string): string {
    return xmlEscape(value).replace(/"/g, '&quot;');
}
