/**
 * 视口与摄像机。
 *
 * 坐标系：世界宽度固定 WORLD.width，高度按设备长宽比自适应；世界 y 向上为正、地面为 0。
 * 换算：scale = 画布逻辑宽度 / WORLD.width，所以世界 x 直接乘 scale 就是屏幕 x。
 *
 * 摄像机：camY 表示「屏幕底边对应的世界 y」。塔长高时 camY 上升，画面自然跟着上移。
 * 目标位置让「塔顶 + 吊车几何 + 留白」落在屏幕纵向 (1 - followRatio) 处。
 */
const DEFAULT = require('../core/config');
const towerCore = require('../core/tower');

function createViewport(metrics, cfg = DEFAULT) {
  return {
    scale: metrics.width / cfg.WORLD.width,
    width: metrics.width,
    height: metrics.height,
    safeTop: metrics.safeTop || 0,
    safeBottom: metrics.safeBottom || 0,
    camY: cfg.WORLD.groundBaselineOffset
  };
}

/** 世界 x -> 屏幕 x（单位：逻辑像素） */
function worldX(vp, x) {
  return x * vp.scale;
}

/** 世界 y -> 屏幕 y（单位：逻辑像素，向下为正） */
function worldY(vp, y) {
  return vp.height - (y - vp.camY) * vp.scale;
}

function screenXToWorld(vp, sx) {
  return sx / vp.scale;
}

/** 当前屏幕上可见的世界高度。 */
function visibleWorldHeight(vp) {
  return vp.height / vp.scale;
}

/** 摄像机在给定局面下的目标 camY。 */
function cameraTarget(vp, run, cfg = DEFAULT) {
  const topY = towerCore.topY(run.tower, cfg);
  const needTop = topY + cfg.CRANE.pivotHeightAboveTop + cfg.CAMERA.topPadding;
  const target = needTop - visibleWorldHeight(vp) * cfg.CAMERA.followRatio;
  return Math.max(cfg.WORLD.groundBaselineOffset, target);
}

/** 指数逼近地推进摄像机，dt 变化时保持一致的收敛速度。 */
function updateCamera(vp, run, cfg, dt) {
  const target = cameraTarget(vp, run, cfg);
  const k = 1 - Math.exp(-cfg.WORLD.cameraLerpRate * dt);
  vp.camY += (target - vp.camY) * k;
  return vp.camY;
}

/** 立即对齐摄像机目标，用于重开一局时避免镜头从上一局的位置滑过来。 */
function snapCamera(vp, run, cfg = DEFAULT) {
  vp.camY = cameraTarget(vp, run, cfg);
  return vp.camY;
}

module.exports = {
  createViewport,
  worldX,
  worldY,
  screenXToWorld,
  visibleWorldHeight,
  cameraTarget,
  updateCamera,
  snapCamera
};
