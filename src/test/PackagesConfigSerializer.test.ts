import * as assert from 'assert';
import { PackagesConfigSerializer } from '../serialization/PackagesConfigSerializer';

suite('PackagesConfigSerializer', () => {

    test('解析 packages.config', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Newtonsoft.Json" version="13.0.1" targetFramework="net48" />
  <package id="EntityFramework" version="6.4.4" targetFramework="net48" />
</packages>`;
        const packages = PackagesConfigSerializer.parse(xml);
        assert.strictEqual(packages.length, 2);
        assert.strictEqual(packages[0].id, 'Newtonsoft.Json');
        assert.strictEqual(packages[0].version, '13.0.1');
        assert.strictEqual(packages[0].targetFramework, 'net48');
        assert.strictEqual(packages[1].id, 'EntityFramework');
    });

    test('移除 package', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="A" version="1.0.0" />
  <package id="B" version="2.0.0" />
</packages>`;
        const result = PackagesConfigSerializer.removePackage(xml, 'A');
        assert.ok(!result.includes('id="A"'));
        assert.ok(result.includes('id="B"'));
    });

    test('解析空 packages.config', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<packages>
</packages>`;
        const packages = PackagesConfigSerializer.parse(xml);
        assert.strictEqual(packages.length, 0);
    });
});
