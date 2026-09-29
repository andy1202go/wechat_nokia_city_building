/**
 * 吊车与楼层的绘制。
 *
 * 画的是真正的钟摆：吊点在塔顶上方固定，吊绳按 crane.pendulumAngle 倾斜，
 * 楼层挂在绳端。摆角与水平位置由内核同一份几何解出，所以视觉和判定永远不会脱节。
 *
 * 顶部一条横向轨道暗示是门式吊车，避免在画面中央立一根挡住塔的立柱。
 */
const craneCore = require('../core/crane');
const towerCore = require('../core/tower');
const vpMod = require('./viewport');
const draw = require('./draw');

const RAIL_THICKNESS = 7;
const RAIL_EDGE = 2;
const TROLLEY_W = 24;
const TROLLEY_H = 13;

function drawCrane(ctx, vp, run, cfg, pal) {
  const crane = run.crane;
  const floorCount = towerCore.floorCount(run.tower);
  const towerTopY = towerCore.topY(run.tower, cfg);

  const pivotScreenX = vpMod.worldX(vp, cfg.CRANE.centerX);
  const railY = vpMod.worldY(vp, craneCore.pivotY(towerTopY, cfg));

  const drop = crane.drop;
  const holding = !drop;

  const blockWorldX = holding ? craneCore.craneX(crane, floorCount, cfg) : drop.x;
  const blockWorldBottomY = holding
    ? craneCore.blockBottomYAt(crane.t, floorCount, towerTopY, cfg)
    : drop.y;

  const blockX = vpMod.worldX(vp, blockWorldX);
  const blockBottomY = vpMod.worldY(vp, blockWorldBottomY);
  const floorW = cfg.FLOOR.width * vp.scale;
  // 下落中的楼层被速度拉长一点，手感更「重」
  const stretch = holding ? 1 : 1 + Math.min(0.3, drop.vy / 2600);
  const floorH = cfg.FLOOR.height * vp.scale * stretch;

  // 顶部轨道
  draw.fillRect(ctx, 0, railY - RAIL_THICKNESS / 2, vp.width, RAIL_THICKNESS, pal.crane.rail);
  draw.fillRect(ctx, 0, railY + RAIL_THICKNESS / 2, vp.width, RAIL_EDGE, pal.crane.railEdge);

  // 吊绳：只在悬吊时存在，释放后收回
  if (holding) {
    const hookY = blockBottomY - floorH;
    ctx.save();
    ctx.strokeStyle = pal.crane.rope;
    ctx.lineWidth = Math.max(1, 1.6 * vp.scale);
    ctx.beginPath();
    ctx.moveTo(pivotScreenX, railY);
    ctx.lineTo(blockX, hookY);
    ctx.stroke();
    ctx.restore();

    draw.fillRect(ctx, blockX - 3, hookY - 2, 6, 5, pal.crane.hook);
  }

  // 轨道小车
  draw.fillRoundRect(
    ctx,
    pivotScreenX - TROLLEY_W / 2,
    railY - TROLLEY_H / 2,
    TROLLEY_W,
    TROLLEY_H,
    3,
    pal.crane.trolley,
    pal.crane.railEdge,
    1
  );

  // 楼层本体（用与塔一致的外观，索引取「将要是第几层」，保证配色连贯）
  const blockIndex = floorCount;
  const color = pal.building[blockIndex % pal.building.length];
  const x = blockX - floorW / 2;
  const y = blockBottomY - floorH;

  draw.fillRoundRect(ctx, x, y, floorW, floorH, cfg.FLOOR.radius * vp.scale, color, pal.buildingEdge, 1);

  if (floorH >= 9) {
    const cols = 4;
    const rows = 2;
    const padX = floorW * 0.1;
    const padY = floorH * 0.16;
    const gridW = (floorW - padX * 2) / cols;
    const gridH = (floorH - padY * 2) / rows;
    const winW = gridW * 0.62;
    const winH = gridH * 0.58;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const wx = x + padX + c * gridW + (gridW - winW) / 2;
        const wy = y + padY + r * gridH + (gridH - winH) / 2;
        const lit = (blockIndex * 7 + c * 3 + r * 5) % 5 === 0;
        draw.fillRect(ctx, wx, wy, winW, winH, lit ? pal.windowLit : pal.window);
      }
    }
  }
}

module.exports = { drawCrane };
