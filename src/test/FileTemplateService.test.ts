import * as assert from 'assert';
import { FileTemplateService } from '../services/FileTemplateService';

suite('FileTemplateService', () => {

    test('生成类文件内容，替换命名空间和类名', () => {
        const template = [
            'using System;',
            '',
            'namespace {namespace}',
            '{',
            '    public class {className}',
            '    {',
            '        ',
            '    }',
            '}',
            '',
        ];
        const result = FileTemplateService.generate('MyApp.Models', 'User', template);
        assert.ok(result.includes('namespace MyApp.Models'));
        assert.ok(result.includes('public class User'));
    });

    test('推断命名空间：根命名空间 + 子目录', () => {
        const ns = FileTemplateService.inferNamespace('MyApp', 'Models\\Entities');
        assert.strictEqual(ns, 'MyApp.Models.Entities');
    });

    test('推断命名空间：仅有根命名空间（根目录）', () => {
        const ns = FileTemplateService.inferNamespace('MyApp', '');
        assert.strictEqual(ns, 'MyApp');
    });

    test('验证合法类名', () => {
        assert.ok(FileTemplateService.isValidClassName('User'));
        assert.ok(FileTemplateService.isValidClassName('_MyClass'));
        assert.ok(FileTemplateService.isValidClassName('MyClass123'));
        assert.ok(!FileTemplateService.isValidClassName('123Invalid'));
        assert.ok(!FileTemplateService.isValidClassName('class'));
        assert.ok(!FileTemplateService.isValidClassName('my-class'));
    });

    test('验证合法类名：空字符串、空格', () => {
        assert.ok(!FileTemplateService.isValidClassName(''));
        assert.ok(!FileTemplateService.isValidClassName('   '));
    });

    test('generateByKind 生成四种类型', () => {
        const cls = FileTemplateService.generateByKind('My.App', 'Foo', 'class');
        assert.ok(cls.includes('namespace My.App'));
        assert.ok(cls.includes('public class Foo'));

        const itf = FileTemplateService.generateByKind('My.App', 'IFoo', 'interface');
        assert.ok(itf.includes('public interface IFoo'));

        const enm = FileTemplateService.generateByKind('My.App', 'Color', 'enum');
        assert.ok(enm.includes('public enum Color'));

        const stc = FileTemplateService.generateByKind('My.App', 'Point', 'struct');
        assert.ok(stc.includes('public struct Point'));
    });
});
