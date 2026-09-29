/**
 * 游戏总装：把内核、渲染、音效、平台适配接起来，跑固定步长主循环。
 *
 * 分工：
 *   内核（js/core）   决定「发生了什么」——确定性、可测试，不知道 Canvas 的存在
 *   渲染（js/render） 只读内核状态，决定「看起来怎么样」
 *   音效（js/audio）  消费内核事件，决定「听起来怎么样」
 *   本文件           只做编排与输入分发，不含游戏规则、也不含绘制细节
 */
const core = require('./core');
const renderMod = require('./render');
const sceneMod = require('./render/scene');
const presenterMod = require('./render/presenter');
const vpMod = require('./render/viewport');
const hud = require('./render/hud');
const overlay = require('./render/overlay');
const palette = require('./render/palette');
const sfxMod = require('./audio/sfx');
const { createEnv } = require('./platform/env');

const BEST_SCORE_KEY = 'skyline_stacker_best_v1';
const MAX_LOGIC_STEPS_PER_FRAME = 8;

function boot() {
  const cfg = core.config;

  // 参数自检：宁可启动时吵一次，也不要让玩家遇到怪异手感
  const problems = core.validateConfig(cfg);
  if (problems.length > 0) {
    console.error('[摩天叠楼师] 参数自检未通过：\n - ' + problems.join('\n - '));
  }

  const env = createEnv();
  if (!env.available) {
    console.error(
      '[摩天叠楼师] 未检测到小游戏运行环境。\n' +
        '请在微信开发者工具中以「小游戏」类型打开本目录：project.config.json 里的 compileType 必须为 "game"，' +
        '并把 appid 换成你自己的小游戏 AppID。'
    );
    return null;
  }

  const ctx = env.ctx;
  const run = core.run.createRun(cfg);
  const presenter = presenterMod.createPresenter();
  const scene = sceneMod.createScene(cfg);
  const vp = vpMod.createViewport(env.metrics, cfg);
  const sfx = sfxMod.createSfx(cfg);

  let paused = false;
  let bestScore = Number(env.storage.get(BEST_SCORE_KEY, 0)) || 0;
  let newBestThisRun = false;
  let accumulator = 0;
  let lastFrameAt = env.now();

  vpMod.snapCamera(vp, run, cfg);

  // ---- 事件处理：内核事件 -> 演出 + 音效 + 震动 + 最高分 ----

  /** 震动开关收在这里，cfg.VIBRATE.enabled 才是一个真正生效的开关。 */
  function buzz(type) {
    if (!cfg.VIBRATE.enabled) return;
    env.vibrate.short(type);
  }

  function handleEvents(events) {
    if (!events.length) return;

    presenterMod.consumeEvents(presenter, events, run, cfg);
    sfxMod.consumeEvents(sfx, events);

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];

      if (event.type === 'land') {
        if (event.verdict === 'perfect') buzz('light');
        else if (event.verdict === 'miss') buzz('medium');
      } else if (event.type === 'end') {
        if (event.ending === core.run.ENDING.COLLAPSED) buzz('heavy');
        if (run.score > bestScore) {
          bestScore = run.score;
          newBestThisRun = true;
          env.storage.set(BEST_SCORE_KEY, bestScore);
        }
      }
    }
  }

  // ---- 局面控制 ----

  function restart() {
    core.run.resetRun(run);
    presenterMod.resetPresenter(presenter);
    paused = false;
    newBestThisRun = false;
    accumulator = 0;
    vpMod.snapCamera(vp, run, cfg);
  }

  function buildUi() {
    const ended = core.run.isEnded(run);
    return {
      paused: paused,
      ended: ended,
      ending: run.ending,
      floors: core.run.floorCount(run),
      population: core.run.population(run),
      comboBest: run.combo.best,
      score: run.score,
      bestScore: bestScore,
      isNewBest: newBestThisRun
    };
  }

  // ---- 输入 ----

  env.onTouchStart(function (x, y) {
    sfxMod.resume(sfx);

    const ended = core.run.isEnded(run);

    // 面板优先：暂停与结算状态下的按键要吃掉点击，不能同时触发投放
    const overlayAction = overlay.hitTest(vp, x, y, { paused: paused, ended: ended });
    if (overlayAction === 'resume') {
      paused = false;
      return;
    }
    if (overlayAction === 'restart') {
      restart();
      return;
    }
    if (ended || paused) return;

    if (hud.hitTest(vp, x, y) === 'pause') {
      paused = true;
      return;
    }

    if (core.run.canDrop(run)) core.run.requestDrop(run);
  });

  env.onShow(function () {
    // 切回前台时把时间基准重置，避免累积一大段 dt
    lastFrameAt = env.now();
    accumulator = 0;
  });

  // ---- 主循环 ----

  function frame() {
    const now = env.now();
    let dt = (now - lastFrameAt) / 1000;
    lastFrameAt = now;
    if (!(dt > 0)) dt = 0;
    if (dt > cfg.FEEL.maxFrameDt) dt = cfg.FEEL.maxFrameDt;

    if (!paused) {
      // 固定步长推进逻辑，与帧率解耦
      accumulator += dt;
      let steps = 0;
      while (accumulator >= cfg.FEEL.fixedDt && steps < MAX_LOGIC_STEPS_PER_FRAME) {
        core.run.update(run, cfg.FEEL.fixedDt);
        accumulator -= cfg.FEEL.fixedDt;
        steps += 1;
      }
      // 补不动就丢弃余量，宁可掉帧也不要滚雪球
      if (steps >= MAX_LOGIC_STEPS_PER_FRAME) accumulator = 0;

      vpMod.updateCamera(vp, run, cfg, dt);
      presenterMod.advancePresenter(presenter, dt, cfg);
    }

    const events = core.run.drainEvents(run);
    if (events.length) handleEvents(events);

    renderMod.render(ctx, run, vp, presenter, scene, cfg, buildUi(), palette);

    env.raf(frame);
  }

  env.raf(frame);

  return { env: env, run: run, presenter: presenter, restart: restart };
}

module.exports = { boot };
