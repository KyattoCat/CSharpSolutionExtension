import * as assert from 'assert';
import { dedupeDragData, detectCycle, expandMoves, isLinkedPath, DragNodeData } from '../tree/dragDropLogic';

const P = 'C:/proj/Test.csproj';
const file = (nodePath: string): DragNodeData => ({ type: 'file', projectPath: P, nodePath });
const folder = (nodePath: string): DragNodeData => ({ type: 'folder', projectPath: P, nodePath });

suite('dragDropLogic', () => {

    suite('dedupeDragData', () => {
        test('移除完全重复项', () => {
            const result = dedupeDragData([file('A.cs'), file('A.cs')]);
            assert.strictEqual(result.length, 1);
        });

        test('移除被拖拽文件夹包含的子文件', () => {
            const result = dedupeDragData([folder('Models'), file('Models/User.cs')]);
            assert.deepStrictEqual(result.map(r => r.nodePath), ['Models']);
        });

        test('移除被拖拽文件夹包含的子文件夹', () => {
            const result = dedupeDragData([folder('A'), folder('A/B')]);
            assert.deepStrictEqual(result.map(r => r.nodePath), ['A']);
        });

        test('文件夹不会过滤自身', () => {
            const result = dedupeDragData([folder('A'), folder('B')]);
            assert.strictEqual(result.length, 2);
        });

        test('同名前缀的兄弟不误过滤', () => {
            const result = dedupeDragData([folder('A'), file('AB/x.cs')]);
            assert.strictEqual(result.length, 2);
        });
    });

    suite('detectCycle', () => {
        test('文件夹拖入自身返回 self', () => {
            assert.strictEqual(detectCycle([folder('A')], 'A'), 'self');
        });

        test('文件夹拖入子目录返回 descendant', () => {
            assert.strictEqual(detectCycle([folder('A')], 'A/B/C'), 'descendant');
        });

        test('正常目标返回 null', () => {
            assert.strictEqual(detectCycle([folder('A')], 'B'), null);
        });

        test('文件节点不参与循环检测', () => {
            assert.strictEqual(detectCycle([file('A/x.cs')], 'A'), null);
        });
    });

    suite('expandMoves', () => {
        test('单文件移动到目标目录', () => {
            const moves = expandMoves([file('User.cs')], 'Models', []);
            assert.deepStrictEqual(moves, [{ oldRelPath: 'User.cs', newRelPath: 'Models/User.cs' }]);
        });

        test('文件移到自身所在目录为 no-op', () => {
            const moves = expandMoves([file('Models/User.cs')], 'Models', []);
            assert.strictEqual(moves.length, 0);
        });

        test('文件夹递归展开所有子条目', () => {
            const compiles = [
                { include: 'Src/A.cs' },
                { include: 'Src/Sub/B.cs' },
                { include: 'Other/C.cs' },
            ];
            const moves = expandMoves([folder('Src')], 'Dst', compiles);
            assert.deepStrictEqual(moves, [
                { oldRelPath: 'Src/A.cs', newRelPath: 'Dst/Src/A.cs' },
                { oldRelPath: 'Src/Sub/B.cs', newRelPath: 'Dst/Src/Sub/B.cs' },
            ]);
        });

        test('移动到项目根（targetDir 为空）', () => {
            const moves = expandMoves([file('Models/User.cs')], '', []);
            assert.deepStrictEqual(moves, [{ oldRelPath: 'Models/User.cs', newRelPath: 'User.cs' }]);
        });

        test('反斜杠条目的新路径跟随反斜杠风格', () => {
            const compiles = [{ include: 'Src\\A.cs' }];
            const moves = expandMoves([folder('Src')], 'Dst', compiles);
            assert.deepStrictEqual(moves, [
                { oldRelPath: 'Src\\A.cs', newRelPath: 'Dst\\Src\\A.cs' },
            ]);
        });

        test('相同 oldRelPath 只产生一个任务', () => {
            const compiles = [{ include: 'Src/A.cs' }];
            // 同一文件夹拖两次（dedupe 之外的安全网）
            const moves = expandMoves([folder('Src'), folder('Src')], 'Dst', compiles);
            assert.strictEqual(moves.length, 1);
        });
    });

    suite('isLinkedPath', () => {
        test('.. 与 ../ 前缀为链接路径', () => {
            assert.strictEqual(isLinkedPath('..'), true);
            assert.strictEqual(isLinkedPath('../Shared'), true);
            assert.strictEqual(isLinkedPath('..\\Shared\\Foo.cs'), true);
        });

        test('常规路径不是链接路径', () => {
            assert.strictEqual(isLinkedPath('Models/User.cs'), false);
            assert.strictEqual(isLinkedPath('a..b/x.cs'), false);
            assert.strictEqual(isLinkedPath(''), false);
        });
    });
});
