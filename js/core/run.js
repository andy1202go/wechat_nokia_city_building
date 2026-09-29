/**
 * 局面（Run）：一次从空地基开始、直到终局的建造过程。
 *
 * 状态机
 *   SWINGING  吊车摆动，等待玩家投放
 *   DROPPING  楼层下落中
 *   SETTLING  落地后的短暂停顿，结束后回到 SWINGING
 *   ENDED     终局，不可再投放
 *
 * 两个互斥的终局（见 docs/adr/0004）
 *   TOPPED_OUT  失误额度耗尽 -> 封顶：本局结束、塔身保留、得分不打折
 *   COLLAPSED   偏心超限     -> 坍塌：塔整体倒下、得分打 collapsePenalty 折扣
 *
 * 设计不变式：失误不加入楼层，因此不会改变重心；一般落点不消耗失误额度。
 * 所以两个终局条件在正常流程下不会同时触发。代码仍显式让 COLLAPSED 优先，
 * 以防出现「楼层已被外部改动到濒临坍塌」这类异常状态。
 */
const DEFAULT = require('./config');
const tower = require('./tower');
const crane = require('./crane');
const { createJudge, judgeOffset, VERDICT } = require('./judge');
const { createCombo, resetCombo, applyCombo } = require('./combo');
const { populationGain, computeScore, populationDisplay } = require('./score');

const PHASE = {
  SWINGING: 'swinging',
  DROPPING: 'dropping',
  SETTLING: 'settling',
  ENDED: 'ended'
};

const ENDING = {
  TOPPED_OUT: 'toppedOut',
  COLLAPSED: 'collapsed'
};

const MAX_EVENTS = 64;

function createRun(cfg = DEFAULT) {
  return {
    config: cfg,
    tower: tower.createTower(cfg),
    crane: crane.createCrane(),
    judge: createJudge(cfg),
    combo: createCombo(cfg),
    phase: PHASE.SWINGING,
    ending: null,
    missBudget: cfg.RUN.missBudget,
    population: 0,
    score: 0,
    settleTimer: 0,
    lastVerdict: null,
    lastOffset: 0,
    // 供渲染层与音效层消费的事件队列，每帧由 game.js 取走
    events: []
  };
}

function resetRun(run) {
  tower.resetTower(run.tower);
  crane.resetCrane(run.crane);
  resetCombo(run.combo);
  run.judge = createJudge(run.config);
  run.phase = PHASE.SWINGING;
  run.ending = null;
  run.missBudget = run.config.RUN.missBudget;
  run.population = 0;
  run.score = 0;
  run.settleTimer = 0;
  run.lastVerdict = null;
  run.lastOffset = 0;
  run.events.length = 0;
  return run;
}

function pushEvent(run, event) {
  if (run.events.length >= MAX_EVENTS) run.events.shift();
  run.events.push(event);
}

/** 取走并清空事件队列。 */
function drainEvents(run) {
  if (run.events.length === 0) return [];
  const out = run.events.slice();
  run.events.length = 0;
  return out;
}

function isEnded(run) {
  return run.phase === PHASE.ENDED;
}

function canDrop(run) {
  return run.phase === PHASE.SWINGING && !run.ending;
}

function floorCount(run) {
  return tower.floorCount(run.tower);
}

function stabilityUsed(run) {
  return tower.stabilityUsed(run.tower, run.config);
}

function population(run) {
  return populationDisplay(run.population);
}

/** 发起一次投放，进入 DROPPING。下标越界或已终局时返回 null。 */
function requestDrop(run) {
  if (!canDrop(run)) return null;
  crane.release(
    run.crane,
    tower.floorCount(run.tower),
    tower.topY(run.tower, run.config),
    run.config
  );
  run.phase = PHASE.DROPPING;
  pushEvent(run, { type: 'release' });
  return run.crane.drop;
}

/**
 * 核心判定：让一层楼落在水平位置 x 上，完成判定与全部状态变更。
 * 与动画完全解耦，单元测试直接调用这个函数。
 */
