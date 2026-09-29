/**
 * 覆盖层：新手引导、暂停面板、结算面板。
 *
 * 结算面板要把两个终局讲清楚 —— 「封顶」是机会用完了但塔还在，
 * 「坍塌」是重心偏出地基、塔倒了。这是 docs/adr/0004 的直接产物，
 * 文案必须让玩家能区分这两种失败，否则拆开两个终局就白拆了。
 */
const ENDING = require('../core/run').ENDING;
const draw = require('./draw');

const PANEL_MARGIN = 24;
const PANEL_MAX_W = 304;

function layout(vp, ui) {
  const width = Math.min(PANEL_MAX_W, vp.width - PANEL_MARGIN * 2);
  const x = (vp.width - width) / 2;
  const centerY = (vp.height + vp.safeTop - vp.safeBottom) / 2;

  const paused = ui && ui.paused;
  const ended = ui && ui.ended;

  // 终局优先于暂停：终局是本局的终态，结算面板必须露得出来 ——
  // 否则玩家看不到得分与「塔倒了 / 封顶」的区分。
  // 正常流程下两者不会同时成立（暂停时主循环不推进逻辑，走不到终局），
  // 这里显式固定优先级，与内核里「坍塌优先于封顶」的防御性判定同一个道理。
  if (ended) {
    const h = 348;
    const y = Math.max(vp.safeTop + 16, centerY - h / 2);
    return {
      kind: 'end',
      panel: { x, y, w: width, h },
      primary: { x: x + 22, y: y + h - 58, w: width - 44, h: 42 }
    };
  }

  if (paused) {
    const h = 178;
    const y = centerY - h / 2;
    return {
      kind: 'pause',
      panel: { x, y, w: width, h },
      primary: { x: x + 22, y: y + h - 62, w: width - 44, h: 40 },
      secondary: { x: x + 22, y: y + h - 112, w: width - 44, h: 38 }
    };
  }

  return { kind: null };
}

function hitTest(vp, x, y, ui) {
  const box = layout(vp, ui);
  if (!box.kind) return null;

  const inside = (rect) =>
    rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

  if (box.kind === 'pause') {
    if (inside(box.primary)) return 'resume';
    if (inside(box.secondary)) return 'restart';
    return null;
  }
  if (inside(box.primary)) return 'restart';
  return null;
}

function drawButton(ctx, box, label, pal, primary) {
  draw.fillRoundRect(
    ctx,
    box.x,
    box.y,
    box.w,
    box.h,
    11,
    primary ? pal.panel.primary : pal.panel.ghost,
    primary ? null : pal.panel.border,
    1
  );
  draw.text(ctx, label, box.x + box.w / 2, box.y + box.h / 2 + 5, {
    size: 15,
    weight: 500,
    align: 'center',
    color: primary ? pal.panel.primaryText : pal.panel.text
  });
}

/** 新手引导：只在开局前几层出现。 */
function drawHint(ctx, vp, run, presenter, cfg, pal) {
  if (!cfg.TUTORIAL.enabled) return;
  const floors = run.tower.floors.length;
  if (floors >= cfg.TUTORIAL.minFloorsToHide) return;
  if (run.phase === 'ended') return;

  const y = vp.height - vp.safeBottom - 64;
  const label = '点屏幕任意位置 投放楼层';
  const sub = '吊车会左右摆动，看准塔顶再松手';

  const w = Math.max(
    draw.measure(ctx, label, { size: 14, weight: 500 }),
    draw.measure(ctx, sub, { size: 11 })
  ) + 36;

  draw.fillRoundRect(ctx, (vp.width - w) / 2, y - 34, w, 56, 12, 'rgba(12, 26, 44, 0.62)', null);
  draw.text(ctx, label, vp.width / 2, y - 11, {
    size: 14,
    weight: 500,
    align: 'center',
    color: pal.panel.text
  });
  draw.text(ctx, sub, vp.width / 2, y + 10, {
    size: 11,
    align: 'center',
    color: pal.panel.dim
  });
}

