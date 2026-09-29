/**
 * 连击机。
 *
 * 唯一规则：连击只被「失误」中断，不被「一般落点」中断。
 * 这条规则决定了整个游戏的张力 —— 多数投放都会落在一股落点区间，
 * 玩家一直在「差一点点就完美」的边缘上，而不会因为一次手抖就断掉连击。
 */
const DEFAULT = require('./config');
const { VERDICT } = require('./judge');

function createCombo(cfg = DEFAULT) {
  return {
    count: 0,
    best: 0,
    maxSteps: cfg.COMBO.maxSteps
  };
}

function resetCombo(combo) {
  combo.count = 0;
  combo.best = 0;
  return combo;
}

/** 按判定结果推进连击，返回推进后的连击数。 */
function applyCombo(combo, verdict) {
  if (verdict === VERDICT.PERFECT) {
    combo.count = Math.min(combo.count + 1, combo.maxSteps);
    if (combo.count > combo.best) combo.best = combo.count;
  } else if (verdict === VERDICT.MISS) {
    combo.count = 0;
  }
  // VERDICT.IMPERFECT：连击保持不变，这正是规则的核心
  return combo.count;
}

/** 连击是否处于激活状态（>= 2 才有展示意义）。 */
function isComboActive(combo) {
  return combo.count >= 2;
}

module.exports = {
  createCombo,
  resetCombo,
  applyCombo,
  isComboActive
};
