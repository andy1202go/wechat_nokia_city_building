/**
 * 判定：把「落点偏差」分成三档。
 *
 * 完美落点  |偏差| <= perfectTol   递增连击、给人口加成
 * 一般落点  perfectTol < |偏差| <= missTol   推高偏心，但不中断连击
 * 失误      |偏差| > missTol        楼层翻落，消耗失误额度
 *
 * 两个阈值不共用：得分侧只关心是否完美，稳定侧只关心偏心增量（见 docs/adr/0003）。
 */
const DEFAULT = require('./config');

const VERDICT = {
  PERFECT: 'perfect',
  IMPERFECT: 'imperfect',
  MISS: 'miss'
};

function createJudge(cfg = DEFAULT) {
  return {
    perfectTol: cfg.FLOOR.width * cfg.TOLERANCE.perfectRatio,
    missTol: cfg.FLOOR.width * cfg.TOLERANCE.missRatio
  };
}

/** 判定一次落点。offsetAbs 是落点偏差的绝对值。 */
function judgeOffset(offsetAbs, judge) {
  if (offsetAbs <= judge.perfectTol) return VERDICT.PERFECT;
  if (offsetAbs <= judge.missTol) return VERDICT.IMPERFECT;
  return VERDICT.MISS;
}

/** 偏差落在哪个区间，返回 0/1/2 便于断言边界。 */
function toleranceBand(offsetAbs, judge) {
  if (offsetAbs <= judge.perfectTol) return 0;
  if (offsetAbs <= judge.missTol) return 1;
  return 2;
}

module.exports = {
  VERDICT,
  createJudge,
  judgeOffset,
  toleranceBand
};