function drawPausePanel(ctx, vp, box, ui, pal) {
  draw.fillRect(ctx, 0, 0, vp.width, vp.height, 'rgba(6, 14, 26, 0.55)');

  draw.fillRoundRect(ctx, box.panel.x, box.panel.y, box.panel.w, box.panel.h, 16, pal.panel.bg, pal.panel.border, 1);
  draw.text(ctx, '已暂停', vp.width / 2, box.panel.y + 42, {
    size: 19,
    weight: 500,
    align: 'center',
    color: pal.panel.text
  });
  draw.text(ctx, `当前高度 ${ui.floors} 层　人口 ${ui.population}`, vp.width / 2, box.panel.y + 68, {
    size: 12,
    align: 'center',
    color: pal.panel.dim
  });

  drawButton(ctx, box.secondary, '重新开始', pal, false);
  drawButton(ctx, box.primary, '继续建造', pal, true);
}

function endingCopy(ending) {
  if (ending === ENDING.COLLAPSED) {
    return {
      title: '塔倒了',
      body: '重心偏出地基，整座塔撑不住了。',
      accent: '#FF6B5C'
    };
  }
  return {
    title: '封顶',
    body: '机会用完了，大楼就此封顶 —— 塔还站着。',
    accent: '#F2C14E'
  };
}

function drawEndPanel(ctx, vp, box, ui, pal) {
  draw.fillRect(ctx, 0, 0, vp.width, vp.height, 'rgba(6, 14, 26, 0.62)');

  const panel = box.panel;
  draw.fillRoundRect(ctx, panel.x, panel.y, panel.w, panel.h, 16, pal.panel.bg, pal.panel.border, 1);

  const copy = endingCopy(ui.ending);
  const cx = vp.width / 2;

  draw.text(ctx, copy.title, cx, panel.y + 46, {
    size: 26,
    weight: 500,
    align: 'center',
    color: copy.accent
  });
  draw.text(ctx, copy.body, cx, panel.y + 72, {
    size: 12,
    align: 'center',
    color: pal.panel.dim
  });

  // 得分
  draw.text(ctx, String(ui.score), cx, panel.y + 132, {
    size: 40,
    weight: 500,
    align: 'center',
    color: pal.panel.text
  });
  draw.text(ctx, '本局得分', cx, panel.y + 152, {
    size: 11,
    align: 'center',
    color: pal.panel.dim
  });

  // 明细
  const rows = [
    ['高度', `${ui.floors} 层`],
    ['最佳连击', `x${ui.comboBest}`],
    ['人口', String(ui.population)]
  ];
  const rowTop = panel.y + 180;
  rows.forEach((row, index) => {
    const y = rowTop + index * 26;
    draw.text(ctx, row[0], panel.x + 26, y, { size: 13, color: pal.panel.dim });
    draw.text(ctx, row[1], panel.x + panel.w - 26, y, {
      size: 13,
      weight: 500,
      align: 'right',
      color: pal.panel.text
    });
  });

  // 最高分
  const bestLabel = ui.isNewBest ? '新纪录！' : `最高分 ${ui.bestScore}`;
  draw.text(ctx, bestLabel, cx, panel.y + panel.h - 74, {
    size: 12,
    weight: ui.isNewBest ? 500 : 400,
    align: 'center',
    color: ui.isNewBest ? pal.panel.primary : pal.panel.dim
  });

  drawButton(ctx, box.primary, '再来一局', pal, true);
}

function drawOverlay(ctx, vp, run, presenter, cfg, pal, ui) {
  const box = layout(vp, ui);

  if (box.kind === 'pause') {
    drawPausePanel(ctx, vp, box, ui, pal);
    return;
  }
  if (box.kind === 'end') {
    // 渐入
    const progress = draw.easeOutCubic(presenter.endReveal);
    ctx.save();
    ctx.globalAlpha = progress;
    ctx.translate(0, (1 - progress) * 18);
    drawEndPanel(ctx, vp, box, ui, pal);
    ctx.restore();
    return;
  }

  drawHint(ctx, vp, run, presenter, cfg, pal);
}

module.exports = { drawOverlay, layout, hitTest, endingCopy };
