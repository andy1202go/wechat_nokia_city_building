/**
 * 渲染总装。
 *
 * 绘制顺序：天空（不参与抖动）-> [抖动层] 地平线 / 地基中线 / 塔 / 吊车 -> HUD -> 覆盖层。
 * 天空单独先铺满，是为了画面抖动时边缘不会露出未绘制区域。
 */
const sceneMod = require('./scene');
const towerView = require('./towerView');
const craneView = require('./craneView');
const hud = require('./hud');
const overlay = require('./overlay');
const presenterMod = require('./presenter');
const defaultPalette = require('./palette');

function render(ctx, run, vp, presenter, scene, cfg, ui, pal) {
  const colors = pal || defaultPalette;

  ctx.clearRect(0, 0, vp.width, vp.height);
  sceneMod.drawSky(ctx, vp, colors);

  const shake = presenterMod.shakeOffset(presenter, cfg);
  ctx.save();
  ctx.translate(shake.x, shake.y);

  sceneMod.drawHorizon(ctx, vp, scene, cfg, colors);
  towerView.drawAxis(ctx, vp, run, cfg, colors);
  towerView.drawTower(ctx, vp, run, presenter, cfg, colors);
  craneView.drawCrane(ctx, vp, run, cfg, colors);

  ctx.restore();

  hud.drawHud(ctx, vp, run, presenter, cfg, colors);
  overlay.drawOverlay(ctx, vp, run, presenter, cfg, colors, ui);

  return ctx;
}

module.exports = { render };
