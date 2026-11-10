import * as path from 'path';
import { CsprojSerializer } from '../serialization/CsprojSerializer';
import { CsprojItems } from '../serialization/CsprojItems';
import { MsBuildProperties } from './MsBuildProperties';
import {
    FIELD_SPECS,
    KNOWN_PROPERTIES,
    FieldSpec,
    FieldType,
    PropertyTab,
    getFieldSpec,
} from '../models/ProjectPropertySchema';

export interface SnapshotField {
    id: string;
    value: string;
    present: boolean;
    /** 值来自条件组（当前 Debug/Release） */
    conditional: boolean;
    scope: FieldSpec['scope'];
    /** 以下为展示元数据，由面板层按 schema 填充 */
    label?: string;
    type?: FieldType;
    tab?: PropertyTab;
    options?: string[];
    placeholder?: string;
    hint?: string;
}

export interface PropertiesSnapshot {
    projectPath: string;
    projectName: string;
    projectFileName: string;
    isSdk: boolean;
    configuration: string;
    platform: string;
    configurations: string[];
    platforms: string[];
    fields: SnapshotField[];
    packages: Array<{ id: string; version: string }>;
    projectReferences: Array<{ include: string; name?: string }>;
    assemblyReferences: Array<{ include: string; hintPath?: string }>;
    analyzers: Array<{ include: string }>;
    /** 未在界面上展示的配置项数量（属性 + Target/Import） */
    untouchedCount: number;
}

export interface FieldChange {
    id: string;
    scope: FieldSpec['scope'];
    value: string | null;
    configuration?: string;
    platform?: string;
}

export interface ReferenceChanges {
    addPackages: Array<{ id: string; version: string }>;
    setPackageVersions: Array<{ id: string; version: string }>;
    removePackages: string[];
    addProjectReferences: string[];
    removeProjectReferences: string[];
    addAssemblyReferences: Array<{ include: string; hintPath?: string }>;
    removeAssemblyReferences: string[];
    removeAnalyzers: string[];
}

export interface ApplyResult {
    xml: string;
    errors: string[];
}

/**
 * 项目属性的「读取 → 快照」与「变更集 → csproj 文本」转换。
 *
 * 纯函数（不依赖 vscode），便于单测；文件读写与 UI 由面板层负责。
 */
export class ProjectPropertiesModel {

    static snapshot(xml: string, options: {
        projectPath: string;
        configuration?: string;
        platform?: string;
    }): PropertiesSnapshot {
        const configuration = options.configuration ?? MsBuildProperties.getConfigurations(xml)[0];
        const platform = options.platform ?? MsBuildProperties.getPlatforms(xml)[0];
        const parsed = CsprojSerializer.parse(xml, options.projectPath);

        const fields: SnapshotField[] = [];
        for (const spec of FIELD_SPECS) {
            if (spec.sdkOnly && !parsed.isSdk) {
                continue;
            }
            const readOptions = spec.scope === 'configuration' ? { configuration, platform } : {};
            let value = '';
            let present = false;
            let conditional = false;
            for (const propertyName of spec.properties) {
                const effective = MsBuildProperties.getEffective(xml, propertyName, readOptions);
                if (effective) {
                    value = effective.value;
                    present = true;
                    conditional = effective.conditional;
                    break;
                }
            }
            fields.push({ id: spec.id, value, present, conditional, scope: spec.scope });
        }

        return {
            projectPath: options.projectPath,
            projectName: parsed.name,
            projectFileName: path.basename(options.projectPath),
            isSdk: parsed.isSdk === true,
            configuration,
            platform,
            configurations: MsBuildProperties.getConfigurations(xml),
            platforms: MsBuildProperties.getPlatforms(xml),
            fields,
            packages: parsed.packages.map(item => ({ id: item.id, version: item.version })),
            projectReferences: parsed.projectReferences.map(item => ({ include: item.include, name: item.name })),
            assemblyReferences: parsed.references.map(item => ({ include: item.include, hintPath: item.hintPath })),
            analyzers: parsed.analyzers.map(item => ({ include: item.include })),
            untouchedCount: this.countUntouched(xml),
        };
    }

