/**
 * 吊车：悬挂当前楼层、在塔顶上方做水平往复摆动的装置。
 *
 * 几何是真正的钟摆，不是水平平移 —— 原版的楼层是吊在绳上摆过来的：
 *   吊点固定在 (centerX, 塔顶 + pivotHeightAboveTop)
 *   摆臂长 pendulumLength，摆角 φ
 *   楼层的水平位置 x = centerX + amplitude * sin(ωt)
 *   由 x 反解摆角：φ = asin(amplitude / pendulumLength * sin(ωt))
 *
 * 这样解出来的 φ 正好让水平位置等于正弦曲线 —— 两端慢、中间快，
 * 也就是钟摆的速度分布。渲染层直接把 φ 拿去画吊绳角度，逻辑与视觉不会脱节。
 *
 * 前提：amplitude < pendulumLength，否则摆角无解（由 validate.js 兜底）。
 */
const DEFAULT = require('./config');

function createCrane() {
  return {
    // 累计摆动相位时间
    t: 0,
    // 下落中的楼层；null 表示吊车正挂着楼层摆动
    drop: null
  };
}

function resetCrane(crane) {
  crane.t = 0;
  crane.drop = null;
  return crane;
}

/** 当前塔高对应的摆动周期，从 periodSecAtStart 线性收紧到 periodSecAtMin。 */
function periodForFloorCount(floorCount, cfg = DEFAULT) {
  const { periodSecAtStart, periodSecAtMin, periodRampFloors } = cfg.CRANE;
  if (periodRampFloors <= 0) return periodSecAtMin;
  const p = Math.min(1, Math.max(0, floorCount / periodRampFloors));
  return periodSecAtStart + (periodSecAtMin - periodSecAtStart) * p;
}

function omegaForFloorCount(floorCount, cfg = DEFAULT) {
  return (Math.PI * 2) / periodForFloorCount(floorCount, cfg);
}

function clampUnit(value) {
  return Math.min(1, Math.max(-1, value));
}

/** 摆动相位随时间推进。仅在 SWINGING 阶段调用。 */
function advanceSwing(crane, dt) {
  crane.t += dt;
  return crane.t;
}

/** 楼层水平位置。纯函数，便于测试与预览。 */
function craneXAt(t, floorCount, cfg = DEFAULT) {
  const omega = omegaForFloorCount(floorCount, cfg);
  return cfg.CRANE.centerX + cfg.CRANE.amplitude * Math.sin(omega * t);
}

/** 摆角（弧度）。渲染层用它画吊绳方向。 */
function pendulumAngleAt(t, floorCount, cfg = DEFAULT) {
  const omega = omegaForFloorCount(floorCount, cfg);
  const ratio = cfg.CRANE.amplitude / cfg.CRANE.pendulumLength;
  return Math.asin(clampUnit(ratio * Math.sin(omega * t)));
}

function craneX(crane, floorCount, cfg = DEFAULT) {
  return craneXAt(crane.t, floorCount, cfg);
}

function pendulumAngle(crane, floorCount, cfg = DEFAULT) {
  return pendulumAngleAt(crane.t, floorCount, cfg);
}

/** 吊点世界高度。 */
function pivotY(towerTopY, cfg = DEFAULT) {
  return towerTopY + cfg.CRANE.pivotHeightAboveTop;
}

/** 楼层底面的世界高度：随摆角抬升，摆到两端时更高。 */
function blockBottomYAt(t, floorCount, towerTopY, cfg = DEFAULT) {
  const angle = pendulumAngleAt(t, floorCount, cfg);
  return pivotY(towerTopY, cfg) - cfg.CRANE.pendulumLength * Math.cos(angle);
}

function hangCenterYAt(t, floorCount, towerTopY, cfg = DEFAULT) {
  return blockBottomYAt(t, floorCount, towerTopY, cfg) + cfg.FLOOR.height / 2;
}

/**
 * 发起一次投放。返回下落中的描述对象。
 * 落点水平位置在释放瞬间锁定，下落过程不做水平漂移 —— 与原版一致。
 */
function release(crane, floorCount, towerTopY, cfg = DEFAULT) {
  const x = craneX(crane, floorCount, cfg);
  const y = blockBottomYAt(crane.t, floorCount, towerTopY, cfg);
  crane.drop = {
    x,
    y,
    vy: 0,
    targetY: towerTopY,
    angle: pendulumAngle(crane, floorCount, cfg),
    landed: false
  };
  return crane.drop;
}

/**
 * 推进下落，返回是否已落地。
 * 用梯形积分（用步长前后的平均速度）而不是显式欧拉，避免固定步长下的过冲。
 */
function advanceDrop(crane, dt, cfg = DEFAULT) {
  const drop = crane.drop;
  if (!drop || drop.landed) return true;

  const g = cfg.CRANE.dropGravity;
  const prevVy = drop.vy;
  drop.vy = drop.vy + g * dt;
  drop.y -= ((prevVy + drop.vy) / 2) * dt;

  if (drop.y <= drop.targetY) {
    drop.y = drop.targetY;
    drop.landed = true;
  }
  return drop.landed;
}

function clearDrop(crane) {
  const drop = crane.drop;
  crane.drop = null;
  return drop;
}

module.exports = {
  createCrane,
  resetCrane,
  periodForFloorCount,
  omegaForFloorCount,
  craneX,
  craneXAt,
  pendulumAngle,
  pendulumAngleAt,
  pivotY,
  blockBottomYAt,
  hangCenterYAt,
  advanceSwing,
  release,
  advanceDrop,
  clearDrop
};
