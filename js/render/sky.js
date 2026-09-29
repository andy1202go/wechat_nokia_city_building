/**
 * 天空元素：天体、光晕、云层、星辰。
 *
 * 竖屏里天空约占 65% 画面，所以它必须是有内容的舞台，而不是一段纯渐变。
 *
 * 两个约束：
 *   1. **零外部素材**（见 docs/adr/0002）—— 天体是径向渐变、云是若干圆拼成的
 *      蓬松团块、星是 1~2px 的圆点。没有任何图片文件。
 *   2. **确定性**（和城市剪影一样）—— 用固定种子的伪随机，每次启动的天空一致；
 *      否则调试时画面每次都不一样，视觉评审无从谈起。
 *
 * 动态感从哪来：本模块不接收时间参数（渲染层没有时间源，也不该有）。
 * 云的横向漂移挂在摄像机上 —— 塔越高 camY 越大，云就慢慢往一侧飘。
 * 玩家看到的是「云在动」，而不是「云绑在塔高上」。
 */
const drawMod = require('./draw');

const TAU = Math.PI * 2;
const PARALLAX_STAR = 0.02;

function makeRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 一朵云：若干「团块」的圆心与半径，单位为世界单位。 */
function buildCloud(rand) {
  const lumps = [];
  const n = 3 + Math.floor(rand() * 3);
  let cursor = 0;

  for (let i = 0; i < n; i += 1) {
    // 中间鼓、两侧扁。只按随机半径排一排会得到一条扁平长条，不像云。
    const t = n === 1 ? 0.5 : (i + 0.5) / n;
    const bulge = Math.sin(t * Math.PI);
    const r = 0.38 + rand() * 0.26 + bulge * 0.46;
    lumps.push({
      dx: cursor + r,
      dy: -bulge * 0.34 + (rand() - 0.5) * 0.14,
      r
    });
    cursor += r * 1.04;
  }

  const width = cursor + 0.5;
  return { lumps, width };
}

function buildClouds(seed, theme) {
  const rand = makeRandom(seed);
  const clouds = [];
  const count = theme.clouds.count;
  const span = 900; // 云的世界活动范围（要大于世界宽度，方便环绕）

  for (let i = 0; i < count; i += 1) {
    const shape = buildCloud(rand);
    const scale = 0.55 + rand() * 0.75;
    clouds.push({
      // 团块形状要带上，drawClouds 靠它画云的轮廓
      lumps: shape.lumps,
      width: shape.width,
      // x 在 [-60, span] 上均匀铺开，必要时环绕
      x: -60 + (i + rand()) * (span / count),
      // 纵向分布在主题给定的天空带里
      band: rand(),
      scale,
      alpha: 0.5 + rand() * 0.5,
      phase: rand()
    });
  }
  return clouds;
}

function buildStars(seed, theme) {
  if (!theme.stars.enabled) return [];
  const rand = makeRandom(seed);
  const stars = [];
  for (let i = 0; i < theme.stars.count; i += 1) {
    stars.push({
      x: rand() * 520,                       // 世界横坐标，范围略大于世界宽度
      // 纵向比例（0 = 画面顶部）。只落在上半部偏下一点 ——
      // 越靠近地平线天光越亮，那里出现星点会很假。
      y: 0.02 + rand() * 0.58,
      r: 0.6 + rand() * 1.5,
      alpha: 0.25 + rand() * 0.75
    });
  }
  return stars;
}

function createSky(cfg, seed, pal) {
  const theme = pal || require('./palette');
  const base = seed === undefined ? 778899 : seed;
  return {
    clouds: buildClouds(base, theme),
    stars: buildStars(base + 313, theme)
  };
}

