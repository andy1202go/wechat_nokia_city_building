/**
 * 无 GUI 出图工具 —— 把工程真实的渲染链跑在原生 Canvas 上，输出 PNG。
 *
 * 为什么需要它：
 *   本机装不了微信开发者工具；浏览器（Chrome）又被系统安全模块拦截，
 *   连 `--version` 都直接 core dump。这个脚本驱动的是 js/ 下**同一份**
 *   渲染与内核代码，所以产出的图就是真画面，可直接用于视觉评审与迭代。
 *
 * 依赖：@napi-rs/canvas（预编译原生模块，**工程本身仍是零依赖**）
 *   npm install @napi-rs/canvas --prefix ~/.cache/canvas-tools     # 装一次
 *   NODE_PATH=~/.cache/canvas-tools/node_modules node dev/render-frame.js
 *   NODE_PATH 指向哪个 node_modules 都可以，已是默认解析路径时前缀可省。
 *
 * 用法：
 *   node dev/render-frame.js                     # 出全部预设场景
 *   node dev/render-frame.js --out <dir>         # 指定输出目录（默认 dev/shots）
 *   node dev/render-frame.js --only tower,lean   # 只出某几个场景
 *   node dev/render-frame.js --size 320x568      # 换设备尺寸
 *
 * 注意：原生 Canvas 不读 fontconfig，中文必须显式注册字体，
 *       否则所有汉字会渲染成方块（tofu）。见 setupFonts()。
 */
const fs = require('fs');
const path = require('path');

const core = require('../js/core');
const renderMod = require('../js/render');
const viewportMod = require('../js/render/viewport');
const presenterMod = require('../js/render/presenter');
const sceneMod = require('../js/render/scene');
const themes = require('../js/render/themes');

// ---- 参数解析 ----
//
// 解析延后到 main 里做：本文件同时被别的开发脚本 require 复用，
// 顶层读 argv 会读到调用者的命令行。

function parseArgs(argv) {
  const value = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    outDir: path.resolve(__dirname, '..', value('--out', 'dev/shots')),
    only: value('--only', ''),
    size: value('--size', '375x812'),
    theme: value('--theme', themes.DEFAULT_THEME)
  };
}

// ---- Canvas 与字体 ----

let createCanvas;
try {
  ({ createCanvas } = require('@napi-rs/canvas'));
} catch (err) {
  console.error('找不到 @napi-rs/canvas —— 出图工具的唯一依赖（工程本身是零依赖的）。');
  console.error('装一次即可：');
  console.error('  npm install @napi-rs/canvas --prefix ~/.cache/canvas-tools');
  console.error('  NODE_PATH=~/.cache/canvas-tools/node_modules node dev/render-frame.js');
  console.error('NODE_PATH 指向哪个 node_modules 都行，已在默认解析路径下时可省略。');
  process.exit(1);
}

/**
 * 注册中文字体。
 *
 * 工程里字体名是硬编码的 `sans-serif`（见 js/render/draw.js），
 * 所以这里把中文字体直接注册成 `sans-serif` 这个别名 ——
 * 好处是工程代码一行都不用为「出图工具」让步。
 */
const FONT_CANDIDATES = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
];

function setupFonts() {
  const { GlobalFonts } = require('@napi-rs/canvas');
  let registered = 0;
  for (const file of FONT_CANDIDATES) {
    if (!fs.existsSync(file)) continue;
    try {
      GlobalFonts.registerFromPath(file, 'sans-serif');
      registered += 1;
      break; // 注册成功一个即可
    } catch (err) {
      console.warn('字体注册失败：' + file + ' —— ' + err.message);
    }
  }
  if (!registered) {
    console.warn('警告：未找到中文字体，画面中的汉字会渲染成方块。');
  }
  return registered > 0;
}

// ---- 舞台 ----

function makeStage(metrics, cfg, pal) {
  const canvas = createCanvas(metrics.width, metrics.height);
  const ctx = canvas.getContext('2d');
  const run = core.run.createRun(cfg);
  const vp = viewportMod.createViewport(metrics, cfg);
  const presenter = presenterMod.createPresenter();
  const scene = sceneMod.createScene(cfg, undefined, pal);
  return { canvas, ctx, run, vp, presenter, scene, cfg, pal };
}

