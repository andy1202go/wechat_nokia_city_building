/**
 * 塔与楼层的绘制。
 *
 * 三个关键设计（见 docs/adr/0003 的 Consequences）：
 *   1. 每层楼按自己真实的绝对位置绘制，玩家能看见「我这一层偏在哪」——
 *      这是可学习性的唯一来源，也是否决「刚体整体倾斜」方案的理由。
 *   2. 整塔再按由偏心导出的倾角轻微旋转，作为「要倒了」的预警。
 *      倾角是派生量，不是独立状态，所以不会与判定脱节。
 *   3. 坍塌时在倾角之上再叠加一个**纯演出**的倒塌旋转（见 docs/adr/0005）。
 *      它来自表现层状态而非内核，因为内核的倾角是派生量、渲染层只读。
 *
 * 另外画一条地基中线：没有它，玩家无法理解塔为什么会倒。
 */
const towerCore = require('../core/tower');
const vpMod = require('./viewport');
const draw = require('./draw');
const presenterMod = require('./presenter');
const defaultPalette = require('./palette');

/** 地基中线：从地面向上穿到塔顶之上。颜色随稳定性占用比例从白变红。 */
function drawAxis(ctx, vp, run, cfg, pal) {
  const x = vpMod.worldX(vp, run.tower.foundationCenterX);
  const yTop = vpMod.worldY(vp, towerCore.topY(run.tower, cfg) + 46);
  const yBottom = vpMod.worldY(vp, 0);
  const ratio = towerCore.stabilityUsed(run.tower, cfg);
  const color = ratio >= 0.8 ? pal.axisDanger : pal.axis;

  draw.dashedLine(ctx, x, yTop, x, yBottom, [4, 5], color, 1);
}

/**
 * 视锥剔除：某一层是否可能出现在屏幕内。
 *
 * 必须先把世界坐标换算成屏幕坐标再判断。曾经这里直接拿局部坐标的
 * bottomY（= -(i * 层高)）去和屏幕高度比较 —— 局部 y 在地面之上恒为负，
 * 于是从第 3 层起全部满足 bottomY < -40 而被剔除，画面上只剩最底下两层。
 * 这个 bug 已由 tests/render.test.js 的「高塔楼层确实被绘制」钉住。
 */
function isFloorVisible(vp, index, cfg) {
  const bottomWorldY = index * cfg.FLOOR.height;
  const topWorldY = bottomWorldY + cfg.FLOOR.height;
  const screenTop = vpMod.worldY(vp, topWorldY);
  const screenBottom = vpMod.worldY(vp, bottomWorldY);
  return screenBottom >= -40 && screenTop <= vp.height + 40;
}

/** 单层楼：底色 + 窗格 + 完美落点的金色压顶。 */
function drawFloorBlock(ctx, x, y, w, h, index, floor, vp, cfg, pal, detailed) {
  const color = pal.building[index % pal.building.length];
  draw.fillRoundRect(ctx, x, y, w, h, cfg.FLOOR.radius * vp.scale, color, pal.buildingEdge, 1);

  if (detailed) {
    const cols = 4;
    const rows = 2;
    const padX = w * 0.1;
    const padY = h * 0.16;
    const gridW = (w - padX * 2) / cols;
    const gridH = (h - padY * 2) / rows;
    const winW = gridW * 0.62;
    const winH = gridH * 0.58;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const wx = x + padX + c * gridW + (gridW - winW) / 2;
        const wy = y + padY + r * gridH + (gridH - winH) / 2;
        const lit = (index * 7 + c * 3 + r * 5) % 5 === 0;
        draw.fillRect(ctx, wx, wy, winW, winH, lit ? pal.windowLit : pal.window);
      }
    }
  }

  if (floor && floor.verdict === 'perfect') {
    draw.fillRect(ctx, x + 2, y, Math.max(1, w - 4), Math.max(1.5, 2 * vp.scale), pal.perfectCap);
  }
}

function drawTower(ctx, vp, run, presenter, cfg, pal) {
  const tower = run.tower;
  const count = tower.floors.length;
  const scaledFloorW = cfg.FLOOR.width * vp.scale;
  const scaledFloorH = cfg.FLOOR.height * vp.scale;

  const originX = vpMod.worldX(vp, tower.foundationCenterX);
  const originY = vpMod.worldY(vp, 0);
  const lean = towerCore.leanAngle(tower, cfg) * cfg.VISUAL.leanVisualGain;
  // 倒向哪一侧：取自偏移心的符号，与判定同源。eccentricitySigned 为 0 时按 +x 侧处理
  const fallSign = towerCore.eccentricitySigned(tower) < 0 ? -1 : 1;
  const sweep = presenterMod.collapseTilt(presenter, cfg, fallSign);
  const swayPhase = presenter.t * Math.PI * 2 * cfg.VISUAL.swayHz;
  const sway = Math.sin(swayPhase) * cfg.VISUAL.swayAmplitude * tower.sway * vp.scale;

  ctx.save();
  ctx.translate(originX + sway, originY);

  if (sweep !== 0) {
    // 绕「倾倒侧的地基边缘」旋转，而不是绕中线：
    // 绕中线转会让塔身的一角扎进地面，看起来像整座塔陷下去，而不是倒下去。
    // 绕边缘转则是一侧抬起、另一侧始终贴地，才读得出「翻倒」。
    const pivotX = fallSign * (cfg.FOUNDATION.width / 2) * vp.scale;
    ctx.translate(pivotX, 0);
    ctx.rotate(sweep);
    ctx.translate(-pivotX, 0);
  }

  ctx.rotate(lean);

  // 地基
  const foundationW = cfg.FOUNDATION.width * vp.scale;
  const foundationH = cfg.FOUNDATION.height * vp.scale;
  const foundationX = -foundationW / 2;
  draw.fillRoundRect(ctx, foundationX, 0, foundationW, foundationH, 2 * vp.scale, pal.foundation.body, pal.foundation.edge, 1);
  draw.fillRect(ctx, foundationX, 0, foundationW, Math.max(1, 3 * vp.scale), pal.foundation.top);

  // 楼层：底层的底面贴在地面（y = 0），向上逐层堆叠
  for (let i = 0; i < count; i += 1) {
    const floor = tower.floors[i];
    if (!isFloorVisible(vp, i, cfg)) continue;

    const bottomY = -(i * scaledFloorH);
    const squash = presenterMod.squashScale(presenter, i, cfg);
    const h = scaledFloorH * squash;
    const x = (floor.x - tower.foundationCenterX) * vp.scale - scaledFloorW / 2;
    const y = bottomY - h;

    drawFloorBlock(ctx, x, y, scaledFloorW, h, i, floor, vp, cfg, pal, scaledFloorH >= 9);
  }

  ctx.restore();
}

module.exports = { drawTower, drawAxis, drawFloorBlock, isFloorVisible };
