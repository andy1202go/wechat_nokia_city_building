/**
 * 吊车几何测试：钟摆摆角与水平位置必须严格自洽。
 * 渲染层直接拿摆角画吊绳，所以这个一致性一旦破了，视觉和逻辑就会脱节。
 */
const core = require('../js/core');

module.exports = function register(t) {
  const cfg = core.config;
  const C = cfg.CRANE;

  function sineX(tSec, floorCount) {
    const omega = core.crane.omegaForFloorCount(floorCount, cfg);
    return C.centerX + C.amplitude * Math.sin(omega * tSec);
  }

  t.test('摆动周期随塔高从起始值收紧到最小值', () => {
    t.eq(core.crane.periodForFloorCount(0, cfg), C.periodSecAtStart, '起始周期');
    t.eq(core.crane.periodForFloorCount(C.periodRampFloors, cfg), C.periodSecAtMin, '爬满后为最小周期');
    t.eq(core.crane.periodForFloorCount(9999, cfg), C.periodSecAtMin, '超出爬升区间后不再收紧');
    const mid = core.crane.periodForFloorCount(C.periodRampFloors / 2, cfg);
    t.gt(core.crane.periodForFloorCount(0, cfg), mid, '周期单调下降');
    t.gt(mid, core.crane.periodForFloorCount(C.periodRampFloors, cfg), '周期单调下降');
  });

  t.test('水平位置严格遵循正弦曲线', () => {
    const floorCount = 5;
    for (let i = 0; i < 50; i += 1) {
      const tSec = i * 0.031;
      t.close(
        core.crane.craneXAt(tSec, floorCount, cfg),
        sineX(tSec, floorCount),
        1e-9,
        `t=${tSec} 时的水平位置`
      );
    }
  });

  // 这是渲染层正确性的根据：吊绳角度解出的水平位置必须等于正弦公式。
  t.test('摆角解出的水平位置等于正弦公式（渲染与逻辑同源）', () => {
    const floorCount = 5;
    for (let i = 0; i < 50; i += 1) {
      const tSec = i * 0.037;
      const angle = core.crane.pendulumAngleAt(tSec, floorCount, cfg);
      const xFromAngle = C.centerX + C.pendulumLength * Math.sin(angle);
      t.close(xFromAngle, sineX(tSec, floorCount), 1e-9, `t=${tSec} 时摆角与正弦必须自洽`);
    }
  });

  // 用解析点验证峰值：sin 在 T/4 处恰好为 +1、在 3T/4 处恰好为 -1。
  // 采样逼近峰值是不可靠的，永远差最后一点点。
  t.test('水平位置恰好触及振幅上下界，且从不越界', () => {
    const floorCount = 10;
    const period = core.crane.periodForFloorCount(floorCount, cfg);

    t.close(
      core.crane.craneXAt(period / 4, floorCount, cfg),
      C.centerX + C.amplitude,
      1e-9,
      'T/4 处应恰好达到振幅上限'
    );
    t.close(
      core.crane.craneXAt((period * 3) / 4, floorCount, cfg),
      C.centerX - C.amplitude,
      1e-9,
      '3T/4 处应恰好达到振幅下限'
    );

    let overRange = 0;
    for (let i = 0; i < 800; i += 1) {
      const deviation = Math.abs(core.crane.craneXAt(i * 0.011, floorCount, cfg) - C.centerX);
      if (deviation > C.amplitude + 1e-9) overRange += 1;
    }
    t.eq(overRange, 0, '任何时刻都不应越出振幅范围');
  });

  t.test('摆角绝对值不超过 asin(amplitude / pendulumLength)', () => {
    const limit = Math.asin(C.amplitude / C.pendulumLength);
    for (let i = 0; i < 500; i += 1) {
      const angle = Math.abs(core.crane.pendulumAngleAt(i * 0.013, 10, cfg));
      t.assert(angle <= limit + 1e-9, `t=${i * 0.013} 时摆角越界：${angle} > ${limit}`);
    }
  });

  t.test('楼层底面始终高于塔顶；摆到两端时被抬得更高', () => {
    const towerTopY = 220;
    let minBottom = Infinity;
    for (let i = 0; i < 400; i += 1) {
      const bottom = core.crane.blockBottomYAt(i * 0.01, 3, towerTopY, cfg);
      minBottom = Math.min(minBottom, bottom);
    }
    t.gt(minBottom, towerTopY, '楼层底面必须始终高于塔顶，否则会穿模');

    const period = core.crane.periodForFloorCount(3, cfg);
    const atCenter = core.crane.blockBottomYAt(0, 3, towerTopY, cfg);
    const atExtreme = core.crane.blockBottomYAt(period / 4, 3, towerTopY, cfg);
    t.gt(atExtreme, atCenter, '钟摆摆到两端时楼层更高，因此下落距离更长');
  });

  t.test('release 在释放瞬间锁定水平位置与高度', () => {
    const crane = core.crane.createCrane();
    core.crane.advanceSwing(crane, 0.31);
    const towerTopY = 150;

    const drop = core.crane.release(crane, 0, towerTopY, cfg);
    t.close(drop.x, sineX(0.31, 0), 1e-9, '锁定的水平位置');
    t.close(drop.y, core.crane.blockBottomYAt(0.31, 0, towerTopY, cfg), 1e-9, '锁定的起始高度');
    t.eq(drop.landed, false, '尚未落地');
    t.eq(drop.vy, 0, '初速度为 0');
    t.close(drop.targetY, towerTopY, 1e-9, '目标是塔顶');
  });

  t.test('下落用梯形积分推进，落地时精确对齐塔顶', () => {
    const crane = core.crane.createCrane();
    const towerTopY = 150;
    core.crane.release(crane, 0, towerTopY, cfg);

    let steps = 0;
    while (!core.crane.advanceDrop(crane, cfg.FEEL.fixedDt, cfg) && steps < 1000) steps += 1;

    t.lt(steps, 1000, '下落必须在有限步内结束');
    t.gt(steps, 1, '不应在一帧内落地');
    t.close(crane.drop.y, towerTopY, 1e-9, '落地位置精确等于塔顶，不会过冲');
    t.gt(crane.drop.vy, 0, '落地时应具有下落速度');

    const cleared = core.crane.clearDrop(crane);
    t.eq(crane.drop, null, '清空后 drop 为 null');
    t.close(cleared.y, towerTopY, 1e-9, '清空会返回刚落地的那一层');
  });

  t.test('下落耗时与重力加速度一致', () => {
    const crane = core.crane.createCrane();
    const towerTopY = 100;
    const drop = core.crane.release(crane, 0, towerTopY, cfg);
    const fallDistance = drop.y - towerTopY;
    const expected = Math.sqrt((2 * fallDistance) / C.dropGravity);

    let elapsed = 0;
    while (!core.crane.advanceDrop(crane, cfg.FEEL.fixedDt, cfg) && elapsed < 10) {
      elapsed += cfg.FEEL.fixedDt;
    }
    t.close(elapsed + cfg.FEEL.fixedDt, expected, 0.04, '下落时长应在解析解附近');
  });
};
