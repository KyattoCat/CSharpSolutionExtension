import {
    detectEol,
    getAttribute,
    indentAt,
    lineStartOf,
    removeElementAt,
    xmlEscape,
} from '../serialization/xmlText';

/** 条件求值结果：true / false / undefined（条件表达式无法识别，无法安全求值） */
export type TriState = boolean | undefined;

export interface MsBuildProperty {
    name: string;
    value: string;
    /** 元素自身的 Condition（如 <DefineConstants Condition="...">） */
    elementCondition?: string;
    /** 所在 PropertyGroup 的 Condition */
    groupCondition?: string;
    selfClosing: boolean;
    start: number;
    end: number;
    valueStart: number;
    valueEnd: number;
}

export interface MsBuildPropertyGroup {
    condition?: string;
    start: number;
    openEnd: number;
    closeStart: number;
    end: number;
    properties: MsBuildProperty[];
}

export interface EffectiveProperty {
    value: string;
    /** 值来自条件组（true）还是项目级无条件属性（false） */
    conditional: boolean;
    condition?: string;
}

export interface ConfigurationOptions {
    configuration?: string;
    platform?: string;
}

const DEFAULT_CONFIGURATIONS = ['Debug', 'Release'];
const DEFAULT_PLATFORMS = ['AnyCPU'];

/**
 * MSBuild 属性读写（PropertyGroup / 属性元素）。
 *
 * 设计约束：
 * - 只改写目标属性的文本区间，其余内容逐字节保留；
 * - 条件无法求值时（例如含 $(TargetFramework) 的自定义条件）一律视为「不确定」，
 *   既不覆盖也不复用该 PropertyGroup，而是新建一个明确的条件组。
 */
export class MsBuildProperties {

    private static readonly GROUP_OPEN = /<PropertyGroup(\s[^>]*)?>/g;
    private static readonly ELEMENT = /<!--[\s\S]*?-->|<([A-Za-z_][\w.\-]*)([^>]*?)(\/>|>)/g;

