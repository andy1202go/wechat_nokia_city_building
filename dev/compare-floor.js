/**
 * 楼层尺寸对比出图 —— 把同一座塔按不同楼层边长各画一遍，横向拼成一张图。
 *
 * 为什么单独一个脚本：把楼层从「扁砖」改成「正方形」会同时牵动
 * 可见层数、摄像机跟随时机、地基与楼层的宽度比、窗格布局 ——
 * 光看配置数字判断不了，必须看图。它复用 dev/render-frame.js 的舞台组装
 * 与场景逻辑，**不复制任何渲染代码**。
 *
 * 用法：
 *   NODE_PATH=... node dev/compare-floor.js
 *   NODE_PATH=... node dev/compare-floor.js --sizes 64x64,80x80,96x96 --floors 12
 *   NODE_PATH=... node dev/compare-floor.js --theme night --size 320x568
 *
 * 输出默认 dev/shots/compare-floor.png（该目录已 gitignore）。
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

const SIZES = value('--sizes', '64x22,64x64,88x88,104x104').split(',').map((s) => s.trim());
const DEVICE = value('--size', '375x812');
const THEME = value('--theme', themes.DEFAULT_THEME);
const FLOORS = Number(value('--floors', 12));
const OUT = path.resolve(__dirname, '..', value('--out', 'dev/shots/compare-floor.png'));

/**
 * 相对楼层宽度的偏移比。
 *
 * 用比例而不是绝对偏移，是为了让各档的塔**形状一致** —— 否则同一串绝对偏移
 * 在窄楼层上是失误、在宽楼层上是完美，比的就成了「判定差异」而不是「尺寸差异」。
 */
const RATIOS = [0, 0.03, -0.015, 0, 0, 0.045, -0.025, 0, 0.015, 0, -0.012, 0];

const HEADER = 46; // 每格上方留给标注的高度

function buildOne(cfg, pal, metrics, spec) {
  const [fw, fh] = spec.split('x').map(Number);
  cfg.FLOOR.width = fw;
  cfg.FLOOR.height = fh;

  const stage = frame.makeStage(metrics, cfg, pal);
  frame.buildTower(stage, RATIOS.slice(0, Math.max(1, FLOORS)).map((r) => r * fw));
  frame.swingTo(stage, cfg.CRANE.periodSecAtStart * 0.6);
  frame.settlePresenter(stage, 0.3);
  const canvas = frame.draw(stage);

  // 屏幕上到底能看到几层：塔顶到「屏幕底边与地面之中较高者」的距离 ÷ 层高。
  // 塔尚矮时摄像机不跟随（camY 被钳在地面附近），此时全部可见。
  const count = core.run.floorCount(stage.run);
  const topY = core.tower.topY(stage.run.tower, cfg);
  const bottomLimit = Math.max(0, stage.vp.camY);
  const visible = Math.min(count, (topY - bottomLimit) / cfg.FLOOR.height);

  return { canvas, spec, count, visible };
}

function main() {
  frame.setupFonts();

  const { createCanvas } = require('@napi-rs/canvas');
  const [w, h] = DEVICE.split('x').map(Number);
  const metrics = {
    width: w, height: h,
    safeTop: Math.round(h * 0.05), safeBottom: Math.round(h * 0.03)
  };

  const pal = themes.themeByName(THEME);
  const cfg = core.config;
  const cells = SIZES.map((spec) => buildOne(cfg, pal, metrics, spec));

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
    sctx.fillText(cell.spec, x + 12, 20);

    sctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
    sctx.font = '11px sans-serif';
    sctx.fillText(`${cell.count} 层 · 可见 ${cell.visible.toFixed(1)} 层`, x + 12, 37);
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sheet.toBuffer('image/png'));

  console.log(`设备 ${DEVICE}   主题 ${THEME}   楼层 ${FLOORS}`);
  console.log(`已输出 ${OUT}  (${sheetW}x${sheetH})`);
  cells.forEach((c) => {
    console.log(`  FLOOR ${c.spec.padEnd(8)} ${c.count} 层   可见 ${c.visible.toFixed(1)} 层`);
  });
}

main();
