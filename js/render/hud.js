/**
 * HUD：高度、人口、失误额度、连击、以及「水准泡」。
 *
 * 水准泡不是装饰。docs/adr/0003 的 Consequences 里明确要求把偏心显性化 ——
 * 偏心是坍塌的唯一依据，如果玩家看不见它，就无法理解塔为什么倒，
 * 手感会变成「随机死亡」。这是整个 UI 里最重要的一块。
 */
const towerCore = require('../core/tower');
const draw = require('./draw');

const MARGIN = 14;
const LEVEL_LABEL_W = 34;

/** 各元件的屏幕布点。绘制与点击命中都用这一份，避免两处漂移。 */
function layout(vp) {
  const top = vp.safeTop + 8;
  const pillW = 124;
  const pauseSize = 34;
  const levelX = MARGIN + LEVEL_LABEL_W;
  const levelW = vp.width - levelX - MARGIN;
  const missDots = 3;
  const dotR = 6;
  const dotGap = 7;
  const missW = missDots * dotR * 2 + (missDots - 1) * dotGap;

  return {
    top,
    pill: { x: MARGIN, y: top, w: pillW, h: 42 },
    pause: { x: vp.width - MARGIN - pauseSize, y: top + 4, w: pauseSize, h: pauseSize },
    miss: {
      x: vp.width - MARGIN - missW,
      y: top + 42,
      dotR,
      dotGap,
      count: missDots
    },
    level: { x: levelX, y: top + 50, w: levelW, h: 11 },
    combo: { x: vp.width / 2, y: top + 78 }
  };
}

function hitTest(vp, x, y) {
  const box = layout(vp).pause;
  if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return 'pause';
  return null;
}

/** 暂停按钮：圆角方块 + 两条竖杠。 */
function drawPauseButton(ctx, box, pal) {
  draw.fillRoundRect(ctx, box.x, box.y, box.w, box.h, 9, pal.hud.bg, null);
  const barW = 3.5;
  const barH = 13;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  draw.fillRect(ctx, cx - 5.5, cy - barH / 2, barW, barH, pal.hud.text);
  draw.fillRect(ctx, cx + 2, cy - barH / 2, barW, barH, pal.hud.text);
}

/** 高度与人口。 */
function drawStats(ctx, box, run, pal) {
  draw.fillRoundRect(ctx, box.x, box.y, box.w, box.h, 10, pal.hud.bg, null);

  const height = towerCore.floorCount(run.tower);
  const labelX = box.x + 11;
  const midY = box.y + box.h / 2;

  draw.text(ctx, String(height), labelX, midY + 7, {
    size: 22,
    weight: 500,
    color: pal.hud.text
  });
  const digitW = draw.measure(ctx, String(height), { size: 22, weight: 500 });
  draw.text(ctx, '层', labelX + digitW + 4, midY + 7, {
    size: 12,
    color: pal.hud.dim
  });

  draw.text(ctx, `人口 ${populationOf(run)}`, box.x + box.w - 11, midY + 7, {
    size: 12,
    align: 'right',
    color: pal.hud.dim
  });
}

function populationOf(run) {
  return Math.floor(run.population || 0);
}

/** 失误额度：剩余为实心，已用为空心。剩最后一个时变红。 */
function drawMissBudget(ctx, spec, run, cfg, pal) {
  const remaining = Math.max(0, run.missBudget);
  const total = cfg.RUN.missBudget;
  const color = remaining <= 1 ? pal.hud.danger : pal.hud.safe;

  for (let i = 0; i < total; i += 1) {
    const cx = spec.x + spec.dotR + i * (spec.dotR * 2 + spec.dotGap);
    const cy = spec.y + spec.dotR;
    const filled = i < remaining;

    ctx.beginPath();
    ctx.arc(cx, cy, spec.dotR, 0, Math.PI * 2);
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = pal.hud.track;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  draw.text(ctx, '机会', spec.x - 6, spec.y + spec.dotR + 4, {
    size: 11,
    align: 'right',
    color: pal.hud.dim
  });
}

/** 水准泡：偏心指示器。左负右正，离中心越远越危险。 */
function drawLevel(ctx, box, run, cfg, pal) {
  const centerX = box.x + box.w / 2;
  const threshold = towerCore.collapseThreshold(run.tower, cfg);
  const signed = towerCore.eccentricitySigned(run.tower);
  const ratio = towerCore.stabilityUsed(run.tower, cfg);
  const normalized = threshold > 0 ? Math.min(1, Math.max(-1, signed / threshold)) : 0;
  const span = box.w / 2 - 7;

  draw.text(ctx, '重心', box.x - LEVEL_LABEL_W + 2, box.y + box.h - 1, {
    size: 11,
    color: pal.hud.dim
  });

  // 深色衬底：白天主题的天空很亮，纯白轨道会糊在里面看不见
  draw.fillRoundRect(ctx, box.x - 2, box.y - 2, box.w + 4, box.h + 4,
    (box.h + 4) / 2, pal.hud.bg, null);

  // 轨道
  draw.fillRoundRect(ctx, box.x, box.y, box.w, box.h, box.h / 2, pal.hud.track, null);

  // 偏离部分：从中点填到当前位置，颜色随风险升级
  const markerX = centerX + normalized * span;
  const barX = Math.min(centerX, markerX);
  const barW = Math.abs(markerX - centerX);
  if (barW > 1) {
    draw.fillRoundRect(ctx, barX, box.y + 2, barW, box.h - 4, (box.h - 4) / 2, draw.riskColor(pal, ratio), null);
  }

  // 中点刻度
  draw.fillRect(ctx, centerX - 0.75, box.y - 3, 1.5, box.h + 6, pal.hud.dim);

  // 当前位置的滑块
  const sliderW = 5;
  draw.fillRoundRect(
    ctx,
    markerX - sliderW / 2,
    box.y - 4,
    sliderW,
    box.h + 8,
    2.5,
    pal.hud.text,
    null
  );
}

/** 连击徽章：只在连击激活（>= 2）时出现，带一次弹跳。 */
function drawCombo(ctx, spot, run, presenter, pal) {
  const combo = run.combo;
  if (combo.count < 2) return;

  const pop = presenter.comboPop > 0 ? 1 + presenter.comboPop * 0.9 : 1;
  const label = `连击 x${combo.count}`;
  const w = draw.measure(ctx, label, { size: 13, weight: 500 }) + 22;
  const h = 24;
  const x = spot.x - (w * pop) / 2;
  const y = spot.y + (h - h * pop) / 2;

  ctx.save();
  ctx.translate(spot.x, spot.y + h / 2);
  ctx.scale(pop, pop);
  ctx.translate(-spot.x, -(spot.y + h / 2));

  const boxX = spot.x - w / 2;
  // 加一道金边：连击是正反馈，值得比普通信息更「亮」一点
  draw.fillRoundRect(ctx, boxX, spot.y, w, h, h / 2, 'rgba(12, 26, 44, 0.72)', pal.hud.accent, 1.2);
  draw.text(ctx, label, spot.x, spot.y + 17, {
    size: 13,
    weight: 500,
    align: 'center',
    color: pal.hud.accent
  });
  ctx.restore();
}

function drawHud(ctx, vp, run, presenter, cfg, pal) {
  const box = layout(vp);
  drawPauseButton(ctx, box.pause, pal);
  drawStats(ctx, box.pill, run, pal);
  drawMissBudget(ctx, box.miss, run, cfg, pal);
  drawLevel(ctx, box.level, run, cfg, pal);
  drawCombo(ctx, box.combo, run, presenter, pal);
}

module.exports = { drawHud, layout, hitTest };