/** 把吊车推进到某相位，让画面里的吊车不在正中央。 */
function swingTo(stage, seconds) {
  let t = 0;
  const step = stage.cfg.FEEL.fixedDt;
  while (t < seconds) {
    core.run.update(stage.run, step);
    t += step;
  }
}

/** 按偏移序列逐层投放，返回每层的判定。 */
function buildTower(stage, offsets) {
  const verdicts = [];
  for (let i = 0; i < offsets.length; i += 1) {
    const x = core.tower.topCenterX(stage.run.tower) + offsets[i];
    const result = core.run.landAt(stage.run, x);
    verdicts.push(result.verdict);
  }
  return verdicts;
}

/** 同步演出状态（让压扁 / 闪烁等短动画有个合理的取值）。 */
function settlePresenter(stage, seconds) {
  const events = core.run.drainEvents(stage.run);
  if (events.length) presenterMod.consumeEvents(stage.presenter, events, stage.run, stage.cfg);
  let t = 0;
  const step = stage.cfg.FEEL.fixedDt;
  while (t < seconds) {
    presenterMod.advancePresenter(stage.presenter, step, stage.cfg);
    t += step;
  }
}

function uiOf(stage, extra) {
  const run = stage.run;
  return Object.assign({
    paused: false,
    ended: core.run.isEnded(run),
    ending: run.ending,
    floors: core.run.floorCount(run),
    population: core.run.population(run),
    comboBest: run.combo.best,
    score: run.score,
    bestScore: 412,
    isNewBest: false
  }, extra || {});
}

function draw(stage, ui) {
  // 出图要的是「镜头已就位」的稳定画面，所以直接对齐目标而不是让它慢慢滑过去
  viewportMod.snapCamera(stage.vp, stage.run, stage.cfg);
  renderMod.render(
    stage.ctx, stage.run, stage.vp, stage.presenter,
    stage.scene, stage.cfg, ui || uiOf(stage), stage.pal
  );
  return stage.canvas;
}

// ---- 预设场景 ----

