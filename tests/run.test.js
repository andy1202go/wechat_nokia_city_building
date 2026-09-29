/**
 * 局面状态机测试：两条终局路径、状态流转、事件队列、得分结算。
 */
const core = require('../js/core');
const h = require('./helpers');

module.exports = function register(t) {
  const cfg = core.config;
  const PHASE = core.run.PHASE;
  const ENDING = core.run.ENDING;

  function advanceUntilNot(run, phase, maxSteps) {
    const cap = maxSteps || 2000;
    let steps = 0;
    while (run.phase === phase && steps < cap) {
      core.run.update(run, cfg.FEEL.fixedDt);
      steps += 1;
    }
    return steps;
  }

  t.test('新局面的初始状态', () => {
    const run = h.createRunWith();
    t.eq(run.phase, PHASE.SWINGING, '初始为摆动中');
    t.eq(run.ending, null, '无终局');
    t.eq(run.missBudget, cfg.RUN.missBudget, '失误额度为配置值');
    t.eq(core.run.floorCount(run), 0, '空塔');
    t.eq(core.run.population(run), 0, '人口为 0');
    t.eq(run.score, 0, '得分为 0');
    t.eq(core.run.canDrop(run), true, '可以投放');
  });

  t.test('完美落点：加楼层、递增连击、加人口、不消耗失误额度', () => {
    const run = h.createRunWith();
    const result = h.dropAtOffset(run, 0);

    t.eq(result.verdict, 'perfect', '偏差 0 应为完美落点');
    t.eq(result.floorAdded, true, '完美落点应加入楼层');
    t.eq(core.run.floorCount(run), 1, '楼层数为 1');
    t.eq(run.combo.count, 1, '连击为 1');
    t.gt(run.population, 0, '人口应增加');
    t.eq(run.missBudget, cfg.RUN.missBudget, '失误额度不应被消耗');
    t.eq(run.lastVerdict, 'perfect', '最近判定被记录');
  });

  t.test('一般落点：加楼层、保持连击、不消耗失误额度', () => {
    const run = h.createRunWith();
    h.dropAtOffset(run, 0);
    h.dropAtOffset(run, 0);
    t.eq(run.combo.count, 2, '前置：连击到 2');

    const result = h.dropAtOffset(run, 20);
    t.eq(result.verdict, 'imperfect', '偏差 20 应为一般落点');
    t.eq(result.floorAdded, true, '一般落点应加入楼层');
    t.eq(run.combo.count, 2, '一般落点必须保持连击');
    t.eq(run.missBudget, cfg.RUN.missBudget, '一般落点不消耗失误额度');
  });

  t.test('失误：不加楼层、消耗额度、清零连击，且不改变重心', () => {
    const run = h.createRunWith();
    h.dropAtOffset(run, 0);
    h.dropAtOffset(run, 0);
    const eccentricityBefore = core.tower.eccentricity(run.tower);

    const result = h.dropAtOffset(run, 60);
    t.eq(result.verdict, 'miss', '偏差 60 应为失误');
    t.eq(result.floorAdded, false, '失误不应加入楼层');
    t.eq(core.run.floorCount(run), 2, '失误不改变楼层数');
    t.eq(run.missBudget, cfg.RUN.missBudget - 1, '失误额度减 1');
    t.eq(run.combo.count, 0, '失误清零连击');
    t.close(
      core.tower.eccentricity(run.tower),
      eccentricityBefore,
      1e-9,
      '失误不加入楼层，因此重心完全不变'
    );
  });

  t.test('终局一：失误额度耗尽触发封顶，塔身保留', () => {
    const run = h.createRunWith();
    h.dropAtOffset(run, 0);
    h.dropAtOffset(run, 0);
    h.dropAtOffset(run, 0);
    const floorsBefore = core.run.floorCount(run);
    t.eq(floorsBefore, 3, '前置：已建 3 层');

    h.dropAtOffset(run, 60);
    h.dropAtOffset(run, 60);
    t.eq(core.run.isEnded(run), false, '两次失误后本局应继续');

    h.dropAtOffset(run, 60);
    t.eq(run.ending, ENDING.TOPPED_OUT, '第 3 次失误应触发封顶');
    t.eq(run.phase, PHASE.ENDED, '进入终局状态');
    t.eq(core.run.floorCount(run), floorsBefore, '封顶必须保留塔身');
    t.eq(run.missBudget, 0, '失误额度用尽');
    t.gt(run.score, 0, '封顶后应产生得分');
  });

  t.test('终局二：偏心超限触发坍塌，且不消耗失误额度', () => {
    const run = h.createRunWith();
    const first = h.dropAtOffset(run, 20);
    t.eq(first.verdict, 'imperfect', '第 1 层为一般落点');
    t.eq(core.run.isEnded(run), false, '第 1 层不应结束');

    h.dropAtOffset(run, 20);
    t.eq(core.run.isEnded(run), false, '第 2 层不应结束');

    h.dropAtOffset(run, 20);
    t.eq(run.ending, ENDING.COLLAPSED, '第 3 层应触发坍塌');
    t.eq(run.missBudget, cfg.RUN.missBudget, '全程无失误，失误额度应完好');
  });

  t.test('坍塌优先于封顶（防御性判定）', () => {
    const run = h.createRunWith();
    // 人为构造一座已经越界的塔，模拟异常状态
    for (let i = 0; i < 20; i += 1) core.tower.addFloor(run.tower, 217.5, run.config);
    t.eq(core.tower.isCollapsed(run.tower, run.config), true, '前置条件：塔已越界');
    run.missBudget = 1;

    const result = h.dropAtOffset(run, 60);
    t.eq(result.verdict, 'miss', '应为失误');
    t.eq(run.missBudget, 0, '失误额度已耗尽');
    t.eq(run.ending, ENDING.COLLAPSED, '同时满足两个条件时，坍塌必须优先');
  });

  t.test('终局后不可再投放', () => {
    const run = h.createRunWith();
    h.dropAtOffset(run, 60);
    h.dropAtOffset(run, 60);
    h.dropAtOffset(run, 60);
    t.eq(core.run.isEnded(run), true, '前置：已终局');
    t.eq(core.run.requestDrop(run), null, '终局后 requestDrop 应返回 null');
    t.eq(core.run.canDrop(run), false, '终局后 canDrop 为 false');
  });

  t.test('动画流程：摆动 -> 下落 -> 判定 -> 停顿 -> 摆动', () => {
    const run = h.createRunWith();
    t.eq(run.phase, PHASE.SWINGING, '起始为摆动');

    const drop = core.run.requestDrop(run);
    t.assert(drop !== null, '应能发起投放');
    t.eq(run.phase, PHASE.DROPPING, '投放后进入下落');

    const fallSteps = advanceUntilNot(run, PHASE.DROPPING, 600);
    t.lt(fallSteps, 600, '下落必须在有限步数内结束');
    t.eq(run.phase, PHASE.SETTLING, '落地后进入停顿');
    t.eq(core.run.floorCount(run), 1, '落地后楼层数加 1');
    t.eq(run.lastVerdict, 'perfect', 't=0 时吊车位于摆动中心，偏差应为 0');

    const settleSteps = advanceUntilNot(run, PHASE.SETTLING, 60);
    t.lt(settleSteps, 60, '停顿应在有限步数内结束');
    t.eq(run.phase, PHASE.SWINGING, '停顿结束后回到摆动');
  });

  t.test('落点水平位置在释放瞬间锁定，下落期间摆动相位冻结', () => {
    const run = h.createRunWith();
    core.run.update(run, 0.25);
    const expectedX = core.crane.craneX(run.crane, 0, run.config);

    const drop = core.run.requestDrop(run);
    t.close(drop.x, expectedX, 1e-9, '落点应等于释放瞬间的吊车位置');

    const phaseBefore = run.crane.t;
    core.run.update(run, 0.05);
    t.close(run.crane.t, phaseBefore, 1e-9, '下落期间摆动相位不应推进');
  });

  t.test('摆动确实在改变吊车位置，且周期随塔高收紧', () => {
    const run = h.createRunWith();
    const x0 = core.crane.craneX(run.crane, 0, run.config);
    core.run.update(run, 0.4);
    const x1 = core.crane.craneX(run.crane, 0, run.config);
    t.assert(Math.abs(x1 - x0) > 1, '摆动应显著改变吊车位置');

    const start = core.crane.periodForFloorCount(0, cfg);
    const capped = core.crane.periodForFloorCount(cfg.CRANE.periodRampFloors * 2, cfg);
    t.eq(start, cfg.CRANE.periodSecAtStart, '起始周期');
    t.eq(capped, cfg.CRANE.periodSecAtMin, '达到爬升楼层数后收紧到最小周期');
    t.gt(start, capped, '周期应随塔高缩短（难度爬升）');
  });

  t.test('事件队列：落地与终局事件可被取出，取出后清空', () => {
    const run = h.createRunWith();
    h.dropAtOffset(run, 0);
    const events = core.run.drainEvents(run);
    t.assert(events.length > 0, '应产生事件');
    t.eq(events[events.length - 1].type, 'land', '最后一个事件是落地');
    t.eq(events[events.length - 1].verdict, 'perfect', '落地事件带判定结果');
    t.eq(core.run.drainEvents(run).length, 0, '取走后队列应为空');
  });

  t.test('得分：封顶不打折，坍塌打折扣', () => {
    const s = cfg.SCORE;
    const base = { floors: 10, comboBest: 5, population: 100 };
    const full = core.score.computeScore(Object.assign({}, base, { ending: ENDING.TOPPED_OUT }), cfg);
    const penal = core.score.computeScore(Object.assign({}, base, { ending: ENDING.COLLAPSED }), cfg);

    t.eq(
      full,
      Math.round(10 * s.perFloor + 5 * s.comboBonusPerStep + 100 * s.populationFactor),
      '封顶得分公式'
    );
    t.gt(full, penal, '坍塌得分必须低于封顶');
    t.close(penal / full, 1 - s.collapsePenalty, 0.01, '坍塌折扣比例');
  });

  t.test('人口：连击越高单层人口越多，且有上限', () => {
    const plain = core.score.populationGain(0, cfg);
    const combo3 = core.score.populationGain(3, cfg);
    const capped = core.score.populationGain(999, cfg);
    const atCap = core.score.populationGain(cfg.POPULATION.comboCap, cfg);

    t.eq(plain, cfg.POPULATION.basePerFloor, '无连击时为基础人口');
    t.gt(combo3, plain, '连击提高人口收益');
    t.close(capped, atCap, 1e-9, '人口收益在 comboCap 处封顶');
  });

  t.test('resetRun 把局面完全恢复到初始状态', () => {
    const run = h.createRunWith();
    h.dropAtOffset(run, 0);
    h.dropAtOffset(run, 20);
    t.gt(core.run.floorCount(run), 0, '前置：已建楼层');

    core.run.resetRun(run);
    t.eq(run.phase, PHASE.SWINGING, '回到摆动');
    t.eq(run.ending, null, '清空终局');
    t.eq(core.run.floorCount(run), 0, '楼层清空');
    t.eq(run.combo.count, 0, '连击清空');
    t.eq(run.missBudget, cfg.RUN.missBudget, '失误额度恢复');
    t.eq(run.score, 0, '得分清空');
    t.eq(run.population, 0, '人口清空');
    t.eq(run.events.length, 0, '事件队列清空');
    t.close(core.tower.eccentricity(run.tower), 0, 1e-9, '偏心归零');
  });
};