/** 天体：一个柔和的径向光晕 + 一个实体圆盘。 */
function drawCelestial(ctx, vp, theme) {
  const body = theme.celestial;
  if (!body || body.kind === 'none') return;

  const cx = vp.width * body.x;
  const cy = vp.height * body.y;
  const r = body.radius;

  // 光晕。形状比大小重要 —— 主题只给出光晕的**峰值 alpha**，
  // 这里负责让它迅速掉下去，并按峰值的比例逐级衰减。
  //
  // 曾经只有 0 / 0.45 / 1 三档，中档写的是 withAlpha(glow, 0.35)，而那是把 alpha
  // 直接**设成** 0.35 —— 与峰值 0.38 几乎相等，于是从圆心到半径的 45% 处几乎是
  // 平的，整片光晕被拉平成一顶锅盖：在深色夜空里能看出一圈清晰的硬边，
  // 读起来像「聚光灯」而不是月亮。现在收得快、尾巴长，才是光的样子。
  const glowR = r * body.glowScale;
  const peak = drawMod.alphaOf(body.glow);
  const FALLOFF = [
    [0, 1],
    [0.10, 0.72],
    [0.22, 0.42],
    [0.38, 0.20],
    [0.58, 0.075],
    [0.78, 0.02],
    [1, 0]
  ];
  const glow = drawMod.radialGradient(ctx, cx, cy, r * 0.6, cx, cy, glowR,
    FALLOFF.map((stop) => [stop[0], drawMod.withAlpha(body.glow, peak * stop[1])]));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

  // 本体
  if (body.kind === 'sun') {
    ctx.fillStyle = body.core;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    // 薄薄一圈外环，让太阳不至于像个纯色圆点
    ctx.strokeStyle = body.rim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1.5, 0, TAU);
    ctx.stroke();
  } else {
    // 月亮：实体圆盘 + 一点点亮边
    ctx.fillStyle = body.core;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = body.rim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.5, 0, TAU);
    ctx.stroke();
  }
}

/** 云：所有团块一次 fill（重叠处不会因半透明而叠深）+ 底部一条背光带。 */
function drawClouds(ctx, vp, sky, theme, cfg, rise) {
  const band = theme.clouds;
  const span = 900;

  ctx.save();
  ctx.globalAlpha = band.opacity;

  for (let i = 0; i < sky.clouds.length; i += 1) {
    const cloud = sky.clouds[i];

    // 挂载在摄像机上的缓慢漂移 + 环绕，保证云不会全部飘出画面
    let wx = (cloud.x + rise * 0.05) % span;
    if (wx < 0) wx += span;
    wx -= 60;

    const cx = wx * vp.scale;
    const w = cloud.width * cloud.scale * vp.scale;
    if (cx > vp.width + w || cx + w < -w) continue;

    const cy = vp.height * (band.bandTop + cloud.band * (band.bandBottom - band.bandTop));
    const unit = cloud.scale * vp.scale;

    ctx.globalAlpha = band.opacity * cloud.alpha;
    ctx.fillStyle = band.lit;
    ctx.beginPath();
    for (let k = 0; k < cloud.lumps.length; k += 1) {
      const lump = cloud.lumps[k];
      const lx = cx + lump.dx * unit;
      const ly = cy + lump.dy * unit;
      const lr = lump.r * unit;
      ctx.moveTo(lx + lr, ly);
      ctx.arc(lx, ly, lr, 0, TAU);
    }
    ctx.fill();

    // 云底：压扁的深色带，让云有上下之分
    ctx.fillStyle = band.shade;
    ctx.beginPath();
    ctx.ellipse(cx + cloud.width * 0.5 * unit, cy + unit * 0.75,
      cloud.width * 0.44 * unit, unit * 0.34, 0, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function drawStars(ctx, vp, sky, theme, rise) {
  if (!sky.stars.length) return;
  ctx.save();
  ctx.fillStyle = theme.stars.color;
  for (let i = 0; i < sky.stars.length; i += 1) {
    const star = sky.stars[i];
    const x = star.x * vp.scale;
    // 星辰极远：视差接近 0，只做极轻微的位移
    const y = vp.height * star.y - rise * PARALLAX_STAR;
    if (y < -4 || y > vp.height + 4) continue;
    // 越接近地平线天光越亮，星就越淡，避免「白天也满天星」
    const fade = 1 - Math.max(0, (star.y - 0.32) / 0.42) * 0.85;
    ctx.globalAlpha = star.alpha * fade;
    ctx.beginPath();
    ctx.arc(x, y, star.r * vp.scale, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

module.exports = {
  createSky,
  drawCelestial,
  drawClouds,
  drawStars,
  buildClouds,
  buildStars
};
