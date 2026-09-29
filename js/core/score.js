/**
 * 人口与得分。
 *
 * 这两个量在原作说明里被混用（「组合得分将增加到人口得分中」），本项目刻意拆开：
 *   人口 = 塔的长期属性，由连击与塔高共同决定，跨局面保留
 *   得分 = 一次局面结束后换算出的竞技数值，只在单局内成立
 * 见 CONTEXT.md 的 Flagged ambiguities。
 */
const DEFAULT = require('./config');

/** 一层的落点给多少人口。连击越高、给得越多（有上限，避免高层数爆表）。 */
function populationGain(comboCount, cfg = DEFAULT) {
  const { basePerFloor, comboStepBonus, comboCap } = cfg.POPULATION;
  const step = Math.min(Math.max(0, comboCount), comboCap);
  return basePerFloor * (1 + comboStepBonus * step);
}

/**
 * 结算得分。
 * 封顶（失误额度用尽、塔身保留）不打折；坍塌（偏心超限、塔倒下）打 collapsePenalty 折扣。
 */
function computeScore(summary, cfg = DEFAULT) {
  const s = cfg.SCORE;
  const floors = summary.floors || 0;
  const comboBest = summary.comboBest || 0;
  const population = summary.population || 0;

  let score = floors * s.perFloor + comboBest * s.comboBonusPerStep + population * s.populationFactor;

  if (summary.ending === 'collapsed') score *= 1 - s.collapsePenalty;
  return Math.round(score);
}

/** 展示用的人口整数（内部保留浮点，避免多次取整累积误差）。 */
function populationDisplay(population) {
  return Math.floor(population);
}

module.exports = {
  populationGain,
  computeScore,
  populationDisplay
};
