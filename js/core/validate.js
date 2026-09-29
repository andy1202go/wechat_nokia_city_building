/**
 * 参数自检。
 *
 * 这个项目里最常见的失误是「调参调出一个内部自相矛盾的配置」——
 * 比如把摆动振幅调到超过摆臂长，摆角就无解了；或者把失误容差调得比完美容差还小，
 * 「一般落点」这个区间就消失了。这些错误在模拟器里往往表现为怪异的手感而不报错，
 * 极难定位。所以集中在这里做一次显式体检，由单元测试与启动流程分别调用。
 */
const DEFAULT = require('./config');

function validateConfig(cfg = DEFAULT) {
  const problems = [];
  const C = cfg.CRANE;
  const T = cfg.TOLERANCE;
  const S = cfg.STABILITY;

  if (C.amplitude >= C.pendulumLength) {
    problems.push(
      `CRANE.amplitude (${C.amplitude}) 必须小于 CRANE.pendulumLength (${C.pendulumLength})，` +
        '否则摆角 asin 无解、吊车会瞬移'
    );
  }
  if (C.amplitude <= 0) problems.push('CRANE.amplitude 必须为正');
  if (C.periodSecAtMin > C.periodSecAtStart) {
    problems.push('CRANE.periodSecAtMin 不应大于 periodSecAtStart，否则难度会随塔高变简单');
  }
  if (C.pivotHeightAboveTop <= C.pendulumLength) {
    problems.push(
      'CRANE.pivotHeightAboveTop 必须大于 pendulumLength，否则楼层在摆动中心处就低于塔顶'
    );
  }

  if (T.perfectRatio >= T.missRatio) {
    problems.push('TOLERANCE.perfectRatio 必须小于 missRatio，否则「一般落点」区间不存在');
  }
  if (T.missRatio !== 0.5) {
    problems.push(
      `TOLERANCE.missRatio 必须为 0.5（当前 ${T.missRatio}）。它等价于「落点中心越过下层支承边缘」，` +
        '改动会破坏判定与物理的一致性。要放宽容错请改 FOUNDATION.width 或 STABILITY.collapseRatio'
    );
  }

  if (cfg.FOUNDATION.width < cfg.FLOOR.width) {
    problems.push('FOUNDATION.width 不应小于 FLOOR.width，否则第一层楼层都会超出地基');
  }

  // 失误容差必须落在一层的坍塌阈值之内。
  //
  // 为什么这条必须存在：run.js 有一条不变式 —— 失误的楼层**不进塔**（因此不改变重心），
  // 而「一般落点」会进塔。一旦失误容差超过一层的坍塌阈值，这两档就会倒挂：
  //   偏差 43 -> 判「一般落点」-> 进塔 -> 偏心 43 > 阈值 40.3 -> 塔倒
  //   偏差 45 -> 判「失误」   -> 翻落 -> 塔完好，只扣一次失误额度
  // 也就是「投得更歪反而更安全」，三档判定的语义碎掉。
  //
  // 推论：FLOOR.width 与 FOUNDATION.width 必须同进同退 —— 前者决定容差，
  // 后者决定判定尺度。这层关系很隐晦（两个参数在 config 里隔了好几节），
  // 所以在这里显式钉住，而不是指望后来的人记得。
  const missTol = cfg.FLOOR.width * T.missRatio;
  const thresholdAtOne = (cfg.FOUNDATION.width / 2) * S.collapseRatio;
  if (missTol >= thresholdAtOne) {
    problems.push(
      `失误容差 (${missTol.toFixed(1)} = FLOOR.width ${cfg.FLOOR.width} × missRatio ${T.missRatio}) ` +
        `必须小于一层的坍塌阈值 (${thresholdAtOne.toFixed(1)} = FOUNDATION.width ${cfg.FOUNDATION.width} / 2 × collapseRatio ${S.collapseRatio})，` +
        '否则「一般落点」会直接导致坍塌、而更歪的失误反而不塌。' +
        '放大 FLOOR.width 时必须同步放大 FOUNDATION.width'
    );
  }
  if (S.collapseRatio <= 0 || S.collapseRatio > 1) {
    problems.push('STABILITY.collapseRatio 应落在 (0, 1] 内');
  }
  if (S.topHeavyGain < 0) {
    problems.push('STABILITY.topHeavyGain 不应为负，否则塔越高越稳，难度曲线反转');
  }

  const thresholdAtTwo = (cfg.FOUNDATION.width / 2) * S.collapseRatio * (1 / (1 + S.topHeavyGain));
  if (thresholdAtTwo <= 0) {
    problems.push('两层的坍塌阈值必须为正');
  }
  if (C.amplitude < thresholdAtTwo) {
    problems.push(
      `CRANE.amplitude (${C.amplitude}) 应不小于两层的坍塌阈值 (${thresholdAtTwo.toFixed(1)})，` +
        '否则塔一旦偏心，吊车就够不到塔顶、局面会变成必死'
    );
  }

  if (cfg.RUN.missBudget < 1) problems.push('RUN.missBudget 至少为 1');

  if (cfg.WORLD.width <= cfg.FOUNDATION.width) {
    problems.push('WORLD.width 必须大于 FOUNDATION.width');
  }

  return problems;
}

module.exports = { validateConfig };
