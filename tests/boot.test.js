/**
 * 编排层端到端测试。
 *
 * 前面几组测试各自覆盖内核与渲染，但「它们接起来能不能跑」始终没被验证过：
 * boot() 里的固定步长主循环、输入分发优先级、事件消费、最高分持久化，
 * 只有真的启动一次才会暴露问题。本文件用平台桩把 js/game.js 真正跑起来。
 *
 * 这里测的是装配关系，不重复测规则（规则在 core 的测试里）。
 */
const core = require('../js/core');
const { createStubPlatform } = require('./canvas-stub');

const viewport = require('../js/render/viewport');
const overlayMod = require('../js/render/overlay');

const METRICS = { width: 375, height: 667, safeTop: 20, safeBottom: 0 };
const BEST_SCORE_KEY = 'skyline_stacker_best_v1';

/**
 * 用于「随便点一下」的屏幕坐标。
 *
 * 刻意避开屏幕下半部分：结算面板的「再来一局」按钮落在 y ∈ [459.5, 501.5]，
 * 而屏幕正中央 (187.5, 500) 正好压在按钮上 —— 终局之后点它就会重开一局。
 * 测试里如果拿中央当投放点，会在终局后被反复重开，掩盖真实行为。
 */
const PLAY_AREA = { x: 187.5, y: 300 };

/** 用与游戏相同的参数重建视口，用于算出按钮的命中位置。 */
function makeViewport() {
  return viewport.createViewport(METRICS, core.config);
}

/** 在桩环境里启动一局，返回控制器与平台。 */
function launch(options) {
  const platform = createStubPlatform(options);
  const game = require('../js/game').boot();
  return { platform: platform, game: game };
}

/** 收集最近一帧里画出的所有文字。 */
function frameTexts(platform) {
  platform.stub.reset();
  platform.pump(1, 16);
  return platform.stub.argsOf('fillText').map(function (args) {
    return String(args[0]);
  });
}

