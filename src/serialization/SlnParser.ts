import * as path from 'path';
import { Solution, SolutionProject } from '../models/CsprojModel';

export class SlnParser {

    private static readonly SOLUTION_FOLDER_GUID = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';

    static parse(content: string, filePath: string): Solution {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.slnx') {
            return this.parseSlnx(content, filePath);
        }
        return this.parseSln(content, filePath);
    }

    /** 解析传统 .sln 格式 */
    private static parseSln(content: string, filePath: string): Solution {
        const name = path.basename(filePath, '.sln');
        const projects: SolutionProject[] = [];
        const regex = /Project\("\{([^}]+)\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([^}]+)\}"/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
            const typeGuid = `{${match[1]}}`;
            if (typeGuid.toUpperCase() === this.SOLUTION_FOLDER_GUID.toUpperCase()) continue;

            projects.push({
                name: match[2],
                relPath: match[3],
                guid: `{${match[4]}}`,
            });
        }

        return { name, path: filePath, projects };
    }

    /** 解析 .slnx 格式（XML） */
    private static parseSlnx(content: string, filePath: string): Solution {
        const name = path.basename(filePath, '.slnx');
        const projects: SolutionProject[] = [];
        const regex = /<Project\s+Path="([^"]+)"[^>]*\/?>/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
            const relPath = match[1];
            projects.push({
                name: path.basename(relPath.replace(/\\/g, '/'), '.csproj'),
                relPath,
                guid: '',
            });
        }

        return { name, path: filePath, projects };
    }
}
