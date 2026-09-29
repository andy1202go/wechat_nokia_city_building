/**
 * 表现层动画状态。
 *
 * 刻意与内核分开：内核只负责「游戏发生了什么」（确定性、可测试），
 * 这里只负责「看起来怎么样」（压扁、闪烁、抖动、连击弹跳）。
 * 内核通过事件队列把发生的事告诉这一层，它自己决定怎么演。
 */
const DEFAULT = require('../core/config');
const draw = require('./draw');

function createPresenter() {
  return {
    // 累计时间，驱动摇摆与呼吸感
    t: 0,
    // 落地压扁动画剩余时间与目标楼层索引
    squashTimer: 0,
    squashIndex: -1,
    // 判定闪烁 { verdict, timer }
    flash: null,
    // 连击弹跳剩余时间
    comboPop: 0,
    // 失误画面抖动剩余时间
    shakeTimer: 0,
    // 结算面板的渐入进度
    endReveal: 0,
    // 坍塌倒塌动画已经过的时间（秒）。**负数表示尚未坍塌**，因为「倒了多久」是单向推进的，
    // 用一个累计量而不是倒计时，倒稳之后可以自然停在那里、不需要额外状态去维持。
    collapseT: -1
  };
}

/** 消费内核事件，转成演出。需要 run 是为了定位刚落地的楼层索引。 */
function consumeEvents(presenter, events, run, cfg = DEFAULT) {
  if (!events || events.length === 0) return presenter;

  // 一个批次里可能有多条落地事件（帧率抖动时）。先算出本批会加几层，
  // 才能把每层映射回最终塔里的正确索引。
  let adding = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].type === 'land' && events[i].floorAdded) adding += 1;
  }
  let floorCursor = (run ? run.tower.floors.length : 0) - adding;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];

    if (event.type === 'land') {
      presenter.flash = { verdict: event.verdict, timer: 0.42 };

      if (event.floorAdded) {
        markLanded(presenter, floorCursor, cfg);
        floorCursor += 1;
      }
      if (event.verdict === 'perfect') {
        presenter.comboPop = 0.3;
      } else if (event.verdict === 'miss') {
        presenter.shakeTimer = cfg.VISUAL.missShakeSec;
      }
    } else if (event.type === 'end') {
      presenter.endReveal = 0;
      if (event.ending === 'collapsed') {
        presenter.shakeTimer = cfg.VISUAL.missShakeSec * 2.2;
        // 清零即启动倒塌动画（见 collapseTilt）
        presenter.collapseT = 0;
      }
    }
  }
  return presenter;
}

/** 落地压扁：把动画绑到具体的楼层索引上，只有那一层会被压。 */
function markLanded(presenter, floorIndex, cfg = DEFAULT) {
  presenter.squashIndex = floorIndex;
  presenter.squashTimer = cfg.VISUAL.landingSquashSec;
  return presenter;
}

function advancePresenter(presenter, dt, cfg = DEFAULT) {
  presenter.t += dt;

  if (presenter.squashTimer > 0) {
    presenter.squashTimer = Math.max(0, presenter.squashTimer - dt);
  }
  if (presenter.comboPop > 0) {
    presenter.comboPop = Math.max(0, presenter.comboPop - dt);
  }
  if (presenter.shakeTimer > 0) {
    presenter.shakeTimer = Math.max(0, presenter.shakeTimer - dt);
  }
  if (presenter.flash) {
    presenter.flash.timer -= dt;
    if (presenter.flash.timer <= 0) presenter.flash = null;
  }
  if (presenter.endReveal < 1) {
    presenter.endReveal = Math.min(1, presenter.endReveal + dt * 3.2);
  }
  // 已坍塌就继续推进倒塌进度；倒稳之后继续累加也无妨，collapseTilt 会把它夹住
  if (presenter.collapseT >= 0) {
    presenter.collapseT += dt;
  }
  return presenter;
}

/**
 * 坍塌时叠加在派生倾角之上的额外倒塌旋转（弧度，带符号：正值向 +x 侧倒）。
 *
 * 这是**纯演出**：内核的 leanAngle 由偏心算出、渲染层只读，所以「倒了多少」必须是
 * 独立的一份表现层状态，绝不能反过来去改倾角 —— 那会让画面与判定脱节。
 * 方向由调用方传入（取自偏移心的符号），保证「往重的哪一侧倒」与判定同源。
 */
function collapseTilt(presenter, cfg = DEFAULT, sign = 1) {
  if (presenter.collapseT < 0) return 0;

  const duration = cfg.VISUAL.collapseSec;
  // 时长为 0 或负时直接给满，避免除零后进度变成 Infinity
  const progress = duration > 0 ? Math.min(1, presenter.collapseT / duration) : 1;
  const sweep = (cfg.VISUAL.collapseSweepDeg * Math.PI) / 180;

  return (sign < 0 ? -1 : 1) * sweep * draw.easeOutCubic(progress);
}

/** 画面抖动的瞬时位移（像素）。 */
function shakeOffset(presenter, cfg = DEFAULT) {
  if (presenter.shakeTimer <= 0) return { x: 0, y: 0 };
  const progress = presenter.shakeTimer / cfg.VISUAL.missShakeSec;
  const amplitude = cfg.VISUAL.missShakePx * progress;
  const phase = presenter.t * 46;
  return {
    x: Math.sin(phase) * amplitude,
    y: Math.cos(phase * 1.37) * amplitude * 0.5
  };
}

/** 当前落地压扁的纵向缩放系数（1 表示不变形）。 */
function squashScale(presenter, floorIndex, cfg = DEFAULT) {
  if (presenter.squashIndex !== floorIndex || presenter.squashTimer <= 0) return 1;
  const progress = presenter.squashTimer / cfg.VISUAL.landingSquashSec;
  return 1 - cfg.VISUAL.landingSquash * progress;
}

function resetPresenter(presenter) {
  presenter.t = 0;
  presenter.squashTimer = 0;
  presenter.squashIndex = -1;
  presenter.flash = null;
  presenter.comboPop = 0;
  presenter.shakeTimer = 0;
  presenter.endReveal = 0;
  presenter.collapseT = -1;
  return presenter;
}

module.exports = {
  createPresenter,
  resetPresenter,
  consumeEvents,
  markLanded,
  advancePresenter,
  shakeOffset,
  squashScale,
  collapseTilt
};