    static apply(xml: string, fieldChanges: FieldChange[], refChanges: ReferenceChanges): ApplyResult {
        let result = xml;
        const errors: string[] = [];

        for (const change of fieldChanges) {
            const spec = getFieldSpec(change.id);
            if (!spec) {
                errors.push(`未知字段: ${change.id}`);
                continue;
            }
            const value = (change.value ?? '').trim();
            if (value) {
                const error = this.validateField(spec, value);
                if (error) {
                    errors.push(error);
                    continue;
                }
            }
            result = this.applyField(result, spec, change, value);
        }

        for (const pkg of refChanges.addPackages) {
            if (!pkg.id.trim()) {
                errors.push('包 ID 不能为空');
                continue;
            }
            result = CsprojItems.addPackageReference(result, pkg.id.trim(), pkg.version.trim());
        }
        for (const pkg of refChanges.setPackageVersions) {
            result = CsprojItems.setPackageVersion(result, pkg.id, pkg.version.trim());
        }
        for (const id of refChanges.removePackages) {
            result = CsprojItems.removePackageReference(result, id);
        }
        for (const include of refChanges.addProjectReferences) {
            result = CsprojItems.addProjectReference(result, include);
        }
        for (const include of refChanges.removeProjectReferences) {
            result = CsprojItems.removeProjectReference(result, include);
        }
        for (const reference of refChanges.addAssemblyReferences) {
            result = CsprojItems.addAssemblyReference(result, reference.include, reference.hintPath);
        }
        for (const include of refChanges.removeAssemblyReferences) {
            result = CsprojItems.removeAssemblyReference(result, include);
        }
        for (const include of refChanges.removeAnalyzers) {
            result = CsprojItems.removeAnalyzer(result, include);
        }

        return { xml: result, errors };
    }

    /** 校验字段值，返回错误文案；合法返回 undefined */
    static validateField(spec: FieldSpec, value: string): string | undefined {
        if (spec.validate === 'tfm') {
            const values = value.split(';').map(part => part.trim()).filter(Boolean);
            for (const tfm of values) {
                if (!/^(net(\d+(\.\d+)?)?|netstandard\d+(\.\d+)?|netcoreapp\d+(\.\d+)?|netframework\d+(\.\d+)?)(-(windows|android|ios|maccatalyst|tizen|browser)[\d.]*)?$/i.test(tfm)) {
                    return `${spec.label} 不是合法的目标框架: ${tfm}`;
                }
            }
            return undefined;
        }
        if (spec.validate === 'namespace') {
            if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) {
                return `${spec.label} 必须是合法的 C# 命名空间，如 Game.World`;
            }
            return undefined;
        }
        return undefined;
    }

    private static applyField(xml: string, spec: FieldSpec, change: FieldChange, value: string): string {
        const propertyName = this.resolvePropertyName(xml, spec);
        // 结构优先：属性已存在于条件组 → 继续按配置写；否则写为项目级属性
        const conditional = spec.scope === 'configuration' && this.hasConditionalProperty(xml, propertyName);
        const options = conditional
            ? {
                configuration: change.configuration ?? 'Debug',
                platform: change.platform ?? 'AnyCPU',
            }
            : {};
        if (!value) {
            return MsBuildProperties.removeProperty(xml, propertyName, options);
        }
        return MsBuildProperties.setProperty(xml, propertyName, value, options);
    }

    /** 属性是否已存在于任一条件组（决定按配置写入还是项目级写入） */
    private static hasConditionalProperty(xml: string, name: string): boolean {
        return MsBuildProperties.parseGroups(xml).some(group =>
            Boolean(group.condition)
            && group.properties.some(property => property.name === name && !property.elementCondition)
        );
    }

    /** 优先写文件里已经在用的属性名（TargetFrameworks 还是 TargetFramework） */
    private static resolvePropertyName(xml: string, spec: FieldSpec): string {
        const groups = MsBuildProperties.parseGroups(xml);
        for (const propertyName of spec.properties) {
            if (groups.some(group => group.properties.some(property => property.name === propertyName))) {
                return propertyName;
            }
        }
        return spec.properties[0];
    }

    private static countUntouched(xml: string): number {
        let count = 0;
        const unknown = new Set<string>();
        for (const group of MsBuildProperties.parseGroups(xml)) {
            for (const property of group.properties) {
                if (!KNOWN_PROPERTIES.has(property.name)) {
                    unknown.add(property.name);
                }
            }
        }
        count += unknown.size;
        for (const tag of ['Target', 'Import', 'Using']) {
            const matches = xml.match(new RegExp(`<${tag}(?=[\\s/>])`, 'g'));
            count += matches ? matches.length : 0;
        }
        return count;
    }
}
