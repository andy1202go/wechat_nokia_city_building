/**
 * 吊车与悬吊中的楼层的绘制。
 *
 * 画的是真正的钟摆：吊点在塔顶上方固定，吊绳按 crane.pendulumAngle 倾斜，
 * 楼层挂在绳端。摆角与水平位置由内核同一份几何解出，所以视觉和判定永远不会脱节。
 *
 * 顶部一条横向轨道暗示是门式吊车，避免在画面中央立一根挡住塔的立柱。
 * 轨道这一版做成了**钢梁**：顶面受光、底面暗线、中间一排桁架竖杆 ——
 * 原来那条 7px 纯色横线在天空上像一道栏杆，是画面里最突兀的元素。
 *
 * 悬吊中的楼层直接复用 towerView.drawFloorBlock，外观与塔上的楼层完全一致。
 */
const craneCore = require('../core/crane');
const towerCore = require('../core/tower');
const vpMod = require('./viewport');
const draw = require('./draw');
const towerView = require('./towerView');

const TAU = Math.PI * 2;
const RAIL_H = 11;
const TROLLEY_W = 26;
const TROLLEY_H = 13;

/** 钢梁轨道：受光顶面 + 主体 + 底面暗线 + 桁架竖杆。 */
function drawRail(ctx, vp, railY, pal) {
  const top = railY - RAIL_H / 2;
  const lightH = Math.max(1, 2 * vp.scale);
  const edgeH = Math.max(1, 1.5 * vp.scale);

  draw.fillRect(ctx, 0, top, vp.width, RAIL_H, pal.crane.rail);
  draw.fillRect(ctx, 0, top, vp.width, lightH, pal.crane.railLight);
  draw.fillRect(ctx, 0, top + RAIL_H - edgeH, vp.width, edgeH, pal.crane.railEdge);

  // 桁架竖杆：让钢梁读起来是「有结构的」，而不是一块色条
  const step = 26;
  const barW = Math.max(1, 1.5 * vp.scale);
  for (let x = step / 2; x < vp.width; x += step) {
    draw.fillRect(ctx, x, top + lightH + 1, barW, RAIL_H - lightH - edgeH - 2, pal.crane.railEdge);
  }
}

/** 轨道小车：车身 + 两侧滚轮。 */
function drawTrolley(ctx, cx, railY, vp, pal) {
  const x = cx - TROLLEY_W / 2;
  const y = railY - TROLLEY_H / 2;

  draw.fillRoundRect(ctx, x, y, TROLLEY_W, TROLLEY_H, 3, pal.crane.trolley, pal.crane.railEdge, 1);
  draw.fillRect(ctx, x + 2, y + 1, TROLLEY_W - 4, Math.max(1, 1.2 * vp.scale), pal.crane.railLight);

  const wheelR = Math.max(1.5, 2.2 * vp.scale);
  ctx.fillStyle = pal.crane.hook;
  for (const wx of [x + 4, x + TROLLEY_W - 4]) {
    ctx.beginPath();
    ctx.arc(wx, y + TROLLEY_H - wheelR * 0.4, wheelR, 0, TAU);
    ctx.fill();
  }
}

/** 吊钩：一段竖杆 + 一个环。比原来的小方块更能读出「吊着东西」。 */
function drawHook(ctx, cx, topY, vp, pal) {
  const scale = vp.scale;
  const ringR = Math.max(2, 3 * scale);
  const stemTop = topY - ringR * 2.4;

  ctx.save();
  ctx.strokeStyle = pal.crane.hook;
  ctx.lineWidth = Math.max(1.4, 1.8 * scale);
  ctx.beginPath();
  ctx.moveTo(cx, stemTop);
  ctx.lineTo(cx, topY - ringR);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, topY - ringR * 0.2, ringR, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

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

  drawRail(ctx, vp, railY, pal);

  // 吊绳：只在悬吊时存在，释放后收回
  if (holding) {
    const hookY = blockBottomY - floorH;
    ctx.save();
    ctx.strokeStyle = pal.crane.rope;
    ctx.lineWidth = Math.max(1.2, 2 * vp.scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotScreenX, railY);
    ctx.lineTo(blockX, hookY - Math.max(1.4, 1.8 * vp.scale) * 2.4);
    ctx.stroke();
    ctx.restore();

    drawHook(ctx, blockX, hookY, vp, pal);
  }

  drawTrolley(ctx, pivotScreenX, railY, vp, pal);

  // 悬吊中的楼层：与塔上的楼层用同一套画法，配色索引取「将要是第几层」，保证连贯
  const blockIndex = floorCount;
  towerView.drawFloorBlock(
    ctx,
    blockX - floorW / 2,
    blockBottomY - floorH,
    floorW,
    floorH,
    blockIndex,
    null,
    vp,
    cfg,
    pal,
    floorH >= 9
  );
}

module.exports = { drawCrane, drawRail, drawTrolley, drawHook };
