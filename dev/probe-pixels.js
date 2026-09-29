/**
 * 像素探针 —— 沿一行或一列扫色，把「颜色在哪一行变了」打出来。
 *
 * 为什么需要它：**在缩略图上凭肉眼判断颜色会出错。** 曾经据此误判 HUD 卡片是白色，
 * 差点推翻一套其实正确的配色（实测是 38,41,79 的深蓝紫）。凡是涉及「这里到底是什么颜色」
 * 的判断，都应该落到采样上，而不是印象上。
 *
 * 比单点采样更进一步的是「扫一条线」：几何关系（地面线在哪、地基有没有坐在上面、
 * 塔底有没有悬空）在一条竖线上的颜色分界里看得最清楚。
 *
 * 用法：
 *   node dev/probe-pixels.js <png> --col 187        # 扫第 187 列（从上到下）
 *   node dev/probe-pixels.js <png> --row 700        # 扫第 700 行（从左到右）
 *   node dev/probe-pixels.js <png> --col 187 --tol 12 --min 3
 *   node dev/probe-pixels.js <png> --at 18,70 --at 300,70   # 只看几个点
 *
 * 参数：
 *   --tol   相邻像素的 RGB 曼哈顿距离超过这个值就认为换了一段（默认 10）
 *   --min   一段至少持续多少像素才打印，滤掉抗锯齿与噪点（默认 2）
 */
const fs = require('fs');
const path = require('path');

function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function load(file) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  return loadImage(fs.readFileSync(file)).then((img) => {
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, img.width, img.height), w: img.width, h: img.height };
  });
}

function pixelAt(img, x, y) {
  const i = (y * img.w + x) * 4;
  return [img.data.data[i], img.data.data[i + 1], img.data.data[i + 2]];
}

function dist(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** 扫一条线，返回 [{ from, to, rgb }]，同一段内颜色视为相同。 */
function scan(img, axis, fixed, tol) {
  const len = axis === 'col' ? img.h : img.w;
  const runs = [];
  let start = 0;
  let prev = pixelAt(img, axis === 'col' ? fixed : 0, axis === 'col' ? 0 : fixed);

  for (let i = 1; i < len; i += 1) {
    const cur = axis === 'col' ? pixelAt(img, fixed, i) : pixelAt(img, i, fixed);
    if (dist(cur, prev) > tol) {
      runs.push({ from: start, to: i - 1, rgb: prev });
      start = i;
      prev = cur;
    }
  }
  runs.push({ from: start, to: len - 1, rgb: prev });
  return runs;
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('用法：node dev/probe-pixels.js <png> [--col N | --row N | --at X,Y ...]');
    process.exit(1);
  }

  const value = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const all = (name) => {
    const out = [];
    argv.forEach((a, i) => { if (a === name && argv[i + 1]) out.push(argv[i + 1]); });
    return out;
  };

  const tol = Number(value('--tol', 10));
  const minLen = Number(value('--min', 2));
  const col = value('--col', null);
  const row = value('--row', null);
  const points = all('--at');

  load(path.resolve(file))
    .then((img) => {
      console.log(`${path.basename(file)}  ${img.w}x${img.h}`);

      points.forEach((p) => {
        const [x, y] = p.split(',').map(Number);
        const [r, g, b] = pixelAt(img, x, y);
        console.log(`  (${x},${y})  rgb(${r}, ${g}, ${b})  ${hex(r, g, b)}`);
      });

      const lines = [];
      if (col !== null) lines.push(['col', Number(col)]);
      if (row !== null) lines.push(['row', Number(row)]);

      lines.forEach(([axis, fixed]) => {
        console.log(`\n-- 扫${axis === 'col' ? '列' : '行'} ${fixed} --`);
        scan(img, axis, fixed, tol)
          .filter((run) => run.to - run.from + 1 >= minLen)
          .forEach((run) => {
            const [r, g, b] = run.rgb;
            const span = run.to - run.from + 1;
            console.log(`  ${String(run.from).padStart(4)} .. ${String(run.to).padStart(4)}  (${String(span).padStart(3)}px)  rgb(${r}, ${g}, ${b})  ${hex(r, g, b)}`);
          });
      });
    })
    .catch((err) => {
      console.error('读取失败：' + err.message);
      process.exit(1);
    });
}

main();
