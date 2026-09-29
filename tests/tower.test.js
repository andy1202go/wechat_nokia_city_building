/**
 * 塔的稳定性状态测试。
 */
const core = require('../js/core');
const h = require('./helpers');

module.exports = function register(t) {
  const cfg = core.config;
  const W = cfg.WORLD.width;
  const FH = cfg.FLOOR.height;

  t.test('空塔：重心等于地基中心，偏心为 0，未坍塌', () => {
    const tower = core.tower.createTower(cfg);
    t.eq(core.tower.floorCount(tower), 0, '空塔楼层数');
    t.close(core.tower.centroidX(tower), tower.foundationCenterX, 1e-9, '空塔重心');
    t.close(core.tower.eccentricity(tower), 0, 1e-9, '空塔偏心');
    t.eq(core.tower.isCollapsed(tower, cfg), false, '空塔不应判定为坍塌');
  });

  t.test('增量维护的重心与朴素遍历结果一致', () => {
    const tower = core.tower.createTower(cfg);
    const rand = h.makeRandom(20260929);
    for (let i = 0; i < 200; i += 1) {
      core.tower.addFloor(tower, 40 + rand() * (W - 80), cfg);
    }
    t.close(
      core.tower.centroidX(tower),
      core.tower.centroidXByScan(tower),
      1e-9,
      'running sum 与朴素均值必须一致'
    );
  });

  // 这条用例是整个建模决策的回归防线。
  // 四层楼各相对地基中线的偏移为 0 / -12 / +10 / -4：
  //   相邻两层的落点偏差依次是 -12 / +10 / -4，全部落在失误容差 32 以内，玩法上完全可达；
  //   累积偏移和是 26，但重心其实压在轴线附近（偏心 1.5）。
  // 若有人把坍塌判据「优化」回 Σ|dx|，这条用例会立刻失败。
  t.test('回归：左右往复的塔不被误判为坍塌（这就是否决累积和模型的理由）', () => {
    const tower = core.tower.createTower(cfg);
    const axisOffsets = [0, -12, 10, -4];
    let sumAbs = 0;

    axisOffsets.forEach((dx) => {
      sumAbs += Math.abs(dx);
      core.tower.addFloor(tower, tower.foundationCenterX + dx, cfg);
    });

    t.eq(sumAbs, 26, '累积偏移和应为 26');
    t.close(core.tower.eccentricity(tower), 1.5, 1e-9, '偏心应恰好为 1.5');
    t.gt(sumAbs, core.tower.eccentricity(tower) * 10, '累积和应远大于偏心，证明两者不是同一个量');
    t.eq(core.tower.isCollapsed(tower, cfg), false, '这座塔必须判定为未坍塌');
  });

  t.test('单向漂移的塔：连续同向一般落点会被判坍塌', () => {
    const run = h.createRunWith();
    const r1 = h.dropAtOffset(run, 20);
    t.eq(r1.verdict, 'imperfect', '偏差 20 应落在一般区间');
    t.eq(core.run.isEnded(run), false, '第 1 层不应结束');

    const r2 = h.dropAtOffset(run, 20);
    t.eq(r2.verdict, 'imperfect', '第 2 层仍是一般落点');
    t.eq(core.run.isEnded(run), false, '第 2 层不应结束');

    const r3 = h.dropAtOffset(run, 20);
    t.eq(r3.verdict, 'imperfect', '第 3 层仍是一般落点');
    t.eq(run.ending, core.run.ENDING.COLLAPSED, '第 3 层应触发坍塌');
    t.eq(run.missBudget, cfg.RUN.missBudget, '全程无失误，失误额度不应被消耗');
  });

  t.test('高塔惩罚：同样的偏心，塔越高越危险', () => {
    const tall = core.tower.createTower(cfg);
    for (let i = 0; i < 20; i += 1) {
      core.tower.addFloor(tall, 187.5 + 30, cfg);
    }
    t.close(core.tower.eccentricity(tall), 30, 1e-9, '偏心应为 30');
    t.eq(core.tower.isCollapsed(tall, cfg), true, '20 层、偏心 30 应判坍塌');

    const noPenalty = h.withConfig({ STABILITY: { topHeavyGain: 0 } });
    t.eq(
      core.tower.isCollapsed(tall, noPenalty),
      false,
      '关掉高塔收紧系数后，同样的塔不应坍塌 —— 证明该旋钮确实在起作用'
    );
  });

  t.test('坍塌阈值随塔高单调收紧', () => {
    const heights = [1, 5, 10, 20, 40];
    let prev = Infinity;
    heights.forEach((n) => {
      const tower = core.tower.createTower(cfg);
      for (let i = 0; i < n; i += 1) core.tower.addFloor(tower, 187.5, cfg);
      const threshold = core.tower.collapseThreshold(tower, cfg);
      t.lt(threshold, prev, `塔高 ${n} 层的阈值应小于上一层`);
      prev = threshold;
    });
  });

  t.test('落点会被钳制在世界范围内', () => {
    const tower = core.tower.createTower(cfg);
    const half = cfg.FLOOR.width / 2;
    core.tower.addFloor(tower, -999, cfg);
    t.close(tower.floors[0].x, half, 1e-9, '左边界钳制');
    core.tower.addFloor(tower, 9999, cfg);
    t.close(tower.floors[1].x, W - half, 1e-9, '右边界钳制');
  });

  t.test('倾角方向随偏心符号翻转，且高度越高倾角越小', () => {
    const right = core.tower.createTower(cfg);
    core.tower.addFloor(right, 187.5 + 20, cfg);
    core.tower.addFloor(right, 187.5 + 20, cfg);
    t.gt(core.tower.leanAngle(right, cfg), 0, '重心右偏时倾角应为正');

    const left = core.tower.createTower(cfg);
    core.tower.addFloor(left, 187.5 - 20, cfg);
    core.tower.addFloor(left, 187.5 - 20, cfg);
    t.lt(core.tower.leanAngle(left, cfg), 0, '重心左偏时倾角应为负');

    const tall = core.tower.createTower(cfg);
    for (let i = 0; i < 20; i += 1) core.tower.addFloor(tall, 187.5 + 20, cfg);
    t.lt(
      Math.abs(core.tower.leanAngle(tall, cfg)),
      Math.abs(core.tower.leanAngle(right, cfg)),
      '同样偏心下，更高的塔倾角更小'
    );
  });

  t.test('摇摆强度会随时间衰减，且不会超过 1', () => {
    const tower = core.tower.createTower(cfg);
    core.tower.bumpSway(tower, 0.8);
    t.close(tower.sway, 0.8, 1e-9, '叠加摇摆强度');
    core.tower.bumpSway(tower, 5.0);
    t.close(tower.sway, 1, 1e-9, '摇摆强度上限为 1');

    const before = tower.sway;
    core.tower.advanceSway(tower, 0.1, cfg);
    t.lt(tower.sway, before, '随时间应衰减');
    core.tower.advanceSway(tower, 100, cfg);
    t.close(tower.sway, 0, 1e-9, '长时间后应归零');
  });

  t.test('塔顶坐标：空塔时取地基中心，有楼层后取顶层位置', () => {
    const tower = core.tower.createTower(cfg);
    t.close(core.tower.topCenterX(tower), 187.5, 1e-9, '空塔塔顶水平位置');
    t.close(core.tower.topY(tower, cfg), 0, 1e-9, '空塔塔顶高度');
    core.tower.addFloor(tower, 200, cfg);
    core.tower.addFloor(tower, 210, cfg);
    t.close(core.tower.topCenterX(tower), 210, 1e-9, '塔顶水平位置取顶层');
    t.close(core.tower.topY(tower, cfg), FH * 2, 1e-9, '塔顶高度 = 楼层数 × 层高');
  });
};
