/**
 * 场景：天空、远景城市、地面。
 *
 * 剪影用确定性伪随机生成一次（种子固定），之后只做视差位移 ——
 * 这样每次启动的城市轮廓一致，且不需要任何图片资源。
 *
 * 三层纵深是这一版的重点。城市的「远」不能只靠大小，还要靠**大气透视**：
 * 越远的楼越淡、越偏天空的颜色，越近的越实、越暗。只有一层剪影时，
 * 城市看起来像贴在天空上的一张纸片。
 *
 * 视差：摄像机升高时，远景比地面走得慢，形成纵深。factor 越大跟得越慢。
 */
const palette = require('./palette');
const draw = require('./draw');
const vpMod = require('./viewport');
const skyMod = require('./sky');

const PARALLAX = { far: 0.90, mid: 0.81, near: 0.72 };

function makeRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 生成一层楼群剪影：{x, w, h, windows} 数组，单位为世界单位。
 *
 * windows 只在主题要求时才生成（夜间/黄昏），且限制行列上限 ——
 * 城市是每帧重画的背景，窗灯用一次 path 批量填充，数量必须可控。
 */
function buildLayer(seed, worldWidth, minW, maxW, minH, maxH, windowSpec) {
  const rand = makeRandom(seed);
  const blocks = [];
  let cursor = -60;
  const limit = worldWidth + 60;

  while (cursor < limit) {
    const w = minW + rand() * (maxW - minW);
    // 越靠中间的楼略高，形成自然的城市天际线
    const centerBias = 1 - Math.abs(cursor + w / 2 - worldWidth / 2) / (worldWidth / 2);
    const h = minH + rand() * (maxH - minH) * (0.55 + 0.45 * centerBias);

    const block = { x: cursor, w, h };

    if (windowSpec) {
      const cols = Math.max(1, Math.min(8, Math.floor(w / 6)));
      const rows = Math.max(1, Math.min(10, Math.floor(h / 8)));
      const cellW = w / cols;
      const cellH = h / rows;
      const lit = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (rand() < windowSpec.ratio) {
            lit.push({
              x: cursor + c * cellW + cellW * 0.22,
              y: r * cellH + cellH * 0.24,
              w: cellW * 0.56,
              h: cellH * 0.42
            });
          }
        }
      }
      block.windows = lit;
      block.cellH = cellH;
    }

    blocks.push(block);
    cursor += w + 3 + rand() * 9;
  }
  return blocks;
}

function createScene(cfg, seed, pal) {
  const theme = pal || palette;
  const base = seed === undefined ? 20260929 : seed;
  const w = cfg.WORLD.width;

  return {
    // 远处楼房密集但矮小，近处少而高大
    far: buildLayer(base, w, 14, 36, 18, 50, null),
    mid: buildLayer(base + 977, w, 18, 46, 26, 72, theme.skyline.windows),
    near: buildLayer(base + 1543, w, 24, 60, 34, 96, theme.skyline.windows),
    sky: skyMod.createSky(cfg, base + 4441, theme)
  };
}

/** 天空：渐变铺满 -> 星辰 -> 天体 -> 云。顺序即层次，由远及近。 */
function drawSky(ctx, vp, scene, cfg, pal) {
  const theme = pal || palette;
  const stops = theme.sky.stops || [
    [0, theme.sky.top], [0.52, theme.sky.mid], [1, theme.sky.bottom]
  ];

  const gradient = draw.verticalGradient(ctx, 0, 0, vp.height, stops);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, vp.width, vp.height);

  if (!scene || !scene.sky) return;

  const rise = Math.max(0, vp.camY - cfg.WORLD.groundBaselineOffset) * vp.scale;
  skyMod.drawStars(ctx, vp, scene.sky, theme, rise);
  skyMod.drawCelestial(ctx, vp, theme);
  skyMod.drawClouds(ctx, vp, scene.sky, theme, cfg, rise);
}

/** 楼群剪影 + 窗灯。窗灯合并成一条 path 一次填充，避免上百次 fillRect。 */
function drawLayer(ctx, vp, blocks, baseY, color, cfg, windowSpec, scaleHint) {
  if (baseY < -200 || baseY > vp.height + 200) return;

  ctx.fillStyle = color;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const x = vpMod.worldX(vp, block.x);
    const w = block.w * vp.scale;
    if (x > vp.width + 40 || x + w < -40) continue;
    const h = block.h * vp.scale;
    ctx.fillRect(x, baseY - h, w, h);
  }

  if (!windowSpec) return;

  ctx.save();
  ctx.fillStyle = windowSpec.color;
  ctx.beginPath();
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block.windows || !block.windows.length) continue;
    const x = vpMod.worldX(vp, block.x);
    const w = block.w * vp.scale;
    if (x > vp.width + 40 || x + w < -40) continue;
    const h = block.h * vp.scale;

    for (let k = 0; k < block.windows.length; k += 1) {
      const win = block.windows[k];
      // 窗口坐标以「楼底向上」记，换算到屏幕要翻过来
      const wy = baseY - h + (block.h - win.y - win.h) * vp.scale;
      ctx.rect(x + win.x * vp.scale, wy, Math.max(1, win.w * vp.scale), Math.max(1, win.h * vp.scale));
    }
  }
  ctx.fill();
  ctx.restore();
}

/** 地面：草地/铺装带 + 深色分界线。 */
function drawGround(ctx, vp, groundScreenY, theme) {
  if (groundScreenY > vp.height) return;

  const top = Math.max(0, groundScreenY);
  const gradient = draw.verticalGradient(ctx, 0, top, vp.height, [
    [0, theme.ground.top],
    [1, theme.ground.bottom]
  ]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, top, vp.width, vp.height - top);
  draw.fillRect(ctx, 0, top, vp.width, Math.max(1, 1.5 * vp.scale), theme.ground.edge);
}

/** 地平线层：三层城市 + 地面。与天空分开是为了让画面抖动时天空仍铺满整个屏幕。 */
function drawHorizon(ctx, vp, scene, cfg, pal) {
  const theme = pal || palette;
  const groundScreenY = vpMod.worldY(vp, 0);
  const rise = (vp.camY - cfg.WORLD.groundBaselineOffset) * vp.scale;

  drawLayer(ctx, vp, scene.far, groundScreenY - rise * PARALLAX.far, theme.skyline.far, cfg, null);
  drawLayer(ctx, vp, scene.mid, groundScreenY - rise * PARALLAX.mid, theme.skyline.mid, cfg, null);
  drawLayer(ctx, vp, scene.near, groundScreenY - rise * PARALLAX.near,
    theme.skyline.near, cfg, theme.skyline.windows);
  drawGround(ctx, vp, groundScreenY, theme);
}

function drawScene(ctx, vp, scene, cfg, colors) {
  const pal = colors || palette;
  drawSky(ctx, vp, scene, cfg, pal);
  drawHorizon(ctx, vp, scene, cfg, pal);
}

module.exports = {
  createScene,
  drawScene,
  drawSky,
  drawHorizon,
  drawGround,
  drawLayer,
  buildLayer,
  PARALLAX
};