const SCENES = {
  /** 首屏：空地基，吊车在第 1/4 周期处（视觉上最像「正在摆」）。 */
  idle(stage) {
    swingTo(stage, stage.cfg.CRANE.periodSecAtStart * 0.25);
    return draw(stage);
  },

  /**
   * 地面特写：一座刚起步、且明显偏向一侧的矮塔。
   *
   * 专门用来看地面与地基 —— 塔一高镜头就跟随，地面很快出屏幕（层高 64 之后，
   * 到第 3 层地面就不见了），而「地基是不是平的、塔歪的时候它动不动」
   * 只有在这个层数上才验得到。
   */
  ground(stage) {
    buildTower(stage, [0, 30]);
    settlePresenter(stage, 0.3);
    return draw(stage);
  },

  /** 主玩法画面：一座堆得不错的中塔。 */
  tower(stage) {
    buildTower(stage, [0, 2, -1, 0, 0, 3, -2, 0, 1, 0, -1, 0]);
    swingTo(stage, stage.cfg.CRANE.periodSecAtStart * 0.6);
    settlePresenter(stage, 0.3);
    return draw(stage);
  },

  /** 高风险画面：塔明显偏向一侧，倾角可见。 */
  lean(stage) {
    buildTower(stage, [0, 8, 6, 9, 7, 5, 8, 6, 9, 7]);
    settlePresenter(stage, 0.3);
    return draw(stage);
  },

  /** 连击与机会都处于紧张状态。 */
  combo(stage) {
    buildTower(stage, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    stage.run.missBudget = 1;
    settlePresenter(stage, 0.3);
    return draw(stage);
  },

  /** 封顶结算。 */
  'end-topped'(stage) {
    buildTower(stage, [0, 1, 0, 2, 0, 0, 1, 0, 2, 0]);
    settlePresenter(stage, 0.3);
    core.run.finishRun(stage.run, core.run.ENDING.TOPPED_OUT);
    settlePresenter(stage, 0.8);
    return draw(stage, uiOf(stage, { isNewBest: true }));
  },

  /** 坍塌结算：含倒塌演出姿态。 */
  'end-collapsed'(stage) {
    buildTower(stage, [0, 9, 7, 8, 10, 7, 9, 8]);
    settlePresenter(stage, 0.3);
    core.run.finishRun(stage.run, core.run.ENDING.COLLAPSED);
    settlePresenter(stage, 0.8);
    stage.presenter.collapseT = stage.cfg.VISUAL.collapseSec; // 倒稳
    return draw(stage);
  },

  /**
   * 倒塌**进行到一半**。
   *
   * 为什么要单独一帧：`end-collapsed` 只给得出倒稳后的终态，而倒塌演出的
   * 中间姿态是它唯一能出问题、又唯一没人看的地方 —— 塔身转到中途时会不会
   * 有一角扎进地面、会不会整座塔滑出画面，在终态上都看不出来。
   */
  'end-falling'(stage) {
    buildTower(stage, [0, 9, 7, 8, 10, 7, 9, 8]);
    settlePresenter(stage, 0.3);
    core.run.finishRun(stage.run, core.run.ENDING.COLLAPSED);
    settlePresenter(stage, 0.8);
    stage.presenter.collapseT = stage.cfg.VISUAL.collapseSec * 0.45;
    // 关掉结算面板。局面已经结束，面板会自动浮上来，而它正好盖住要看的塔身 ——
    // 这一帧要看的是倒塌姿态，不是结算界面
    return draw(stage, uiOf(stage, { ended: false }));
  },

  /** 暂停面板。 */
  pause(stage) {
    buildTower(stage, [0, 2, -1, 0, 0, 3, -2, 0]);
    settlePresenter(stage, 0.3);
    return draw(stage, uiOf(stage, { paused: true }));
  }
};

// ---- 主流程 ----

function main() {
  const args = parseArgs(process.argv.slice(2));
  setupFonts();

  const [w, h] = args.size.split('x').map(Number);
  const metrics = { width: w, height: h, safeTop: Math.round(h * 0.05), safeBottom: Math.round(h * 0.03) };

  const names = args.only ? args.only.split(',').map((s) => s.trim()) : Object.keys(SCENES);
  const themeNames = args.theme === 'all' ? themes.NAMES : [args.theme];
  fs.mkdirSync(args.outDir, { recursive: true });

  const cfg = core.config;
  console.log(`设备 ${w}x${h}   主题 ${themeNames.join(' / ')}   输出 ${args.outDir}`);
  console.log('');

  let count = 0;
  for (const themeName of themeNames) {
    const pal = themes.themeByName(themeName);
    for (const name of names) {
      if (!SCENES[name]) {
        console.warn(`跳过未知场景：${name}`);
        continue;
      }
      const stage = makeStage(metrics, cfg, pal);
      const canvas = SCENES[name](stage);
      const buf = canvas.toBuffer('image/png');
      fs.writeFileSync(path.join(args.outDir, `${themeName}-${name}.png`), buf);
      count += 1;

      console.log(
        `${themeName.padEnd(6)} ${name.padEnd(16)} 楼层 ${String(core.run.floorCount(stage.run)).padStart(2)}` +
        ` 偏心 ${core.tower.eccentricity(stage.run.tower).toFixed(1).padStart(5)}` +
        ` 连击 ${String(stage.run.combo.count).padStart(2)}` +
        ` 机会 ${stage.run.missBudget}` +
        `  ${String(Math.round(buf.length / 1024)).padStart(4)} KB`
      );
    }
    console.log('');
  }

  console.log(`共 ${count} 张。`);
}

// 既可以直接跑（CLI），也可以被别的开发脚本 require 复用其中的舞台组装与场景。
module.exports = {
  setupFonts, parseArgs, makeStage, swingTo, buildTower, settlePresenter, uiOf, draw, SCENES
};

if (require.main === module) main();