module.exports = function register(t) {
  // ------------------------------------------------------------------
  t.section('game · 编排层端到端');
  // ------------------------------------------------------------------

  t.test('boot() 能在模拟的小游戏环境中启动并持续跑帧', () => {
    const launched = launch();
    const platform = launched.platform;
    try {
      t.assert(launched.game !== null, 'boot 应返回控制器');
      t.assert(launched.game.env.available === true, '应检测到可用环境');
      t.eq(launched.game.env.metrics.width, METRICS.width, '窗口尺寸应被读入');
      t.eq(launched.game.env.metrics.safeTop, METRICS.safeTop, '安全区应被读入');
      t.eq(platform.canvas.width, 750, '画布后备存储是物理像素');

      // boot 结束时排了第一帧
      t.eq(platform.pendingFrames(), 1, '应已排入首帧');

      const frames = platform.pump(120, 16);
      t.eq(frames, 120, '主循环应持续排帧');
      t.gt(platform.stub.countOf('clearRect'), 100, '每帧都应清屏');
      t.eq(platform.stub.problems.length, 0, `非法绘制参数：${platform.stub.problems.join(' | ')}`);
      t.eq(platform.stub.stackDepth(), 0, 'save/restore 应配对');
    } finally {
      platform.cleanup();
    }
  });

  t.test('参数自检不通过时必须吵闹（启动时就报告，而不是让玩家遇到怪异手感）', () => {
    const launched = launch();
    const platform = launched.platform;
    try {
      const captured = [];
      const originalError = console.error;
      console.error = function (message) {
        captured.push(String(message));
      };
      try {
        const cfg = core.config;
        const savedAmplitude = cfg.CRANE.amplitude;
        cfg.CRANE.amplitude = cfg.CRANE.pendulumLength + 10; // 摆角无解
        try {
          require('../js/game').boot();
        } finally {
          cfg.CRANE.amplitude = savedAmplitude;
        }
      } finally {
        console.error = originalError;
      }
      t.gt(captured.length, 0, '应通过 console.error 报告参数问题');
      t.assert(
        captured.join('').indexOf('参数自检未通过') >= 0,
        `报告内容应可辨认，实际：${captured.join(' | ')}`
      );
    } finally {
      platform.cleanup();
    }
  });

  t.test('触摸屏幕发起投放，物理走完后塔长高一层', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      t.eq(core.run.floorCount(game.run), 0, '开局没有楼层');
      t.eq(core.run.canDrop(game.run), true, '开局可投放');

      platform.touch(PLAY_AREA.x, PLAY_AREA.y);
      t.eq(game.run.phase, core.run.PHASE.DROPPING, '触摸后应立即进入下落');

      platform.pump(120, 16);
      t.eq(core.run.floorCount(game.run), 1, '应落下 1 层');
      t.eq(game.run.phase, core.run.PHASE.SWINGING, '落地停顿后回到摆动');
    } finally {
      platform.cleanup();
    }
  });

  t.test('拖长摆放时间会让吊车摆到远处，落点随之失误', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      const cfg = core.config;
      // 摆动周期 2.2 秒，四分之一周期后正好摆到振幅端点
      const framesToPeak = Math.round((cfg.CRANE.periodSecAtStart / 4) / (16 / 1000));
      platform.pump(framesToPeak, 16);
      platform.touch(PLAY_AREA.x, PLAY_AREA.y);
      platform.pump(140, 16);

      t.eq(core.run.floorCount(game.run), 0, '偏差过大不该加楼层');
      t.lt(game.run.missBudget, cfg.RUN.missBudget, '应消耗一次失误额度');
      t.eq(game.run.combo.count, 0, '失误应清零连击');
    } finally {
      platform.cleanup();
    }
  });

  t.test('点右上角暂停按钮：逻辑停止推进，并画出暂停面板', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      const vp = makeViewport();
      const pauseBox = require('../js/render/hud').layout(vp).pause;
      const cx = pauseBox.x + pauseBox.w / 2;
      const cy = pauseBox.y + pauseBox.h / 2;

      platform.touch(cx, cy);
      const swingAtPause = game.run.crane.t;

      const texts = frameTexts(platform);
      t.assert(
        texts.indexOf('已暂停') >= 0,
        `应画出暂停面板，实际文字：${texts.join(' / ')}`
      );

      platform.pump(60, 16);
      t.eq(game.run.crane.t, swingAtPause, '暂停时摆动相位不该推进');

      // 点「继续建造」
      const box = overlayMod.layout(vp, { paused: true, ended: false });
      const primary = box.primary;
      platform.touch(primary.x + primary.w / 2, primary.y + primary.h / 2);
      platform.pump(30, 16);
      t.gt(game.run.crane.t, swingAtPause, '继续后摆动应恢复');
    } finally {
      platform.cleanup();
    }
  });

  t.test('暂停按钮外沿 1 像素不算命中，会被当成投放', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      const vp = makeViewport();
      const box = require('../js/render/hud').layout(vp).pause;

      platform.touch(box.x + box.w + 2, box.y + box.h / 2);
      t.eq(game.run.phase, core.run.PHASE.DROPPING, '按钮外侧应视为投放，而不是暂停');
    } finally {
      platform.cleanup();
    }
  });

  t.test('暂停时点屏幕不会误投放（面板吃掉点击）', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      const vp = makeViewport();
      const box = require('../js/render/hud').layout(vp).pause;
      platform.touch(box.x + box.w / 2, box.y + box.h / 2);

      // 面板中央既不是「继续」也不是「重新开始」，应被吞掉
      platform.touch(vp.width / 2, vp.height / 2);
      t.eq(game.run.phase, core.run.PHASE.SWINGING, '暂停状态下不该发起投放');
      t.eq(core.run.floorCount(game.run), 0, '也不该产生楼层');
    } finally {
      platform.cleanup();
    }
  });

  t.test('终局：写出最高分、画出结算面板，点主按钮能重开', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      const cfg = core.config;
      // 用内核 API 快速堆到有分数的高度（编排层只负责把触摸转成 landAt）
      const center = core.tower.centroidX(game.run.tower);
      for (let i = 0; i < 8; i += 1) {
        core.run.landAt(game.run, core.tower.topCenterX(game.run.tower));
      }
      t.eq(core.run.floorCount(game.run), 8, '应堆起 8 层');

      core.run.finishRun(game.run, core.run.ENDING.TOPPED_OUT);
      t.eq(core.run.isEnded(game.run), true, '应已终局');

      // 跑两帧让主循环消费 end 事件
      platform.pump(2, 16);
      t.eq(
        platform.storage.get(BEST_SCORE_KEY),
        game.run.score,
        '终局后应把得分写入本地存储'
      );

      const texts = frameTexts(platform);
      t.assert(texts.indexOf('封顶') >= 0, `应画出封顶结算面板，实际：${texts.join(' / ')}`);
      t.assert(texts.indexOf('再来一局') >= 0, '应有重开按钮');

      // 点「再来一局」
      const vp = makeViewport();
      const box = overlayMod.layout(vp, { ended: true, ending: game.run.ending });
      platform.touch(box.primary.x + box.primary.w / 2, box.primary.y + box.primary.h / 2);

      t.eq(core.run.isEnded(game.run), false, '重开后不该还是终局状态');
      t.eq(core.run.floorCount(game.run), 0, '重开后塔应清空');
      t.eq(game.run.missBudget, cfg.RUN.missBudget, '重开后失误额度应复原');
    } finally {
      platform.cleanup();
    }
  });

  t.test('终局后点屏幕任意位置都不会再投放', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      core.run.landAt(game.run, core.tower.topCenterX(game.run.tower));
      core.run.finishRun(game.run, core.run.ENDING.COLLAPSED);
      platform.pump(2, 16);

      const floorsAtEnd = core.run.floorCount(game.run);
      platform.touch(PLAY_AREA.x, PLAY_AREA.y);
      platform.pump(30, 16);
      t.eq(core.run.floorCount(game.run), floorsAtEnd, '终局后不该再加楼层');
    } finally {
      platform.cleanup();
    }
  });

  t.test('终局后点投放区不会误触重开（按钮只占屏幕下半部分）', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      core.run.landAt(game.run, core.tower.topCenterX(game.run.tower));
      core.run.finishRun(game.run, core.run.ENDING.TOPPED_OUT);
      platform.pump(2, 16);

      platform.touch(PLAY_AREA.x, PLAY_AREA.y);
      platform.pump(2, 16);

      t.eq(core.run.isEnded(game.run), true, '点投放区不该重开一局');
      t.eq(game.run.ending, core.run.ENDING.TOPPED_OUT, '结局不该被重置');
      t.gt(core.run.floorCount(game.run), 0, '塔身应保留在结算画面上');
    } finally {
      platform.cleanup();
    }
  });

  t.test('切到后台再回来：时间基准被重置，不会一次推进一大段', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      platform.pump(5, 16);
      const before = game.run.crane.t;

      platform.clock.t += 120000; // 后台待了两分钟
      platform.show();
      // 单帧 16ms 攒不满一个 1/60 秒（≈16.7ms）的逻辑步，所以要跑几帧才看得到推进
      platform.pump(3, 16);

      const delta = game.run.crane.t - before;
      t.gt(delta, 0, '回来后应继续推进');
      t.assert(
        delta <= core.config.FEEL.maxFrameDt + 1e-6,
        `单帧逻辑推进不该超过 maxFrameDt（${core.config.FEEL.maxFrameDt}），实际 ${delta}`
      );
    } finally {
      platform.cleanup();
    }
  });

  t.test('长帧不会滚雪球：一次卡顿后逻辑只推进有限步数', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      platform.pump(3, 16);
      const before = game.run.crane.t;

      platform.pump(1, 5000); // 一帧耗时 5 秒
      const delta = game.run.crane.t - before;

      t.assert(
        delta <= core.config.FEEL.maxFrameDt + 1e-6,
        `长帧应被钳制到 maxFrameDt，实际推进 ${delta}`
      );
      // 钳制后仍要继续能跑
      t.gt(platform.pump(10, 16), 0, '主循环不该因此停摆');
    } finally {
      platform.cleanup();
    }
  });

  t.test('宿主没有 Web Audio 时静默降级，游戏照常能玩', () => {
    const launched = launch({ withoutAudio: true });
    const platform = launched.platform;
    const game = launched.game;
    try {
      t.assert(game !== null, '没有音频能力也应能启动');
      t.eq(game.env.available, true, '环境仍应可用');
      t.eq(game.run.phase, core.run.PHASE.SWINGING, '局面应正常建立');

      platform.touch(PLAY_AREA.x, PLAY_AREA.y);
      platform.pump(120, 16);
      t.eq(core.run.floorCount(game.run), 1, '没有音效也应能正常游玩');
      t.eq(platform.stub.problems.length, 0, '不应产生非法绘制');
    } finally {
      platform.cleanup();
    }
  });

  t.test('有 Web Audio 时，松手与终局会真的发出声音', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      platform.touch(PLAY_AREA.x, PLAY_AREA.y);
      // 事件要等主循环 drain 之后才会被消费，所以必须先跑帧再断言
      platform.pump(2, 16);
      t.assert(
        platform.audioCalls.indexOf('osc.start') >= 0,
        `松手应真的启动振荡器，实际音频调用：${platform.audioCalls.join(' / ')}`
      );

      const before = platform.audioCalls.length;
      core.run.finishRun(game.run, core.run.ENDING.TOPPED_OUT);
      platform.pump(2, 16);
      t.gt(platform.audioCalls.length, before, '终局应发出收尾音');
    } finally {
      platform.cleanup();
    }
  });

  t.test('震动：完美落点轻震、失误中震、坍塌重震', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      // 完美落点
      core.run.landAt(game.run, core.tower.topCenterX(game.run.tower));
      platform.pump(1, 16);
      t.eq(platform.vibrations[platform.vibrations.length - 1], 'light', '完美落点应轻震');

      // 失误：偏差远超失误容差
      core.run.landAt(game.run, core.tower.topCenterX(game.run.tower) + 400);
      platform.pump(1, 16);
      t.eq(platform.vibrations[platform.vibrations.length - 1], 'medium', '失误应中震');

      // 坍塌
      core.run.finishRun(game.run, core.run.ENDING.COLLAPSED);
      platform.pump(1, 16);
      t.eq(platform.vibrations[platform.vibrations.length - 1], 'heavy', '坍塌应重震');
    } finally {
      platform.cleanup();
    }
  });

  t.test('关掉 VIBRATE.enabled 就真的不再震动（开关必须是真开关）', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    const saved = core.config.VIBRATE.enabled;
    try {
      core.config.VIBRATE.enabled = false;

      core.run.landAt(game.run, core.tower.topCenterX(game.run.tower));
      platform.pump(1, 16);
      core.run.landAt(game.run, core.tower.topCenterX(game.run.tower) + 400);
      platform.pump(1, 16);
      core.run.finishRun(game.run, core.run.ENDING.COLLAPSED);
      platform.pump(1, 16);

      t.eq(platform.vibrations.length, 0, '开关关掉后不该有任何一次震动');
    } finally {
      core.config.VIBRATE.enabled = saved;
      platform.cleanup();
    }
  });

  t.test('重开一局会清掉上一局的动画残留', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      platform.touch(PLAY_AREA.x, PLAY_AREA.y);
      platform.pump(120, 16);
      t.eq(core.run.floorCount(game.run), 1, '先建起一层');

      // 进入终局并以程序方式重开
      core.run.finishRun(game.run, core.run.ENDING.TOPPED_OUT);
      platform.pump(2, 16);
      const vp = makeViewport();
      const box = overlayMod.layout(vp, { ended: true, ending: game.run.ending });
      platform.touch(box.primary.x + box.primary.w / 2, box.primary.y + box.primary.h / 2);

      t.eq(game.presenter.squashIndex, -1, '压扁目标应复位');
      t.eq(game.presenter.flash, null, '判定闪烁应复位');
      t.eq(game.presenter.shakeTimer, 0, '抖动应复位');
      t.eq(game.presenter.endReveal, 0, '结算面板渐入应复位');
    } finally {
      platform.cleanup();
    }
  });

  t.test('连跑 600 帧（约 10 秒）不产生任何非法绘制参数', () => {
    const launched = launch();
    const platform = launched.platform;
    const game = launched.game;
    try {
      for (let i = 0; i < 600; i += 1) {
        // 每 20 帧尝试投一次，制造真实的投放节奏
        if (i % 20 === 0) platform.touch(PLAY_AREA.x, PLAY_AREA.y);
        platform.stub.reset();
        platform.pump(1, 16);
        t.eq(
          platform.stub.problems.length,
          0,
          `第 ${i} 帧出现非法绘制：${platform.stub.problems.join(' | ')}`
        );
        t.eq(platform.stub.stackDepth(), 0, `第 ${i} 帧 save/restore 未配对`);
      }
      t.gt(core.run.floorCount(game.run), 0, '10 秒内应至少建起一层');
    } finally {
      platform.cleanup();
    }
  });
};
