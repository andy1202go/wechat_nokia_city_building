/**
 * 渲染层测试。
 *
 * 分三段：
 *   1. 视口与摄像机 —— 纯函数，可精确断言
 *   2. 表现层动画   —— 纯状态推进，可精确断言
 *   3. 渲染链烟囱   —— 用 Canvas 桩把 render() 真实跑一遍，抓异常与 NaN
 *
 * 第 3 段是这个文件存在的主要理由：渲染层依赖 Canvas，在 Node 下原本完全不可测，
 * 而这正是最容易「写完看着对、一开模拟器就炸」的地方。
 */
const h = require('./harness');
const core = require('../js/core');
const helpers = require('./helpers');
const { createStubCanvas } = require('./canvas-stub');

const viewport = require('../js/render/viewport');
const presenterMod = require('../js/render/presenter');
const sceneMod = require('../js/render/scene');
const drawMod = require('../js/render/draw');
const towerView = require('../js/render/towerView');
const hudMod = require('../js/render/hud');
const overlayMod = require('../js/render/overlay');
const renderMod = require('../js/render');
const palette = require('../js/render/palette');

const METRICS = { width: 375, height: 667, safeTop: 20, safeBottom: 0 };

/** 组装一套渲染所需的对象。 */
function makeStage(options) {
  const opt = options || {};
  const cfg = opt.cfg || core.config;
  const run = opt.run || core.run.createRun(cfg);
  const stub = createStubCanvas(opt.canvas || {});
  const vp = viewport.createViewport(opt.metrics || METRICS, cfg);
  const presenter = presenterMod.createPresenter();
  const scene = sceneMod.createScene(cfg);
  return {
    cfg: cfg,
    run: run,
    stub: stub,
    ctx: stub.ctx,
    vp: vp,
    presenter: presenter,
    scene: scene
  };
}

/** 与 js/game.js 的 buildUi 保持一致的面板数据。 */
function buildUi(run, options) {
  const opt = options || {};
  return {
    paused: !!opt.paused,
    ended: core.run.isEnded(run),
    ending: run.ending,
    floors: core.run.floorCount(run),
    population: core.run.population(run),
    comboBest: run.combo.best,
    score: run.score,
    bestScore: opt.bestScore === undefined ? 0 : opt.bestScore,
    isNewBest: !!opt.isNewBest
  };
}

function draw(stage, options) {
  const ui = buildUi(stage.run, options);
  return renderMod.render(
    stage.ctx,
    stage.run,
    stage.vp,
    stage.presenter,
    stage.scene,
    stage.cfg,
    ui,
    palette
  );
}

/** 把某一帧里所有被绘制的文字收集起来，用于断言文案确实出现了。 */
function drawnTexts(stub) {
  return stub.argsOf('fillText').map(function (args) {
    return String(args[0]);
  });
}

/** 烟囱测试的公共收尾断言：没有异常还不够，坐标必须全部有限、栈必须配对。 */
function assertClean(stub, label) {
  h.eq(stub.problems.length, 0, `${label}：出现非法绘制参数 -> ${stub.problems.join(' | ')}`);
  h.eq(stub.stackDepth(), 0, `${label}：save/restore 未配对，多余 ${stub.stackDepth()} 层`);
}

/** 建一座指定层数的塔，全部用完美落点，避免中途触发终局。 */
function buildTower(run, cfg, floors, offsets) {
  const pattern = offsets || [0];
  let built = 0;
  let guard = 0;
  while (built < floors && guard < floors * 8) {
    const before = core.run.floorCount(run);
    helpers.dropAtOffset(run, pattern[built % pattern.length]);
    if (core.run.floorCount(run) > before) built += 1;
    guard += 1;
    if (core.run.isEnded(run)) break;
  }
  core.run.drainEvents(run);
  return built;
}

