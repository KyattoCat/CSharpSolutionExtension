export class FileTemplateService {

    /** 根据模板生成 C# 类文件内容 */
    static generate(
        namespace: string,
        className: string,
        template: string[]
    ): string {
        return template
            .map(line =>
                line.replace(/\{namespace\}/g, namespace)
                    .replace(/\{className\}/g, className)
            )
            .join('\n');
    }

    /**
     * 根据根命名空间和相对目录推断完整命名空间。
     * 例: inferNamespace('MyApp', 'Models\\Entities') -> 'MyApp.Models.Entities'
     */
    static inferNamespace(rootNamespace: string, dirPath: string): string {
        if (!dirPath) {
            return rootNamespace;
        }
        const nsPart = dirPath.replace(/[\\\/]/g, '.');
        return `${rootNamespace}.${nsPart}`;
    }

    /**
     * 验证类名是否合法。
     * 规则: 非空、首字符为字母或下划线、其余为字母数字下划线、不是 C# 关键字。
     */
    static isValidClassName(name: string): boolean {
        const trimmed = name.trim();
        if (!trimmed) {
            return false;
        }
        // C# 标识符：首字符为字母或 _，其余为字母数字或 _
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
            return false;
        }
        // 排除 C# 关键字
        const keywords = new Set([
            'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch',
            'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default',
            'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern',
            'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if',
            'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock', 'long',
            'namespace', 'new', 'null', 'object', 'operator', 'out', 'override',
            'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return',
            'sbyte', 'sealed', 'short', 'sizeof', 'stackalloc', 'static', 'string',
            'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'uint',
            'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void',
            'volatile', 'while',
        ]);
        return !keywords.has(trimmed);
    }
}
