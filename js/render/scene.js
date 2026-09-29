/**
 * 场景：天空、远景城市剪影、地面。
 *
 * 剪影用确定性伪随机生成一次（种子固定），之后只做视差位移 ——
 * 这样每次启动的城市轮廓一致，且不需要任何图片资源。
 *
 * 视差：摄像机升高时，远景比地面走得慢，形成纵深。factor 越大跟得越慢。
 */
const palette = require('./palette');
const draw = require('./draw');
const vpMod = require('./viewport');

const PARALLAX_FAR = 0.88;
const PARALLAX_NEAR = 0.72;

function makeRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 生成一层楼群剪影：{x, w, h} 数组，单位为世界单位。 */
function buildLayer(seed, worldWidth, minW, maxW, minH, maxH) {
  const rand = makeRandom(seed);
  const blocks = [];
  let cursor = -60;
  const limit = worldWidth + 60;

  while (cursor < limit) {
    const w = minW + rand() * (maxW - minW);
    // 越靠中间的楼略高，形成自然的城市天际线
    const centerBias = 1 - Math.abs(cursor + w / 2 - worldWidth / 2) / (worldWidth / 2);
    const h = minH + rand() * (maxH - minH) * (0.55 + 0.45 * centerBias);
    blocks.push({ x: cursor, w, h });
    cursor += w + 3 + rand() * 9;
  }
  return blocks;
}

function createScene(cfg, seed) {
  const base = seed === undefined ? 20260929 : seed;
  return {
    far: buildLayer(base, cfg.WORLD.width, 16, 44, 22, 62),
    near: buildLayer(base + 977, cfg.WORLD.width, 22, 56, 34, 96)
  };
}

/** 天空渐变铺满整个画面。 */
function drawSky(ctx, vp, palette) {
  const gradient = draw.verticalGradient(ctx, 0, 0, vp.height, [
    [0, palette.sky.top],
    [0.52, palette.sky.mid],
    [1, palette.sky.bottom]
  ]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, vp.width, vp.height);
}

function drawLayer(ctx, vp, blocks, baseY, color, cfg) {
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
}

/** 地面：草地带 + 深色分界线。 */
function drawGround(ctx, vp, groundScreenY, palette) {
  if (groundScreenY > vp.height) return;

  const top = Math.max(0, groundScreenY);
  const gradient = draw.verticalGradient(ctx, 0, top, vp.height, [
    [0, palette.ground.top],
    [1, palette.ground.bottom]
  ]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, top, vp.width, vp.height - top);
  draw.fillRect(ctx, 0, top, vp.width, Math.max(1, 1.5 * vp.scale), palette.ground.edge);
}

/** 地平线层：远景剪影 + 地面。与天空分开是为了让画面抖动时天空仍铺满整个屏幕。 */
function drawHorizon(ctx, vp, scene, cfg, pal) {
  const groundScreenY = vpMod.worldY(vp, 0);
  const rise = (vp.camY - cfg.WORLD.groundBaselineOffset) * vp.scale;

  drawLayer(ctx, vp, scene.far, groundScreenY - rise * PARALLAX_FAR, pal.skyline.far, cfg);
  drawLayer(ctx, vp, scene.near, groundScreenY - rise * PARALLAX_NEAR, pal.skyline.near, cfg);
  drawGround(ctx, vp, groundScreenY, pal);
}

function drawScene(ctx, vp, scene, cfg, colors) {
  const pal = colors || palette;
  drawSky(ctx, vp, pal);
  drawHorizon(ctx, vp, scene, cfg, pal);
}

module.exports = { createScene, drawScene, drawSky, drawHorizon, drawGround, buildLayer };
