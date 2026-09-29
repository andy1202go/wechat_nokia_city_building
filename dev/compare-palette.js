/**
 * 配色对比出图 —— 同一座塔、同一套主题，只换 building 色板，横向拼成一张图。
 *
 * 为什么单独一个脚本：「低幼感」不是一个能靠色号判断的问题。
 * 「六个色相循环」和「同一色相的几档明度」写在配置里差别很小，
 * 但画到一摞方块上，前者是彩虹积木、后者是一栋楼。这种事只能看图。
 *
 * 待比较的几版**全部由当前主题的色板按规则推导**，不写死色号 ——
 * 所以换主题也能跑，三条规则不随主题变：
 *
 *   改前  六个色相循环（历史配色，对照用）→ 只有它是写死的，因为它是被淘汰的那一版
 *   当前  三档明度                         → 就是 themes.js 里的值
 *   两档  只留中、深两档                   → 再收敛一档看看
 *   单色  整座塔一个颜色                   → 收敛的极限
 *   强调  三档之外每 6 层加一个 perfectCap  → 反面演示，见下面的说明
 *
 * 标注区会直接把色板本身画出来 —— 因为塔一高镜头就跟随，画面里通常只看得到
 * 5 层左右，循环节奏在色块条上反而比在塔身上更清楚。
 *
 * 用法：
 *   NODE_PATH=... node dev/compare-palette.js
 *   NODE_PATH=... node dev/compare-palette.js --theme day
 *   NODE_PATH=... node dev/compare-palette.js --floors 8 --size 375x667
 *
 * 输出默认 dev/shots/compare-palette-<主题>.png（该目录已 gitignore）。
 */
const fs = require('fs');
const path = require('path');

const core = require('../js/core');
const themes = require('../js/render/themes');
const frame = require('./render-frame');

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const THEME = value('--theme', themes.DEFAULT_THEME);
const DEVICE = value('--size', '375x812');
const FLOORS = Number(value('--floors', 12));
const OUT = path.resolve(__dirname, '..', value('--out', `dev/shots/compare-palette-${THEME}.png`));

/** 塔的偏移序列：与 render-frame 里那张「堆得不错的中塔」一致，形状可比。 */
const OFFSETS = [0, 2, -1, 0, 0, 3, -2, 0, 1, 0, -1, 0];

/**
 * 改前的六色相色板，逐主题留档。
 *
 * 这是这一轮唯一写死的色号 —— 它是被淘汰的那一版，只作对照。
 * 留着它的意义是：以后若有人觉得「每层一个颜色挺好看的」，
 * 跑一次这个脚本就能看到它画到方块上是什么样子。
 */
const LEGACY_BUILDING = {
  day: ['#F0C353', '#6FA8DC', '#E0A04A', '#7FBF7F', '#B491D0', '#EAE3D6'],
  dusk: ['#E9A85C', '#C9735A', '#8E6B8E', '#DBA05F', '#A8634E', '#E3B978'],
  night: ['#3E5A8C', '#4A6BA0', '#2E466E', '#5878AE', '#3A5A86', '#5A7FB8']
};

/**
 * 由主题色板推导出待比较的几版。
 *
 * 约定：themes.js 里的 building 按「中 → 浅 → 深」排（见那里的规则 2），
 * 所以 p[0] 是中档、p[2] 是深档。
 */
function variantsFor(pal) {
  const [mid, light, dark] = pal.building;
  return [
    {
      label: '改前 · 六色相循环',
      note: '每层换一个色相 = 彩虹积木',
      colors: LEGACY_BUILDING[THEME] || LEGACY_BUILDING.dusk
    },
    {
      label: '当前 · 三档明度',
      note: '同一色相，等步长交替',
      colors: null // null = 用主题自带的色板
    },
    {
      label: '两档明度',
      note: '再收敛一档，最安静',
      colors: [mid, dark]
    },
    {
      label: '单色',
      note: '收敛的极限：只有体积感在分层',
      colors: [mid]
    },
    {
      label: '三档 + 强调色',
      note: '反面：强调色该留给完美落点的奖励，不能给楼层',
      colors: [mid, light, dark, mid, light, pal.perfectCap]
    }
  ];
}

const HEADER = 62; // 每格上方留给标注与色板条的高度

function buildOne(cfg, metrics, variant) {
  const pal = themes.themeByName(THEME);
  if (variant.colors) pal.building = variant.colors.slice();

  const stage = frame.makeStage(metrics, cfg, pal);
  frame.buildTower(stage, OFFSETS.slice(0, Math.max(1, FLOORS)));
  frame.swingTo(stage, cfg.CRANE.periodSecAtStart * 0.6);
  frame.settlePresenter(stage, 0.3);

  return { canvas: frame.draw(stage), colors: pal.building.slice() };
}

function main() {
  frame.setupFonts();

  const { createCanvas } = require('@napi-rs/canvas');
  const [w, h] = DEVICE.split('x').map(Number);
  const metrics = {
    width: w, height: h,
    safeTop: Math.round(h * 0.05), safeBottom: Math.round(h * 0.03)
  };

  const cfg = core.config;
  const VARIANTS = variantsFor(themes.themeByName(THEME));
  const cells = VARIANTS.map((variant) => {
    const built = buildOne(cfg, metrics, variant);
    built.label = variant.label;
    built.note = variant.note;
    return built;
  });

  const sheetW = w * cells.length;
  const sheetH = HEADER + h;
  const sheet = createCanvas(sheetW, sheetH);
  const sctx = sheet.getContext('2d');

  sctx.fillStyle = '#0B0F14';
  sctx.fillRect(0, 0, sheetW, sheetH);

  cells.forEach((cell, i) => {
    const x = i * w;
    sctx.drawImage(cell.canvas, x, HEADER);

    if (i > 0) {
      // 分隔线：压在画面上，但不能抢戏
      sctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
      sctx.fillRect(x, 0, 1, sheetH);
    }

    sctx.fillStyle = '#FFFFFF';
    sctx.font = '15px sans-serif';
    sctx.fillText(cell.label, x + 12, 22);

    sctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
    sctx.font = '11px sans-serif';
    sctx.fillText(cell.note, x + 12, 39);

    // 色板条：循环节奏在这里比在塔身上更容易看清
    cell.colors.forEach((color, k) => {
      sctx.fillStyle = color;
      sctx.fillRect(x + 12 + k * 17, 47, 14, 10);
    });
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sheet.toBuffer('image/png'));

  console.log(`主题 ${THEME}   设备 ${DEVICE}   楼层 ${FLOORS}`);
  console.log(`已输出 ${OUT}  (${sheetW}x${sheetH})`);
  cells.forEach((c) => {
    console.log(`  ${c.label.padEnd(18)} ${c.colors.join(' ')}`);
  });
}

main();
