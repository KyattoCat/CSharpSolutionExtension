import { PackageItem } from '../models/CsprojModel';

export class PackagesConfigSerializer {

    /** 解析 packages.config 内容，提取所有 NuGet 包引用 */
    static parse(xml: string): PackageItem[] {
        const results: PackageItem[] = [];
        const regex = /<package\s+id="([^"]*)"\s+version="([^"]*)"(?:\s+targetFramework="([^"]*)")?\s*\/>/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
            const item: PackageItem = {
                id: match[1],
                version: match[2],
            };
            if (match[3]) {
                item.targetFramework = match[3];
            }
            results.push(item);
        }
        return results;
    }

    /** 从 packages.config 内容中移除指定 ID 的 <package> 元素 */
    static removePackage(xml: string, packageId: string): string {
        const escaped = packageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(
            `\\s*<package\\s+id="${escaped}"\\s+version="[^"]*"[^>]*\\/>\\s*\\n?`,
            'g'
        );
        return xml.replace(regex, '');
    }
}
