/**
 * 连击机测试。核心是那条规则：连击只被失误打断，不被一般落点打断。
 */
const core = require('../js/core');

module.exports = function register(t) {
  const cfg = core.config;
  const V = core.judge.VERDICT;

  t.test('初始状态为 0', () => {
    const combo = core.combo.createCombo(cfg);
    t.eq(combo.count, 0, '初始连击');
    t.eq(combo.best, 0, '初始最佳连击');
    t.eq(core.combo.isComboActive(combo), false, '0 连击不活跃');
  });

  t.test('完美落点累加连击，1 连击不算活跃', () => {
    const combo = core.combo.createCombo(cfg);
    t.eq(core.combo.applyCombo(combo, V.PERFECT), 1, '第 1 次完美');
    t.eq(core.combo.isComboActive(combo), false, '1 连击还不展示');
    t.eq(core.combo.applyCombo(combo, V.PERFECT), 2, '第 2 次完美');
    t.eq(core.combo.isComboActive(combo), true, '2 连击开始展示');
    t.eq(combo.best, 2, '最佳连击同步更新');
  });

  t.test('一般落点不打断连击（这是规则的核心）', () => {
    const combo = core.combo.createCombo(cfg);
    core.combo.applyCombo(combo, V.PERFECT);
    core.combo.applyCombo(combo, V.PERFECT);
    core.combo.applyCombo(combo, V.PERFECT);
    t.eq(combo.count, 3, '连击到 3');

    t.eq(core.combo.applyCombo(combo, V.IMPERFECT), 3, '一般落点后连击必须保持 3');
    t.eq(core.combo.applyCombo(combo, V.IMPERFECT), 3, '连续一般落点仍保持');
    t.eq(core.combo.applyCombo(combo, V.PERFECT), 4, '一般落点之后再来完美，应继续累加到 4');
  });

  t.test('失误清零连击，但最佳记录保留', () => {
    const combo = core.combo.createCombo(cfg);
    core.combo.applyCombo(combo, V.PERFECT);
    core.combo.applyCombo(combo, V.PERFECT);
    core.combo.applyCombo(combo, V.PERFECT);
    t.eq(combo.count, 3, '连击到 3');

    t.eq(core.combo.applyCombo(combo, V.MISS), 0, '失误后连击清零');
    t.eq(combo.best, 3, '最佳连击不应被清零');
  });

  t.test('连击有上限，超出后不再增长', () => {
    const combo = core.combo.createCombo(cfg);
    for (let i = 0; i < cfg.COMBO.maxSteps + 15; i += 1) {
      core.combo.applyCombo(combo, V.PERFECT);
    }
    t.eq(combo.count, cfg.COMBO.maxSteps, '连击封顶于 maxSteps');
    t.eq(combo.best, cfg.COMBO.maxSteps, '最佳连击同样封顶');
  });

  t.test('resetCombo 会清空计数与最佳记录', () => {
    const combo = core.combo.createCombo(cfg);
    core.combo.applyCombo(combo, V.PERFECT);
    core.combo.applyCombo(combo, V.PERFECT);
    core.combo.resetCombo(combo);
    t.eq(combo.count, 0, '计数归零');
    t.eq(combo.best, 0, '最佳记录归零');
  });
};
