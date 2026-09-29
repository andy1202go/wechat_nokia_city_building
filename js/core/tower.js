/**
 * 塔：楼层的集合，以及由楼层位置派生出的稳定性状态。
 *
 * 核心约定
 *   唯一真实状态是每层楼的水平中心位置 x。
 *   重心 = 各层 x 的平均值；偏心 = |重心 - 地基中心|。
 *   视觉倾角与摇摆强度都是派生量，不独立存储 —— 因此不存在
 *   「判定说没倒、视觉看着要倒」这类脱节问题（见 docs/adr/0003）。
 *
 * 所有函数都接受可选的 cfg 参数（默认取全局配置），便于测试时注入参数。
 */
const DEFAULT = require('./config');

function createTower(cfg = DEFAULT) {
  const foundationCenterX = cfg.WORLD.width / 2;
  return {
    foundationCenterX,
    foundationHalfWidth: cfg.FOUNDATION.width / 2,
    // 楼层数组，元素形如 { x, index }，x 是楼层中心的水平位置
    floors: [],
    // 重心用的增量累加器，避免每次判定都遍历全塔。O(1) 维护
    sumX: 0,
    // 视觉摇摆强度 0~1，由落点质量驱动、随时间衰减，只影响观感不影响判定
    sway: 0
  };
}

function resetTower(tower) {
  tower.floors.length = 0;
  tower.sumX = 0;
  tower.sway = 0;
  return tower;
}

function clampToWorld(x, cfg = DEFAULT) {
  const half = cfg.FLOOR.width / 2;
  return Math.min(Math.max(x, half), cfg.WORLD.width - half);
}

function addFloor(tower, x, cfg = DEFAULT) {
  const clamped = clampToWorld(x, cfg);
  const floor = { x: clamped, index: tower.floors.length };
  tower.floors.push(floor);
  tower.sumX += clamped;
  return floor;
}

function floorCount(tower) {
  return tower.floors.length;
}

/** 重心水平位置。空塔时退化为地基中心，使偏心为 0。 */
function centroidX(tower) {
  if (tower.floors.length === 0) return tower.foundationCenterX;
  return tower.sumX / tower.floors.length;
}

/**
 * 独立于增量累加器的朴素重心，仅用于测试与调试。
 * 若它与 centroidX 不一致，说明 sumX 的维护被写坏了。
 */
function centroidXByScan(tower) {
  if (tower.floors.length === 0) return tower.foundationCenterX;
  let sum = 0;
  for (let i = 0; i < tower.floors.length; i += 1) sum += tower.floors[i].x;
  return sum / tower.floors.length;
}

/** 偏心（带符号）：重心相对地基中心的水平位移，右为正。 */
function eccentricitySigned(tower) {
  return centroidX(tower) - tower.foundationCenterX;
}

/** 偏心（绝对值）：坍塌判定的唯一依据。 */
function eccentricity(tower) {
  return Math.abs(eccentricitySigned(tower));
}

/** 塔顶中心的水平位置。第一层尚未放下时即为地基中心。 */
function topCenterX(tower) {
  if (tower.floors.length === 0) return tower.foundationCenterX;
  return tower.floors[tower.floors.length - 1].x;
}

/** 塔顶的世界高度（第一层的底面位于 y = 0）。 */
function topY(tower, cfg = DEFAULT) {
  return tower.floors.length * cfg.FLOOR.height;
}

/**
 * 当前塔高下的偏心容忍上限。
 * 高塔收紧系数是刻意的手感补丁，理由见 config.js 里 STABILITY.topHeavyGain 的注释。
 */
function collapseThreshold(tower, cfg = DEFAULT) {
  const n = tower.floors.length;
  const heightFactor = 1 / (1 + Math.max(0, n - 1) * cfg.STABILITY.topHeavyGain);
  return tower.foundationHalfWidth * cfg.STABILITY.collapseRatio * heightFactor;
}

/** 稳定性占用比例：0 = 重心压正中，1 = 恰好抵达坍塌临界。HUD 的水准泡读数。 */
function stabilityUsed(tower, cfg = DEFAULT) {
  const threshold = collapseThreshold(tower, cfg);
  if (threshold <= 0) return 1;
  return eccentricity(tower) / threshold;
}

function isCollapsed(tower, cfg = DEFAULT) {
  return eccentricity(tower) > collapseThreshold(tower, cfg);
}

/** 派生量：整塔的视觉倾角（弧度，正为右倾）。高度越高倾角越小。 */
function leanAngle(tower, cfg = DEFAULT) {
  const h = Math.max(topY(tower, cfg), cfg.FLOOR.height);
  return Math.atan2(eccentricitySigned(tower), h);
}

/** 塔身像素高度，用于渲染与摄像机计算。 */
function pixelHeight(tower, cfg = DEFAULT) {
  return tower.floors.length * cfg.FLOOR.height;
}

/** 推进摇摆强度的衰减。只影响观感。 */
function advanceSway(tower, dt, cfg = DEFAULT) {
  const decay = cfg.STABILITY.swayDecayPerSec * dt;
  tower.sway = Math.max(0, tower.sway - decay);
  return tower.sway;
}

function bumpSway(tower, amount) {
  tower.sway = Math.min(1, tower.sway + amount);
  return tower.sway;
}

module.exports = {
  createTower,
  resetTower,
  addFloor,
  clampToWorld,
  floorCount,
  centroidX,
  centroidXByScan,
  eccentricity,
  eccentricitySigned,
  topCenterX,
  topY,
  pixelHeight,
  collapseThreshold,
  stabilityUsed,
  isCollapsed,
  leanAngle,
  advanceSway,
  bumpSway
};