function landAt(run, x) {
  const cfg = run.config;
  const targetX = tower.topCenterX(run.tower);
  const offset = x - targetX;
  const offsetAbs = Math.abs(offset);
  const verdict = judgeOffset(offsetAbs, run.judge);

  run.lastVerdict = verdict;
  run.lastOffset = offset;

  const result = {
    verdict,
    offset,
    offsetAbs,
    eccentricityBefore: tower.eccentricity(run.tower),
    eccentricityAfter: 0,
    stabilityUsedAfter: 0,
    comboBefore: run.combo.count,
    comboAfter: run.combo.count,
    populationGain: 0,
    floorAdded: false,
    missBudgetAfter: run.missBudget,
    ending: null
  };

  // 连击推进与「是否加楼层」无关：完美递增、一般落点保持、失误清零。
  // 曾经把这一步写在「加楼层」分支里，导致失误时连击不被清零 —— 已由单元测试钉住。
  result.comboAfter = applyCombo(run.combo, verdict);

  if (verdict === VERDICT.MISS) {
    // 失误：楼层翻落，不加入塔、因此不改变重心，只消耗失误额度
    run.missBudget -= 1;
    tower.bumpSway(run.tower, cfg.STABILITY.swayPerMiss);
    if (run.missBudget <= 0) result.ending = ENDING.TOPPED_OUT;
  } else {
    if (verdict === VERDICT.IMPERFECT) {
      tower.bumpSway(run.tower, cfg.STABILITY.swayPerImperfect);
    }
    const floor = tower.addFloor(run.tower, x, cfg);
    // 把判定结果记在楼层上：渲染层据此给完美落点的楼层加一道金色压顶
    floor.verdict = verdict;
    result.floorAdded = true;
    result.populationGain = populationGain(result.comboAfter, cfg);
    run.population += result.populationGain;
    if (tower.isCollapsed(run.tower, cfg)) result.ending = ENDING.COLLAPSED;
  }

  result.eccentricityAfter = tower.eccentricity(run.tower);
  result.stabilityUsedAfter = tower.stabilityUsed(run.tower, cfg);
  result.missBudgetAfter = run.missBudget;

  // 防御性判定：坍塌优先于封顶
  if (result.ending !== ENDING.COLLAPSED && tower.isCollapsed(run.tower, cfg)) {
    result.ending = ENDING.COLLAPSED;
  }

  pushEvent(run, {
    type: 'land',
    verdict,
    offset,
    floorAdded: result.floorAdded,
    eccentricity: result.eccentricityAfter,
    stabilityUsed: result.stabilityUsedAfter,
    comboAfter: result.comboAfter,
    missBudgetAfter: run.missBudget
  });

  if (result.ending) {
    finishRun(run, result.ending);
  } else {
    run.phase = PHASE.SETTLING;
    run.settleTimer = cfg.FEEL.settleDelaySec;
  }

  return result;
}

function finishRun(run, ending) {
  run.ending = ending;
  run.phase = PHASE.ENDED;
  run.score = computeScore(
    {
      floors: tower.floorCount(run.tower),
      comboBest: run.combo.best,
      population: run.population,
      ending
    },
    run.config
  );
  pushEvent(run, {
    type: 'end',
    ending,
    score: run.score,
    floors: tower.floorCount(run.tower),
    population: populationDisplay(run.population)
  });
  return run;
}

/** 推进固定步长 dt。 */
function update(run, dt) {
  const cfg = run.config;
  tower.advanceSway(run.tower, dt, cfg);

  if (run.phase === PHASE.SWINGING) {
    crane.advanceSwing(run.crane, dt);
    return run;
  }

  if (run.phase === PHASE.DROPPING) {
    if (crane.advanceDrop(run.crane, dt, cfg)) {
      const drop = crane.clearDrop(run.crane);
      landAt(run, drop.x);
    }
    return run;
  }

  if (run.phase === PHASE.SETTLING) {
    run.settleTimer -= dt;
    if (run.settleTimer <= 0) {
      run.settleTimer = 0;
      run.phase = PHASE.SWINGING;
    }
  }
  return run;
}

module.exports = {
  PHASE,
  ENDING,
  createRun,
  resetRun,
  update,
  requestDrop,
  landAt,
  finishRun,
  drainEvents,
  isEnded,
  canDrop,
  floorCount,
  stabilityUsed,
  population
};
