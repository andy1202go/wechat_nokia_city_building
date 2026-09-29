/**
 * 容差判定测试。重点是把两条边界和「失误容差 = 楼层半宽」这个物理不变式钉住。
 */
const core = require('../js/core');

module.exports = function register(t) {
  const cfg = core.config;
  const judge = core.judge.createJudge(cfg);
  const V = core.judge.VERDICT;

  t.test('两个阈值按配置推导正确', () => {
    t.close(
      judge.perfectTol,
      cfg.FLOOR.width * cfg.TOLERANCE.perfectRatio,
      1e-9,
      '完美容差'
    );
    t.close(judge.missTol, cfg.FLOOR.width * cfg.TOLERANCE.missRatio, 1e-9, '失误容差');
  });

  // 物理不变式：偏差超过楼层半宽，落点中心就越过下层支承边缘，楼层必然翻落。
  // 所以 missRatio 必须恒为 0.5。这条用例防止有人为了「放宽容错」去调它。
  t.test('失误容差必须等于楼层半宽（物理滑落临界点）', () => {
    t.close(judge.missTol, cfg.FLOOR.width / 2, 1e-9, '失误容差 = 楼层半宽');
    t.close(
      cfg.TOLERANCE.missRatio,
      0.5,
      1e-12,
      'missRatio 必须为 0.5，否则判定与物理不一致；要放宽容错请改地基宽度或坍塌比例'
    );
  });

  t.test('完美落点边界：恰好等于完美容差仍算完美', () => {
    t.eq(core.judge.judgeOffset(0, judge), V.PERFECT, '偏差 0');
    t.eq(core.judge.judgeOffset(judge.perfectTol, judge), V.PERFECT, '恰好等于完美容差');
    t.eq(
      core.judge.judgeOffset(judge.perfectTol + 1e-6, judge),
      V.IMPERFECT,
      '刚超出完美容差即为一般落点'
    );
  });

  t.test('一般落点边界：恰好等于失误容差仍算一般', () => {
    t.eq(core.judge.judgeOffset(judge.missTol, judge), V.IMPERFECT, '恰好等于失误容差');
    t.eq(
      core.judge.judgeOffset(judge.missTol + 1e-6, judge),
      V.MISS,
      '刚超出失误容差即为失误'
    );
    t.eq(core.judge.judgeOffset(9999, judge), V.MISS, '极大偏差为失误');
  });

  t.test('容差区间是连续的、没有空隙', () => {
    const samples = [0, 1, 5, 11, 12, 18, 25, 31, 33, 40, 80];
    samples.forEach((offset) => {
      const verdict = core.judge.judgeOffset(offset, judge);
      t.assert(
        verdict === V.PERFECT || verdict === V.IMPERFECT || verdict === V.MISS,
        `偏差 ${offset} 必须落在三档之一`
      );
    });
    t.eq(core.judge.toleranceBand(0, judge), 0, 'band 0');
    t.eq(core.judge.toleranceBand(20, judge), 1, 'band 1');
    t.eq(core.judge.toleranceBand(60, judge), 2, 'band 2');
  });

  t.test('两档阈值满足 完美容差 < 失误容差', () => {
    t.lt(judge.perfectTol, judge.missTol, '完美容差必须严格小于失误容差，否则「一般落点」区间不存在');
  });
};