    /** 解析所有 PropertyGroup 及其属性元素（带文本区间） */
    static parseGroups(xml: string): MsBuildPropertyGroup[] {
        const groups: MsBuildPropertyGroup[] = [];
        const openRe = new RegExp(this.GROUP_OPEN.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = openRe.exec(xml)) !== null) {
            const start = m.index;
            const openEnd = start + m[0].length;
            const closeStart = xml.indexOf('</PropertyGroup>', openEnd);
            if (closeStart === -1) {
                break;
            }
            const end = closeStart + '</PropertyGroup>'.length;
            const condition = getAttribute(m[1] ?? '', 'Condition');
            groups.push({
                condition,
                start,
                openEnd,
                closeStart,
                end,
                properties: this.parseProperties(xml, openEnd, closeStart, condition),
            });
            openRe.lastIndex = end;
        }
        return groups;
    }

    private static parseProperties(xml: string, from: number, to: number, groupCondition?: string): MsBuildProperty[] {
        const inner = xml.slice(from, to);
        const re = new RegExp(this.ELEMENT.source, 'g');
        const properties: MsBuildProperty[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(inner)) !== null) {
            if (m[0].startsWith('<!--')) {
                continue;
            }
            const name = m[1];
            const attrs = m[2] ?? '';
            const selfClosing = m[3] === '/>';
            const start = from + m.index;
            const openEnd = start + m[0].length;
            let valueStart = openEnd;
            let valueEnd = openEnd;
            let end = openEnd;
            if (!selfClosing) {
                const closeTag = `</${name}>`;
                const closeIdx = xml.indexOf(closeTag, openEnd);
                if (closeIdx === -1) {
                    continue;
                }
                valueStart = openEnd;
                valueEnd = closeIdx;
                end = closeIdx + closeTag.length;
                re.lastIndex = end - from;
            }
            properties.push({
                name,
                value: xml.slice(valueStart, valueEnd),
                elementCondition: getAttribute(attrs, 'Condition'),
                groupCondition,
                selfClosing,
                start,
                end,
                valueStart,
                valueEnd,
            });
        }
        return properties;
    }

    /** 求值 Configuration / Platform 条件；无法识别时返回 undefined */
    static evaluateCondition(condition: string | undefined, configuration = 'Debug', platform = 'AnyCPU'): TriState {
        if (!condition || !condition.trim()) {
            return true;
        }
        const tokens = condition.split(/\s+(and|or)\s+/i);
        if (tokens.length === 0) {
            return undefined;
        }
        const values: TriState[] = [];
        const operators: string[] = [];
        tokens.forEach((token, index) => {
            if (index % 2 === 0) {
                values.push(this.evaluateClause(token, configuration, platform));
            } else {
                operators.push(token.toLowerCase());
            }
        });
        if (operators.length === 0) {
            return values[0];
        }
        // And 优先于 Or
        const reduced: TriState[] = [values[0]];
        const reducedOps: string[] = [];
        for (let i = 0; i < operators.length; i++) {
            const next = values[i + 1];
            const current = reduced[reduced.length - 1];
            if (operators[i] === 'and') {
                if (current === false || next === false) {
                    reduced[reduced.length - 1] = false;
                } else if (current === true && next === true) {
                    reduced[reduced.length - 1] = true;
                } else {
                    reduced[reduced.length - 1] = undefined;
                }
            } else {
                reducedOps.push('or');
                reduced.push(next);
            }
        }
        let result: TriState = reduced[0];
        for (let i = 0; i < reducedOps.length; i++) {
            const next = reduced[i + 1];
            if (result === true || next === true) {
                result = true;
            } else if (result === false && next === false) {
                result = false;
            } else {
                result = undefined;
            }
        }
        return result;
    }

    private static evaluateClause(clause: string, configuration: string, platform: string): TriState {
        let text = clause.trim();
        while (text.startsWith('(') && text.endsWith(')')) {
            text = text.slice(1, -1).trim();
        }
        const configPlatform =
            /^'?\$\(Configuration\)\s*\|\s*\$\(Platform\)'?\s*==\s*'([^']*)'$/i.exec(text) ??
            /^'([^']*)'\s*==\s*'?\$\(Configuration\)\s*\|\s*\$\(Platform\)'?$/i.exec(text);
        if (configPlatform) {
            return configPlatform[1] === `${configuration}|${platform}`;
        }
        const configurationOnly =
            /^'?\$\(Configuration\)'?\s*==\s*'([^']*)'$/i.exec(text) ??
            /^'([^']*)'\s*==\s*'?\$\(Configuration\)'?$/i.exec(text);
        if (configurationOnly) {
            return configurationOnly[1].trim() === configuration;
        }
        const platformOnly =
            /^'?\$\(Platform\)'?\s*==\s*'([^']*)'$/i.exec(text) ??
            /^'([^']*)'\s*==\s*'?\$\(Platform\)'?$/i.exec(text);
        if (platformOnly) {
            return platformOnly[1].trim() === platform;
        }
        return undefined;
    }

    /** 取某个配置下真正生效的属性值（文档顺序，后者覆盖前者） */
    static getEffective(xml: string, name: string, options: ConfigurationOptions = {}): EffectiveProperty | undefined {
        const configuration = options.configuration ?? DEFAULT_CONFIGURATIONS[0];
        const platform = options.platform ?? DEFAULT_PLATFORMS[0];
        let result: EffectiveProperty | undefined;
        for (const group of this.parseGroups(xml)) {
            if (this.evaluateCondition(group.condition, configuration, platform) === false) {
                continue;
            }
            for (const property of group.properties) {
                if (property.name !== name) {
                    continue;
                }
                if (this.evaluateCondition(property.elementCondition, configuration, platform) === false) {
                    continue;
                }
                const condition = group.condition || property.elementCondition;
                result = {
                    value: property.value.trim(),
                    conditional: Boolean(condition),
                    condition,
                };
            }
        }
        return result;
    }

    /** 写入属性值：优先改已有元素，其次插入目标 PropertyGroup，最后新建条件组 */
    static setProperty(xml: string, name: string, value: string, options: ConfigurationOptions = {}): string {
        const configuration = options.configuration;
        const platform = options.platform ?? DEFAULT_PLATFORMS[0];
        const escaped = xmlEscape(value);
        const groups = this.parseGroups(xml);
        const target = configuration
            ? this.findConditionalGroup(groups, configuration, platform)
            : this.findUnconditionalGroup(groups);

        if (target) {
            const existing = target.properties.find(p => p.name === name && !p.elementCondition);
            if (existing) {
                if (existing.selfClosing) {
                    return xml.slice(0, existing.start) + `<${name}>${escaped}</${name}>` + xml.slice(existing.end);
                }
                return xml.slice(0, existing.valueStart) + escaped + xml.slice(existing.valueEnd);
            }
            const eol = detectEol(xml);
            const indent = target.properties.length > 0
                ? indentAt(xml, target.properties[0].start)
                : indentAt(xml, target.start) + '  ';
            const insertAt = lineStartOf(xml, target.closeStart);
            return xml.slice(0, insertAt) + `${indent}<${name}>${escaped}</${name}>${eol}` + xml.slice(insertAt);
        }

        // 没有可复用的组：新建一个（无条件组或指定配置的条件组）
        const eol = detectEol(xml);
        const conditionAttribute = configuration
            ? ` Condition="'$(Configuration)|$(Platform)' == '${configuration}|${platform}'"`
            : '';
        const content = `    <${name}>${escaped}</${name}>`;
        const closeIdx = xml.lastIndexOf('</Project>');
        const block = `  <PropertyGroup${conditionAttribute}>${eol}${content}${eol}  </PropertyGroup>`;
        if (closeIdx === -1) {
            return xml + eol + block;
        }
        const insertAt = lineStartOf(xml, closeIdx);
        return xml.slice(0, insertAt) + block + eol + xml.slice(insertAt);
    }

    /** 移除属性（恢复 MSBuild 默认值）；返回是否真的删除了内容 */
    static removeProperty(xml: string, name: string, options: ConfigurationOptions = {}): string {
        const platform = options.platform ?? DEFAULT_PLATFORMS[0];
        const groups = this.parseGroups(xml);
        const target = options.configuration
            ? this.findConditionalGroup(groups, options.configuration, platform)
            : this.findUnconditionalGroup(groups);
        if (!target) {
            return xml;
        }
        const targets = target.properties.filter(p => p.name === name && !p.elementCondition);
        let result = xml;
        for (const property of [...targets].reverse()) {
            result = removeElementAt(result, { start: property.start, end: property.end, text: '' });
        }
        return result;
    }

    /** 收集文件里出现过的配置（Debug/Release 等），保持出现顺序 */
    static getConfigurations(xml: string): string[] {
        return this.collectConditionValues(xml, 'configuration');
    }

    /** 收集文件里出现过的平台（AnyCPU/x64 等） */
    static getPlatforms(xml: string): string[] {
        return this.collectConditionValues(xml, 'platform');
    }

    private static collectConditionValues(xml: string, kind: 'configuration' | 'platform'): string[] {
        const found: string[] = [];
        const add = (value: string) => {
            const trimmed = value.trim();
            if (trimmed && !found.includes(trimmed)) {
                found.push(trimmed);
            }
        };
        const conditions: string[] = [];
        for (const group of this.parseGroups(xml)) {
            if (group.condition) {
                conditions.push(group.condition);
            }
            for (const property of group.properties) {
                if (property.elementCondition) {
                    conditions.push(property.elementCondition);
                }
            }
        }
        for (const condition of conditions) {
            const pair = /\$\(Configuration\)\s*\|\s*\$\(Platform\)'?\s*==\s*'([^']*)\|([^']*)'/i.exec(condition);
            if (pair) {
                if (kind === 'configuration') {
                    add(pair[1]);
                } else {
                    add(pair[2]);
                }
                continue;
            }
            if (kind === 'configuration') {
                const single = /\$\(Configuration\)'?\s*==\s*'([^']*)'/i.exec(condition);
                if (single) {
                    add(single[1]);
                }
            } else {
                const single = /\$\(Platform\)'?\s*==\s*'([^']*)'/i.exec(condition);
                if (single) {
                    add(single[1]);
                }
            }
        }
        const defaults = kind === 'configuration' ? DEFAULT_CONFIGURATIONS : DEFAULT_PLATFORMS;
        if (found.length === 0) {
            return [...defaults];
        }
        return found;
    }

    private static findUnconditionalGroup(groups: MsBuildPropertyGroup[]): MsBuildPropertyGroup | undefined {
        return groups.find(group => !group.condition || !group.condition.trim());
    }

    private static findConditionalGroup(
        groups: MsBuildPropertyGroup[],
        configuration: string,
        platform: string
    ): MsBuildPropertyGroup | undefined {
        for (const group of groups) {
            if (!group.condition) {
                continue;
            }
            if (!/\$\(Configuration\)|\$\(Platform\)/i.test(group.condition)) {
                continue;
            }
            if (this.evaluateCondition(group.condition, configuration, platform) === true) {
                return group;
            }
        }
        return undefined;
    }
}

