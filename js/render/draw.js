/**
 * 绘制工具。
 *
 * 小游戏的 Canvas 实现不保证有 ctx.roundRect（较新的标准 API），
 * 所以圆角矩形一律自己画，不依赖宿主实现。
 */

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, fill, stroke, lineWidth) {
  roundRectPath(ctx, x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = lineWidth === undefined ? 1 : lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function fillRect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

/**
 * 文字绘制。font 用「字号 + 字重」拼装，
 * family 交给宿主的默认字体，避免硬编码字体名在部分机型上回退成衬线体。
 */
function text(ctx, content, x, y, options) {
  const opt = options || {};
  ctx.font = `${opt.weight || 400} ${opt.size || 14}px sans-serif`;
  ctx.textAlign = opt.align || 'left';
  ctx.textBaseline = opt.baseline || 'alphabetic';
  if (opt.shadow) {
    ctx.fillStyle = opt.shadow;
    ctx.fillText(String(content), x + 1, y + 1);
  }
  ctx.fillStyle = opt.color || '#FFFFFF';
  ctx.fillText(String(content), x, y);
}

function measure(ctx, content, options) {
  const opt = options || {};
  ctx.font = `${opt.weight || 400} ${opt.size || 14}px sans-serif`;
  return ctx.measureText(String(content)).width;
}

/** 在给定宽度内居中绘制文字。 */
function textCentered(ctx, content, centerX, y, options) {
  text(ctx, content, centerX, y, Object.assign({}, options, { align: 'center' }));
}

/** 竖直线性渐变。 */
function verticalGradient(ctx, x, yTop, yBottom, stops) {
  const gradient = ctx.createLinearGradient(x, yTop, x, yBottom);
  stops.forEach((stop) => gradient.addColorStop(stop[0], stop[1]));
  return gradient;
}

/** 虚线。setLineDash 在部分宿主实现里可能缺失，缺失时退化为实线而不是报错。 */
function dashedLine(ctx, x1, y1, x2, y2, dash, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width === undefined ? 1 : width;
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** 把 0~1 的进度映射到 安全 -> 警告 -> 危险 三色。 */
function riskColor(palette, ratio) {
  if (ratio >= 0.8) return palette.hud.danger;
  if (ratio >= 0.55) return palette.hud.warn;
  return palette.hud.safe;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 0 -> 1 的平滑缓动。 */
function easeOutCubic(t) {
  const p = clamp(t, 0, 1);
  return 1 - Math.pow(1 - p, 3);
}

module.exports = {
  roundRectPath,
  fillRoundRect,
  fillRect,
  text,
  textCentered,
  measure,
  verticalGradient,
  dashedLine,
  riskColor,
  clamp,
  lerp,
  easeOutCubic
};