module.exports = function register(t) {
  // ------------------------------------------------------------------
  t.section('viewport · 视口与摄像机');
  // ------------------------------------------------------------------

  t.test('世界坐标与屏幕坐标互为逆变换', () => {
    const stage = makeStage();
    const x = 187.5;
    t.close(viewport.screenXToWorld(stage.vp, viewport.worldX(stage.vp, x)), x, 1e-9, 'x 往返');
    t.close(viewport.worldX(stage.vp, x), x, 1e-9, '1:1 设备上世界单位即逻辑像素');
  });

  t.test('世界 y 向上为正，屏幕 y 向下为正', () => {
    const stage = makeStage();
    const ground = viewport.worldY(stage.vp, 0);
    const higher = viewport.worldY(stage.vp, 100);
    t.lt(higher, ground, '世界 y 越大，屏幕 y 越小（越高）');
  });

  t.test('初始视角把地面放在屏幕内', () => {
    const stage = makeStage();
    t.eq(stage.vp.camY, stage.cfg.WORLD.groundBaselineOffset, '初始 camY 取基线偏移');
    // height - (0 - (-80)) * 1 = 667 - 80 = 587
    t.close(viewport.worldY(stage.vp, 0), 587, 1e-9, '地面屏幕 y');
  });

  t.test('可见世界高度等于屏幕高度除以缩放', () => {
    const stage = makeStage();
    t.close(viewport.visibleWorldHeight(stage.vp), 667, 1e-9, '1:1 时等于屏幕高度');
    const wide = makeStage({ metrics: { width: 750, height: 667, safeTop: 0, safeBottom: 0 } });
    t.close(viewport.visibleWorldHeight(wide.vp), 667 / 2, 1e-9, '2 倍宽时可见世界高度减半');
  });

  t.test('空局面时摄像机不动（初始视角就是目标视角）', () => {
    const stage = makeStage();
    t.eq(
      viewport.cameraTarget(stage.vp, stage.run, stage.cfg),
      stage.cfg.WORLD.groundBaselineOffset,
      '塔还没长高，目标就是基线'
    );
  });

  t.test('塔长高后摄像机目标上升，且塔顶与吊车都留在屏幕内', () => {
    const stage = makeStage();
    const before = viewport.cameraTarget(stage.vp, stage.run, stage.cfg);
    buildTower(stage.run, stage.cfg, 30);
    viewport.snapCamera(stage.vp, stage.run, stage.cfg);
    const after = viewport.cameraTarget(stage.vp, stage.run, stage.cfg);

    t.gt(after, before, '摄像机应随塔升高');

    const topY = core.tower.topY(stage.run.tower, stage.cfg);
    const topScreenY = viewport.worldY(stage.vp, topY);
    const pivotScreenY = viewport.worldY(stage.vp, topY + stage.cfg.CRANE.pivotHeightAboveTop);

    t.gt(topScreenY, 0, '塔顶不能跑到屏幕上方之外');
    t.lt(topScreenY, METRICS.height, '塔顶必须在屏幕内');
    t.gt(pivotScreenY, 0, '吊车吊点必须在屏幕内（否则玩家看不见吊车）');
    t.lt(pivotScreenY, topScreenY, '吊点在塔顶上方');
  });

  t.test('摄像机用指数逼近，不会一步跳到位也不会越过目标', () => {
    const stage = makeStage();
    buildTower(stage.run, stage.cfg, 20);
    const target = viewport.cameraTarget(stage.vp, stage.run, stage.cfg);
    const start = stage.vp.camY;

    viewport.updateCamera(stage.vp, stage.run, stage.cfg, 1 / 60);
    const afterOneFrame = stage.vp.camY;
    t.gt(afterOneFrame, start, '应朝目标移动');
    t.lt(afterOneFrame, target, '单帧不该一步到位');

    for (let i = 0; i < 600; i += 1) viewport.updateCamera(stage.vp, stage.run, stage.cfg, 1 / 60);
    t.close(stage.vp.camY, target, 0.5, '足够长时间后应收敛到目标');
    t.lt(stage.vp.camY, target + 1e-6, '不能越过目标（无过冲）');
  });

  t.test('snapCamera 立即对齐目标（重开一局不让镜头滑过来）', () => {
    const stage = makeStage();
    buildTower(stage.run, stage.cfg, 25);
    const target = viewport.cameraTarget(stage.vp, stage.run, stage.cfg);
    viewport.snapCamera(stage.vp, stage.run, stage.cfg);
    t.close(stage.vp.camY, target, 1e-9, '应与目标完全一致');
  });

  // ------------------------------------------------------------------
  t.section('presenter · 表现层动画状态');
  // ------------------------------------------------------------------

  t.test('单层落地：压扁动画绑到刚落下的那一层索引上', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    buildTower(run, cfg, 3);
    const presenter = presenterMod.createPresenter();

    helpers.dropAtOffset(run, 0);
    const events = core.run.drainEvents(run);
    t.eq(events.length, 1, '应有一条落地事件');
    t.eq(events[0].floorAdded, true, '完美落点应加楼层');

    presenterMod.consumeEvents(presenter, events, run, cfg);
    t.eq(core.run.floorCount(run), 4, '塔应有 4 层');
    t.eq(presenter.squashIndex, 3, '压扁的是索引 3（第 4 层）');
    t.gt(presenter.squashTimer, 0, '压扁计时应启动');
  });

  t.test('同批次多层落地：索引逐个递增，最后停在最高那层', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    buildTower(run, cfg, 2);
    const presenter = presenterMod.createPresenter();

    // 一帧内连落三层（帧率抖动时的真实情形）
    helpers.dropAtOffset(run, 0);
    helpers.dropAtOffset(run, 0);
    helpers.dropAtOffset(run, 0);
    const events = core.run.drainEvents(run);
    t.eq(events.length, 3, '应有三条落地事件');

    presenterMod.consumeEvents(presenter, events, run, cfg);
    t.eq(core.run.floorCount(run), 5, '塔应有 5 层');
    t.eq(presenter.squashIndex, 4, '最后压的是索引 4（第 5 层）');
  });

  t.test('失误落地不产生压扁，但触发闪烁与画面抖动', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    buildTower(run, cfg, 3);
    const presenter = presenterMod.createPresenter();

    helpers.dropAtOffset(run, 0);
    presenterMod.consumeEvents(presenter, core.run.drainEvents(run), run, cfg);
    const stableIndex = presenter.squashIndex;

    // 偏差远超失误容差（64 * 0.5 = 32），必定失误
    helpers.dropAtOffset(run, 200);
    const events = core.run.drainEvents(run);
    t.eq(events[0].verdict, 'miss', '偏差 200 应判为失误');
    t.eq(events[0].floorAdded, false, '失误不加楼层');

    presenter.flash = null;
    presenter.shakeTimer = 0;
    presenterMod.consumeEvents(presenter, events, run, cfg);

    t.eq(presenter.squashIndex, stableIndex, '失误不该改动压扁目标（楼层没变）');
    t.assert(presenter.flash && presenter.flash.verdict === 'miss', '应有一次失误闪烁');
    t.gt(presenter.shakeTimer, 0, '应触发画面抖动');
  });

  t.test('完美落点触发连击弹跳', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const presenter = presenterMod.createPresenter();

    helpers.dropAtOffset(run, 0);
    presenterMod.consumeEvents(presenter, core.run.drainEvents(run), run, cfg);
    t.gt(presenter.comboPop, 0, '完美落点应弹跳');
  });

  t.test('坍塌终局的画面抖动明显更长', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const presenter = presenterMod.createPresenter();

    presenterMod.consumeEvents(
      presenter,
      [{ type: 'end', ending: core.run.ENDING.COLLAPSED, score: 100 }],
      run,
      cfg
    );
    t.close(
      presenter.shakeTimer,
      cfg.VISUAL.missShakeSec * 2.2,
      1e-9,
      '坍塌抖动时长'
    );
    t.eq(presenter.endReveal, 0, '结算面板从透明开始渐入');

    const other = presenterMod.createPresenter();
    presenterMod.consumeEvents(
      other,
      [{ type: 'end', ending: core.run.ENDING.TOPPED_OUT, score: 100 }],
      run,
      cfg
    );
    t.eq(other.shakeTimer, 0, '封顶不抖动 —— 塔还站着，不该演成失败');
  });

  t.test('坍塌才启动倒塌演出，封顶不启动（塔还站着）', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);

    const fresh = presenterMod.createPresenter();
    t.eq(fresh.collapseT, -1, '未坍塌时用负数表示「未启动」');
    t.eq(presenterMod.collapseTilt(fresh, cfg, 1), 0, '未坍塌不应有任何倒塌角');

    const collapsed = presenterMod.createPresenter();
    presenterMod.consumeEvents(
      collapsed,
      [{ type: 'end', ending: core.run.ENDING.COLLAPSED, score: 100 }],
      run,
      cfg
    );
    t.eq(collapsed.collapseT, 0, '坍塌事件应清零倒塌计时，从而启动演出');

    const topped = presenterMod.createPresenter();
    presenterMod.consumeEvents(
      topped,
      [{ type: 'end', ending: core.run.ENDING.TOPPED_OUT, score: 100 }],
      run,
      cfg
    );
    t.eq(topped.collapseT, -1, '封顶不该启动倒塌');
    t.eq(presenterMod.collapseTilt(topped, cfg, 1), 0, '封顶时零倒塌角');
  });

  t.test('倒塌方向跟着偏心走，且符号对称', () => {
    const cfg = core.config;
    const presenter = presenterMod.createPresenter();
    presenter.collapseT = cfg.VISUAL.collapseSec; // 直接跳到倒稳

    const right = presenterMod.collapseTilt(presenter, cfg, 1);
    const left = presenterMod.collapseTilt(presenter, cfg, -1);

    t.gt(right, 0, '向 +x 侧倒应为正角（canvas 正角度为顺时针）');
    t.close(left, -right, 1e-9, '向 -x 侧倒应为等量的负角');
    t.eq(presenterMod.collapseTilt(presenter, cfg, 0), right, '符号为 0 时按 +x 侧处理，不能变成 0 角');
  });

  t.test('倒塌角单调增大，倒到配置角度后停住不再倾下去', () => {
    const cfg = core.config;
    const presenter = presenterMod.createPresenter();
    presenter.collapseT = 0;

    const step = cfg.VISUAL.collapseSec / 10;
    let previous = -1;
    for (let i = 0; i < 40; i += 1) {
      presenterMod.advancePresenter(presenter, step, cfg);
      const tilt = presenterMod.collapseTilt(presenter, cfg, 1);
      t.assert(tilt >= previous - 1e-12, `倒塌角不应回退（第 ${i} 步：${tilt} < ${previous}）`);
      previous = tilt;
    }

    const full = (cfg.VISUAL.collapseSweepDeg * Math.PI) / 180;
    t.close(previous, full, 1e-9, '最终应恰好倒到配置的角度');

    // 倒稳之后继续推进很久，必须停在原地 —— 否则塔会一直转下去
    for (let i = 0; i < 100; i += 1) presenterMod.advancePresenter(presenter, 0.5, cfg);
    t.close(presenterMod.collapseTilt(presenter, cfg, 1), full, 1e-9, '倒稳后必须停住');
  });

  t.test('零时长不产生 Infinity（除零保护）', () => {
    const cfg = helpers.cloneConfig(core.config);
    cfg.VISUAL.collapseSec = 0;

    const presenter = presenterMod.createPresenter();
    presenter.collapseT = 0;

    const tilt = presenterMod.collapseTilt(presenter, cfg, 1);
    t.assert(Number.isFinite(tilt), `时长为 0 时必须给出有限值，实际 ${tilt}`);

    const full = (cfg.VISUAL.collapseSweepDeg * Math.PI) / 180;
    t.close(tilt, full, 1e-9, '没有时长即瞬间倒满');
  });

  t.test('advancePresenter 推进计时并让面板渐入到 1', () => {
    const cfg = core.config;
    const presenter = presenterMod.createPresenter();
    presenter.flash = { verdict: 'perfect', timer: 0.02 };
    presenter.squashTimer = 0.05;

    presenterMod.advancePresenter(presenter, 0.01, cfg);
    t.gt(presenter.t, 0, '累计时间应推进');
    t.gt(presenter.squashTimer, 0, '0.05 减 0.01 还有余');
    t.assert(presenter.flash !== null, '闪烁还没结束');

    for (let i = 0; i < 20; i += 1) presenterMod.advancePresenter(presenter, 0.05, cfg);
    t.eq(presenter.squashTimer, 0, '压扁计时归零');
    t.eq(presenter.flash, null, '闪烁结束即清除');
    t.eq(presenter.endReveal, 1, '渐入封顶在 1');
    t.gt(presenter.squashTimer, -1e-9, '计时不应为负');
  });

  t.test('压扁只作用于被标记的那一层', () => {
    const cfg = core.config;
    const presenter = presenterMod.createPresenter();
    presenter.squashIndex = 3;
    presenter.squashTimer = cfg.VISUAL.landingSquashSec;

    t.close(presenterMod.squashScale(presenter, 3, cfg), 1 - cfg.VISUAL.landingSquash, 1e-9, '刚落地压到最扁');
    t.eq(presenterMod.squashScale(presenter, 2, cfg), 1, '相邻楼层不受影响');
    t.eq(presenterMod.squashScale(presenter, 4, cfg), 1, '相邻楼层不受影响');

    presenter.squashTimer = 0;
    t.eq(presenterMod.squashScale(presenter, 3, cfg), 1, '计时结束后完全复原');
  });

  t.test('抖动在计时结束后精确归零', () => {
    const cfg = core.config;
    const presenter = presenterMod.createPresenter();
    t.eq(presenterMod.shakeOffset(presenter, cfg).x, 0, '默认不抖');

    presenter.shakeTimer = cfg.VISUAL.missShakeSec;
    const peak = presenterMod.shakeOffset(presenter, cfg);
    t.assert(Number.isFinite(peak.x) && Number.isFinite(peak.y), '抖动位移必须有限');
    t.assert(Math.abs(peak.x) <= cfg.VISUAL.missShakePx + 1e-9, '抖动幅度不超过配置上限');

    presenter.shakeTimer = 0;
    const stopped = presenterMod.shakeOffset(presenter, cfg);
    t.eq(stopped.x, 0, '停止后横向归零');
    t.eq(stopped.y, 0, '停止后纵向归零');
  });

  t.test('resetPresenter 把全部动画状态复位', () => {
    const presenter = presenterMod.createPresenter();
    presenter.t = 12;
    presenter.squashIndex = 7;
    presenter.squashTimer = 1;
    presenter.flash = { verdict: 'miss', timer: 1 };
    presenter.comboPop = 1;
    presenter.shakeTimer = 1;
    presenter.endReveal = 1;
    presenter.collapseT = 0.4;

    presenterMod.resetPresenter(presenter);
    t.eq(presenter.t, 0, '时间');
    t.eq(presenter.squashIndex, -1, '压扁目标');
    t.eq(presenter.squashTimer, 0, '压扁计时');
    t.eq(presenter.flash, null, '闪烁');
    t.eq(presenter.comboPop, 0, '连击弹跳');
    t.eq(presenter.shakeTimer, 0, '抖动');
    t.eq(presenter.endReveal, 0, '面板渐入');
    t.eq(presenter.collapseT, -1, '倒塌进度（必须回到「未坍塌」）');
  });

  t.test('consumeEvents 对空事件与缺省 run 都安全', () => {
    const presenter = presenterMod.createPresenter();
    presenterMod.consumeEvents(presenter, [], null, core.config);
    presenterMod.consumeEvents(presenter, null, null, core.config);
    t.eq(presenter.squashIndex, -1, '不该产生任何副作用');
  });

  // ------------------------------------------------------------------
  t.section('render · 渲染链烟囱');
  // ------------------------------------------------------------------

  t.test('空局面：整条渲染链跑通且坐标全部有限', () => {
    const stage = makeStage();
    draw(stage);
    assertClean(stage.stub, '空局面');
    t.gt(stage.stub.countOf('fillText'), 0, '应绘制了 HUD 文字');
    t.gt(stage.stub.countOf('fillRect') + stage.stub.countOf('fill'), 0, '应绘制了图元');
    t.eq(stage.stub.countOf('clearRect'), 1, '每帧应先清屏一次');
  });

  t.test('建了 30 层的高塔：渲染不炸，楼层与金色压顶都画出来', () => {
    const stage = makeStage();
    const built = buildTower(stage.run, stage.cfg, 30);
    t.eq(built, 30, '应建满 30 层');

    draw(stage);
    assertClean(stage.stub, '高塔');

    const texts = drawnTexts(stage.stub);
    t.assert(
      texts.indexOf('30') >= 0,
      `HUD 应显示当前高度 30 层，实际文字：${texts.join(' / ')}`
    );
    t.assert(
      texts.some((s) => s.indexOf('人口') === 0),
      'HUD 应显示人口'
    );
    t.assert(
      texts.indexOf('重心') >= 0,
      '应画出水准泡的「重心」标签（ADR-0003 明确要求偏心可见）'
    );
  });

  t.test('完美落点的楼层带上金色压顶，一般落点没有', () => {
    const cfg = core.config;

    // 偏差 0 -> 完美落点
    const perfectRun = core.run.createRun(cfg);
    const perfectStage = makeStage({ cfg: cfg, run: perfectRun });
    buildTower(perfectRun, cfg, 2);
    t.eq(perfectRun.tower.floors[0].verdict, 'perfect', '偏差 0 应判为完美落点');

    perfectStage.stub.reset();
    draw(perfectStage);
    assertClean(perfectStage.stub, '完美落点');
    t.eq(
      perfectStage.stub.usedColor(palette.perfectCap),
      true,
      '完美落点的楼层顶面应画一道金色'
    );

    // 偏差 20 -> 一般落点（完美容差 11.52，失误容差 32）
    const mixedRun = core.run.createRun(cfg);
    const mixedStage = makeStage({ cfg: cfg, run: mixedRun });
    buildTower(mixedRun, cfg, 2, [20, -20]);
    t.eq(mixedRun.tower.floors[0].verdict, 'imperfect', '偏差 20 应判为一般落点');

    mixedStage.stub.reset();
    draw(mixedStage);
    assertClean(mixedStage.stub, '一般落点');
    t.eq(
      mixedStage.stub.usedColor(palette.perfectCap),
      false,
      '一般落点不该有金色压顶 —— 否则「精准」就没有即时反馈了'
    );
  });

  t.test('吊车在下落途中也能渲染（下落拉伸分支）', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });

    t.eq(core.run.canDrop(run), true, '初始可投放');
    core.run.requestDrop(run);
    t.eq(run.phase, core.run.PHASE.DROPPING, '应进入下落阶段');

    // 推进到下落中段
    for (let i = 0; i < 6; i += 1) core.run.update(run, cfg.FEEL.fixedDt);
    t.eq(run.phase, core.run.PHASE.DROPPING, '半空中');

    draw(stage);
    assertClean(stage.stub, '下落中');
    t.gt(stage.stub.countOf('arcTo'), 0, '吊钩由圆角图元绘成');
  });

  t.test('新手引导：开局显示，建到阈值层数后消失', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });

    draw(stage);
    const fresh = drawnTexts(stage.stub);
    t.assert(
      fresh.some((s) => s.indexOf('投放楼层') >= 0),
      `开局应显示操作引导，实际：${fresh.join(' / ')}`
    );

    buildTower(run, cfg, cfg.TUTORIAL.minFloorsToHide);
    stage.stub.reset();
    draw(stage);
    const later = drawnTexts(stage.stub);
    t.assert(
      !later.some((s) => s.indexOf('投放楼层') >= 0),
      '建够层数后引导应隐藏'
    );
  });

  t.test('暂停面板：绘出遮罩、标题与两个按钮', () => {
    const stage = makeStage();
    buildTower(stage.run, stage.cfg, 5);
    stage.stub.reset();
    draw(stage, { paused: true });

    assertClean(stage.stub, '暂停面板');
    const texts = drawnTexts(stage.stub);
    t.assert(texts.indexOf('已暂停') >= 0, `应显示暂停标题，实际：${texts.join(' / ')}`);
    t.assert(texts.indexOf('继续建造') >= 0, '应有继续按钮');
    t.assert(texts.indexOf('重新开始') >= 0, '应有重开按钮');
  });

  t.test('结算面板（坍塌）：文案必须让玩家看出塔倒了', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });
    buildTower(run, cfg, 6);

    core.run.finishRun(run, core.run.ENDING.COLLAPSED);
    t.eq(core.run.isEnded(run), true, '应已终局');

    stage.stub.reset();
    stage.presenter.endReveal = 1; // 跳过渐入，直接看最终帧
    draw(stage);

    assertClean(stage.stub, '坍塌结算');
    const texts = drawnTexts(stage.stub);
    t.assert(texts.indexOf('塔倒了') >= 0, `坍塌标题，实际：${texts.join(' / ')}`);
    t.assert(texts.indexOf('再来一局') >= 0, '应有重开按钮');
    t.assert(
      texts.some((s) => s.indexOf('重心偏出地基') >= 0),
      '应解释坍塌原因'
    );
    t.eq(stage.presenter.shakeTimer, 0, '本例未经事件队列，不抖动（仅验证渲染）');
  });

  t.test('结算面板（封顶）：文案与坍塌必须能一眼区分', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });
    buildTower(run, cfg, 6);

    core.run.finishRun(run, core.run.ENDING.TOPPED_OUT);
    stage.stub.reset();
    stage.presenter.endReveal = 1;
    draw(stage);

    assertClean(stage.stub, '封顶结算');
    const texts = drawnTexts(stage.stub);
    t.assert(texts.indexOf('封顶') >= 0, `封顶标题，实际：${texts.join(' / ')}`);
    t.assert(texts.indexOf('塔倒了') < 0, '封顶不该出现坍塌文案');
    t.assert(
      texts.some((s) => s.indexOf('塔还站着') >= 0),
      '必须说清塔还在（否则拆两个终局就白拆了）'
    );
  });

  t.test('结算面板区分「新纪录」与「最高分」', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });
    buildTower(run, cfg, 4);
    core.run.finishRun(run, core.run.ENDING.TOPPED_OUT);
    stage.presenter.endReveal = 1;

    stage.stub.reset();
    draw(stage, { bestScore: 777 });
    t.assert(
      drawnTexts(stage.stub).indexOf('最高分 777') >= 0,
      '未破纪录时显示历史最高分'
    );

    stage.stub.reset();
    draw(stage, { bestScore: 777, isNewBest: true });
    t.assert(drawnTexts(stage.stub).indexOf('新纪录！') >= 0, '破纪录时应改为新纪录');
  });

  t.test('画面抖动真的作用到了绘制变换上', () => {
    const stage = makeStage();
    buildTower(stage.run, stage.cfg, 4);
    const cfg = stage.cfg;

    stage.stub.reset();
    draw(stage);
    const stillTranslates = stage.stub.argsOf('translate');

    stage.presenter.shakeTimer = cfg.VISUAL.missShakeSec;
    stage.presenter.t = 0.01; // 让相位非零
    stage.stub.reset();
    draw(stage);
    const shakenTranslates = stage.stub.argsOf('translate');

    t.gt(shakenTranslates.length, 0, '应有一次包裹抖动的 translate');
    t.assert(
      Math.abs(shakenTranslates[0][0]) + Math.abs(shakenTranslates[0][1]) > 0,
      '抖动时位移不应为零'
    );
    t.eq(
      Math.abs(stillTranslates[0][0]),
      0,
      '未抖动时包裹层位移应为零'
    );
  });

  t.test('整塔以地基中心为原点绘制，并按派生倾角旋转', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });
    buildTower(run, cfg, 6, [0, 18]);
    t.gt(core.tower.eccentricity(run.tower), 0, '这座塔应有偏心');

    stage.presenter.t = 0; // 摇摆相位归零，把这层的位移隔离掉
    stage.stub.reset();
    draw(stage);
    assertClean(stage.stub, '偏心塔');

    const tower = run.tower;
    const expectOriginX = viewport.worldX(stage.vp, tower.foundationCenterX);
    const expectLean = core.tower.leanAngle(tower, cfg) * cfg.VISUAL.leanVisualGain;

    t.assert(
      stage.stub.argsOf('translate').some((args) => Math.abs(args[0] - expectOriginX) < 1e-9),
      `应以地基中心为原点平移（期望 x = ${expectOriginX}）`
    );
    t.assert(
      stage.stub.argsOf('rotate').some((args) => Math.abs(args[0] - expectLean) < 1e-9),
      `应按倾角旋转（期望 ${expectLean} 弧度）`
    );
    t.gt(Math.abs(expectLean), 0, '偏心塔的倾角应非零 —— 这是「要倒了」的预警');
  });

  t.test('坍塌：整塔绕地基边缘翻倒，倾倒侧底角不会扎进地面', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });

    // 造一座明显偏向 +x 侧的塔（五次落点逐次右移），再强制坍塌
    const offsets = [0, 8, 10, 12, 14];
    offsets.forEach((dx) => core.run.landAt(run, core.tower.topCenterX(run.tower) + dx));
    t.lt(core.tower.stabilityUsed(run.tower, cfg), 1, '构造的塔应还在稳定范围内');
    core.run.finishRun(run, core.run.ENDING.COLLAPSED);

    stage.presenter.t = 0; // 摇摆相位归零，隔离掉这层位移
    stage.presenter.collapseT = cfg.VISUAL.collapseSec; // 直接跳到倒稳

    stage.stub.reset();
    draw(stage);
    assertClean(stage.stub, '坍塌倒稳');

    const fallSign = core.tower.eccentricitySigned(run.tower) < 0 ? -1 : 1;
    t.eq(fallSign, 1, '本例的塔偏向 +x 侧');

    const sweep = presenterMod.collapseTilt(stage.presenter, cfg, fallSign);
    t.gt(sweep, 0, '倒稳时应有正的倒塌角');

    // 倒塌角必须真的作用到绘制变换上，否则就是「算了个数没人用」
    t.assert(
      stage.stub.argsOf('rotate').some((args) => Math.abs(args[0] - sweep) < 1e-9),
      `倒塌角应被用于整塔旋转（期望 ${sweep} 弧度）`
    );

    // 枢轴从补偿平移对 translate(p,0) / translate(-p,0) 里读出来
    const translates = stage.stub.argsOf('translate');
    let pivot = null;
    for (let i = 0; i < translates.length; i += 1) {
      const candidate = translates[i][0];
      if (translates[i][1] !== 0 || candidate === 0) continue;
      const paired = translates.some((other) => other[1] === 0 && Math.abs(other[0] + candidate) < 1e-9);
      if (paired) {
        pivot = candidate;
        break;
      }
    }
    t.assert(pivot !== null, '应存在一对绕枢轴的补偿平移（translate(p) / translate(-p)）');

    const halfWidth = (cfg.FOUNDATION.width / 2) * stage.vp.scale;
    t.close(pivot, fallSign * halfWidth, 1e-9, '枢轴必须落在倾倒那一侧的地基边缘');

    // 这条断言就是「枢轴选在边缘」的理由：绕中线转，倾倒侧的底角会沉到地面以下，
    // 看起来像整座塔陷进地里而不是倒下去。绕边缘转则该角恒在地面上。
    const edgeCornerY = (fallSign * halfWidth - pivot) * Math.sin(sweep);
    t.assert(edgeCornerY <= 1e-9, `倾倒侧底角不得低于地面（实际偏移 ${edgeCornerY}）`);
  });

  t.test('倒塌动画逐帧扫描：全程无非法绘制参数', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });

    buildTower(run, cfg, 8, [0, 6]);
    core.run.finishRun(run, core.run.ENDING.COLLAPSED);
    stage.presenter.collapseT = 0;

    // 覆盖倒塌全过程 + 倒稳之后若干帧（验证停住之后也稳）
    const frames = Math.ceil(cfg.VISUAL.collapseSec / cfg.FEEL.fixedDt) + 30;
    for (let frame = 0; frame < frames; frame += 1) {
      presenterMod.advancePresenter(stage.presenter, cfg.FEEL.fixedDt, cfg);
      viewport.updateCamera(stage.vp, run, cfg, cfg.FEEL.fixedDt);

      stage.stub.reset();
      draw(stage);
      assertClean(stage.stub, `坍塌第 ${frame} 帧`);
    }

    const full = (cfg.VISUAL.collapseSweepDeg * Math.PI) / 180;
    const fallSign = core.tower.eccentricitySigned(run.tower) < 0 ? -1 : 1;
    t.close(
      presenterMod.collapseTilt(stage.presenter, cfg, fallSign),
      fallSign * full,
      1e-9,
      '扫描结束时应已倒稳'
    );
  });

  t.test('视锥剔除：只剔屏幕外的楼层，不能把整座塔剃掉', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });
    buildTower(run, cfg, 30);
    viewport.snapCamera(stage.vp, run, cfg);

    let visible = 0;
    for (let i = 0; i < 30; i += 1) {
      if (towerView.isFloorVisible(stage.vp, i, cfg)) visible += 1;
    }

    t.gt(visible, 5, `摄像机跟随塔顶后应有相当数量的楼层可见，实际只有 ${visible} 层`);
    t.lt(visible, 30, `地面附近的低层此时应在屏幕外，实际可见 ${visible} 层`);
  });

  t.test('高塔的可见楼层确实被逐个绘制出来', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });
    buildTower(run, cfg, 30);
    viewport.snapCamera(stage.vp, run, cfg);

    let visible = 0;
    for (let i = 0; i < 30; i += 1) {
      if (towerView.isFloorVisible(stage.vp, i, cfg)) visible += 1;
    }

    stage.stub.reset();
    draw(stage);
    assertClean(stage.stub, '高塔逐层绘制');

    // 每层楼至少一个圆角矩形 = 4 次 arcTo，还要加上地基、吊车与 HUD
    t.gt(
      stage.stub.countOf('arcTo'),
      visible * 4,
      `可见 ${visible} 层，arcTo 调用应超过 ${visible * 4} 次`
    );
    // 每层 8 个窗格，全部走 fillRect
    t.assert(
      stage.stub.countOf('fillRect') >= visible * 8,
      `可见 ${visible} 层应画出至少 ${visible * 8} 个窗格，实际 fillRect 仅 ${stage.stub.countOf('fillRect')} 次`
    );
    // 彩色楼房：连续可见的楼层应当出现多种配色
    const colors = stage.stub.colorsUsed();
    let paletteHits = 0;
    palette.building.forEach((color) => {
      if (colors.indexOf(color) >= 0) paletteHits += 1;
    });
    t.gt(paletteHits, 1, `连续可见楼层应出现多种楼体配色，实际命中 ${paletteHits} 种`);
  });

  t.test('逐帧扫描 240 帧：全流程不产生任何非法绘制参数', () => {
    const cfg = core.config;
    const run = core.run.createRun(cfg);
    const stage = makeStage({ cfg: cfg, run: run });

    let landed = 0;
    for (let frame = 0; frame < 240; frame += 1) {
      // 只要可以投放就投，让物理自己走完 摆动 -> 下落 -> 落地 -> 停顿
      if (core.run.canDrop(run)) core.run.requestDrop(run);
      core.run.update(run, cfg.FEEL.fixedDt);

      const events = core.run.drainEvents(run);
      if (events.length) {
        presenterMod.consumeEvents(stage.presenter, events, run, cfg);
        for (let i = 0; i < events.length; i += 1) {
          if (events[i].type === 'land') landed += 1;
        }
      }
      viewport.updateCamera(stage.vp, run, cfg, cfg.FEEL.fixedDt);
      presenterMod.advancePresenter(stage.presenter, cfg.FEEL.fixedDt, cfg);

      stage.stub.reset();
      draw(stage);
      assertClean(stage.stub, `第 ${frame} 帧`);
    }

    t.gt(landed, 2, '应至少发生过几次落地 —— 否则等于没走到判定与压扁动画');
  });

  t.test('宿主缺少 setLineDash 时虚线退化为实线，不报错', () => {
    const stage = makeStage({ canvas: { withoutSetLineDash: true } });
    buildTower(stage.run, stage.cfg, 3);
    draw(stage);
    assertClean(stage.stub, '无 setLineDash');
    t.eq(stage.stub.countOf('setLineDash'), 0, '不该调用不存在的方法');
    t.gt(stage.stub.countOf('stroke'), 0, '仍应描边（退化成实线）');
  });

  t.test('小屏与大屏都能渲染，且 HUD 不越界', () => {
    const sizes = [
      { width: 320, height: 568, safeTop: 20, safeBottom: 0 },
      { width: 375, height: 667, safeTop: 44, safeBottom: 34 },
      { width: 414, height: 896, safeTop: 48, safeBottom: 34 },
      { width: 428, height: 926, safeTop: 59, safeBottom: 34 }
    ];

    sizes.forEach((metrics) => {
      const stage = makeStage({ metrics: metrics });
      buildTower(stage.run, stage.cfg, 12);
      draw(stage);
      assertClean(stage.stub, `${metrics.width}x${metrics.height}`);

      const texts = stage.stub.argsOf('fillText');
      texts.forEach((args) => {
        const x = args[1];
        t.assert(
          x >= -1 && x <= metrics.width + 1,
          `${metrics.width} 宽：文字绘制在水平范围外（x=${x}）`
        );
      });
    });
  });

  // ------------------------------------------------------------------
  t.section('render · 布点与命中');
  // ------------------------------------------------------------------

  t.test('HUD 布点：暂停按钮在右上、不越界，且能被点中', () => {
    const stage = makeStage();
    const box = hudMod.layout(stage.vp);

    t.gt(box.pause.x, stage.vp.width / 2, '暂停按钮在右半屏');
    t.assert(box.pause.x + box.pause.w <= stage.vp.width + 1e-9, '不超出右边界');
    t.gt(box.pause.y, stage.vp.safeTop - 1e-9, '落在安全区之下（不与状态栏重叠）');

    const cx = box.pause.x + box.pause.w / 2;
    const cy = box.pause.y + box.pause.h / 2;
    t.eq(hudMod.hitTest(stage.vp, cx, cy), 'pause', '中心点应命中');
    t.eq(hudMod.hitTest(stage.vp, 0, 0), null, '屏幕左上角不应命中暂停');
  });

  t.test('HUD 布点：水准泡在安全区内，且不压住暂停按钮', () => {
    const stage = makeStage();
    const box = hudMod.layout(stage.vp);
    t.assert(box.level.x >= 0 && box.level.x + box.level.w <= stage.vp.width + 1e-9, '水准泡水平不越界');
    t.gt(box.level.y, box.pause.y + box.pause.h, '水准泡在暂停按钮下方，互不遮挡');
  });

  t.test('结算面板：按钮在面板内部，且点击命中与布点一致', () => {
    const stage = makeStage();
    const run = stage.run;
    core.run.finishRun(run, core.run.ENDING.TOPPED_OUT);

    const ui = buildUi(run);
    const box = overlayMod.layout(stage.vp, ui);
    t.eq(box.kind, 'end', '终局应给出结算面板');

    const btn = box.primary;
    t.assert(btn.x >= box.panel.x, '按钮不超出面板左边界');
    t.assert(btn.x + btn.w <= box.panel.x + box.panel.w + 1e-9, '按钮不超出面板右边界');
    t.assert(btn.y + btn.h <= box.panel.y + box.panel.h + 1e-9, '按钮不超出面板下边界');
    t.assert(box.panel.y >= stage.vp.safeTop, '面板不进入状态栏');
    t.gt(
      btn.y,
      stage.vp.height / 2,
      '重开按钮必须落在屏幕下半部分 —— 否则结算瞬间的连点会立刻重开，玩家看不到得分'
    );

    t.eq(
      overlayMod.hitTest(stage.vp, btn.x + btn.w / 2, btn.y + btn.h / 2, ui),
      'restart',
      '按钮中心应命中重开'
    );
    t.eq(overlayMod.hitTest(stage.vp, 0, 0, ui), null, '面板外不应命中');
  });

  t.test('暂停面板：两个按钮互不重叠，命中各归其位', () => {
    const stage = makeStage();
    const ui = buildUi(stage.run, { paused: true });
    const box = overlayMod.layout(stage.vp, ui);

    t.eq(box.kind, 'pause', '暂停应给出暂停面板');
    t.assert(
      box.secondary.y + box.secondary.h <= box.primary.y + 1e-9,
      '两个按钮不该重叠'
    );

    const centerOf = (rect) => [rect.x + rect.w / 2, rect.y + rect.h / 2];
    const primary = centerOf(box.primary);
    const secondary = centerOf(box.secondary);
    t.eq(overlayMod.hitTest(stage.vp, primary[0], primary[1], ui), 'resume', '主按钮=继续');
    t.eq(overlayMod.hitTest(stage.vp, secondary[0], secondary[1], ui), 'restart', '次按钮=重开');
  });

  t.test('终局与暂停同时成立时，结算面板优先', () => {
    const stage = makeStage();
    core.run.finishRun(stage.run, core.run.ENDING.COLLAPSED);
    const ui = buildUi(stage.run, { paused: true });
    t.eq(overlayMod.layout(stage.vp, ui).kind, 'end', '结算优先于暂停');
  });

  t.test('没有终局也没有暂停时，覆盖层不画面板', () => {
    const stage = makeStage();
    const ui = buildUi(stage.run);
    t.eq(overlayMod.layout(stage.vp, ui).kind, null, '不该有面板');
    t.eq(overlayMod.hitTest(stage.vp, 100, 100, ui), null, '不该拦住点击');
  });

  // ------------------------------------------------------------------
  t.section('draw · 绘制工具');
  // ------------------------------------------------------------------

  t.test('圆角矩形的半径被钳制，负半径不会传给 arcTo', () => {
    const stub = createStubCanvas();
    drawMod.roundRectPath(stub.ctx, 10, 10, 40, 20, -5);
    assertClean(stub, '负半径');
    t.eq(stub.countOf('arcTo'), 4, '四个圆角');
  });

  t.test('圆角矩形半径不超过短边一半', () => {
    const stub = createStubCanvas();
    drawMod.roundRectPath(stub.ctx, 0, 0, 40, 20, 999);
    assertClean(stub, '超大半径');
    stub.argsOf('arcTo').forEach((args) => {
      t.assert(args[4] <= 10 + 1e-9, `半径应被钳到短边一半，实际 ${args[4]}`);
    });
  });

  t.test('文字工具按字号与字重拼装 font，并正确设置对齐', () => {
    const stub = createStubCanvas();
    drawMod.text(stub.ctx, '封顶', 100, 50, { size: 26, weight: 500, align: 'center', color: '#fff' });
    t.eq(stub.ctx.font, '500 26px sans-serif', 'font 拼装');
    t.eq(stub.ctx.textAlign, 'center', '对齐方式');
    t.eq(stub.ctx.fillStyle, '#fff', '填充色');
    t.eq(stub.countOf('fillText'), 1, '绘制一次');
  });

  t.test('文字带描边阴影时绘制两次', () => {
    const stub = createStubCanvas();
    drawMod.text(stub.ctx, '新纪录！', 10, 10, { shadow: 'rgba(0,0,0,0.5)' });
    t.eq(stub.countOf('fillText'), 2, '一次阴影、一次正文');
  });

  t.test('measure 返回与字号成比例的宽度', () => {
    const stub = createStubCanvas();
    const small = drawMod.measure(stub.ctx, '连击 x10', { size: 10 });
    const large = drawMod.measure(stub.ctx, '连击 x10', { size: 20 });
    t.gt(small, 0, '宽度应大于零');
    t.close(large, small * 2, 1e-9, '宽度与字号成正比');
  });

  t.test('verticalGradient 生成渐变并逐个下色标', () => {
    const stub = createStubCanvas();
    const gradient = drawMod.verticalGradient(stub.ctx, 0, 0, 100, [
      [0, '#3E7CC4'],
      [1, '#DCEFF8']
    ]);
    t.eq(typeof gradient.addColorStop, 'function', '返回渐变对象');
    t.eq(stub.countOf('createLinearGradient'), 1, '创建一次渐变');
    t.eq(stub.countOf('addColorStop'), 2, '两个色标');
  });

  t.test('riskColor 随风险单调升级：安全 -> 警告 -> 危险', () => {
    t.eq(drawMod.riskColor(palette, 0), palette.hud.safe, '低风险');
    t.eq(drawMod.riskColor(palette, 0.5), palette.hud.safe, '仍安全');
    t.eq(drawMod.riskColor(palette, 0.6), palette.hud.warn, '进入警告');
    t.eq(drawMod.riskColor(palette, 0.8), palette.hud.danger, '进入危险');
    t.eq(drawMod.riskColor(palette, 1), palette.hud.danger, '满风险');
  });

  t.test('easeOutCubic 端点为 0/1，且越界输入被钳制', () => {
    t.eq(drawMod.easeOutCubic(0), 0, '起点');
    t.eq(drawMod.easeOutCubic(1), 1, '终点');
    t.eq(drawMod.easeOutCubic(-3), 0, '下越界');
    t.eq(drawMod.easeOutCubic(9), 1, '上越界');
    const mid = drawMod.easeOutCubic(0.5);
    t.gt(mid, 0.5, '中途应快于线性（缓出）');
  });

  t.test('clamp 与 lerp 的边界行为', () => {
    t.eq(drawMod.clamp(5, 0, 10), 5, '区间内不变');
    t.eq(drawMod.clamp(-5, 0, 10), 0, '下界');
    t.eq(drawMod.clamp(15, 0, 10), 10, '上界');
    t.eq(drawMod.lerp(0, 10, 0), 0, 't=0');
    t.eq(drawMod.lerp(0, 10, 1), 10, 't=1');
    t.eq(drawMod.lerp(0, 10, 0.25), 2.5, 't=0.25');
  });

  t.test('终局文案按结局分流，且两个标题不相同', () => {
    const collapsed = overlayMod.endingCopy(core.run.ENDING.COLLAPSED);
    const topped = overlayMod.endingCopy(core.run.ENDING.TOPPED_OUT);
    t.eq(collapsed.title, '塔倒了', '坍塌标题');
    t.eq(topped.title, '封顶', '封顶标题');
    t.assert(collapsed.title !== topped.title, '两个终局必须能一眼区分');
    t.assert(collapsed.accent !== topped.accent, '配色也应不同（红 vs 金）');
  });
};
