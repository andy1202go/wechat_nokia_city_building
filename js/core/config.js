/**
 * 全部手感参数集中在这里。这是唯一需要调参的文件。
 *
 * 坐标系约定
 *   世界宽度固定 WORLD.width 个逻辑单位，高度按设备长宽比自适应。
 *   世界原点在地面中线：x 向右为正、范围 [0, WORLD.width]；y 向上为正、地面为 0。
 *   在 375 宽的设备上，1 个世界单位 = 1 个 CSS 像素。
 *
 * 改完任何参数请跑：node tests/run-tests.js
 */
const config = {
  WORLD: {
    width: 375,
    // 摄像机的初始位置：屏幕底边位于世界 y = -groundBaselineOffset 处
    groundBaselineOffset: -80,
    // 摄像机跟随的平滑系数，越大跟得越紧（单位：每秒的指数逼近速率）
    cameraLerpRate: 4.2
  },

  FOUNDATION: {
    // 地基宽度。坍塌判据是「重心偏心 vs 地基半宽」，所以这个值直接决定容错空间
    width: 130,
    height: 10
  },

  FLOOR: {
    width: 64,
    height: 22,
    radius: 3
  },

  CRANE: {
    centerX: 187.5,
    // 摆动振幅（单向，世界单位）。必须小于 pendulumLength，否则摆角无解
    amplitude: 118,
    // 摆动周期随塔高从 periodSecAtStart 线性收紧到 periodSecAtMin（难度爬升）
    periodSecAtStart: 2.2,
    periodSecAtMin: 1.5,
    periodRampFloors: 30,
    // 钟摆几何：吊点位于塔顶上方 pivotHeightAboveTop，摆臂长 pendulumLength。
    // 楼层的水平位置 = centerX + amplitude * sin(ωt)，摆角 φ = asin(amplitude/pendulumLength * sin(ωt))。
    // 渲染层直接用这两个值画吊绳的角度，逻辑与视觉因此共享同一份几何、不会脱节。
    pivotHeightAboveTop: 250,
    pendulumLength: 165,
    // 下落重力加速度（世界单位 / 秒²）
    dropGravity: 2400
  },

  TOLERANCE: {
    // 完美落点：|落点偏差| <= FLOOR.width * perfectRatio
    perfectRatio: 0.18,
    // 失误：|落点偏差| > FLOOR.width * missRatio
    //
    // missRatio = 0.5 不是一个随手取的数，它等价于「落点中心越过下层支承边缘」，
    // 也就是楼层会真的翻落下去的物理临界点。改动它会同时破坏物理一致性与手感，
    // 要放宽容错请改 FOUNDATION.width 或 STABILITY.collapseRatio，不要动这里。
    missRatio: 0.5
  },

  STABILITY: {
    // 坍塌判据：偏心 > 地基半宽 * collapseRatio * 高塔收紧系数
    collapseRatio: 0.62,
    // 高塔惩罚：塔越高，同样大小的偏心越危险。
    // 收紧系数 = 1 / (1 + (楼层数 - 1) * topHeavyGain)
    //
    // 为什么需要它：重心是各层位置的平均值，所以「多加一层」对重心的撬动是 1/n，
    // 塔越高单次坏落点的影响反而越小 —— 物理上没错，但作为难度曲线是反的。
    // 这个系数是刻意加的手感补丁，不是物理定律。设 0 即关闭。
    topHeavyGain: 0.06,
    // 视觉摇摆强度（0~1）在塔顶的衰减速率（每秒）
    swayDecayPerSec: 1.6,
    // 每次失误给视觉摇摆强度加多少
    swayPerMiss: 0.55,
    // 每次一般落点给视觉摇摆强度加多少
    swayPerImperfect: 0.18
  },

  COMBO: {
    // 连击计数器上限
    maxSteps: 20
  },

  RUN: {
    // 失误额度：用尽即「封顶」，本局结束、塔身保留
    missBudget: 3
  },

  POPULATION: {
    basePerFloor: 2,
    // 人口加成：每层基础人口 × (1 + comboStepBonus × min(连击数, comboCap))
    comboStepBonus: 0.35,
    comboCap: 8
  },

  SCORE: {
    perFloor: 10,
    comboBonusPerStep: 5,
    populationFactor: 0.5,
    // 坍塌时得分打这个折扣（封顶不打折）
    collapsePenalty: 0.35
  },

  CAMERA: {
    // 塔顶之上的世界必须至少留出这么多单位，用于容纳吊车
    topPadding: 60,
    // 摄像机目标点落在屏幕纵向的哪个比例处。
    // 这个值同时决定两件事：屏幕上留多少空间给塔、吊车轨道落在哪一行。
    // 调大 -> 塔看得更多，但吊车轨道上移、会与 HUD 撞车。
    followRatio: 0.8
  },

  // 观感相关的几何量（颜色在 js/render/palette.js，逻辑量在上面各节）
  VISUAL: {
    // 倾角的视觉放大系数。1 = 完全按几何倾角绘制
    leanVisualGain: 0.85,
    // 摇摆的视觉幅度（世界单位）与频率（Hz）
    swayAmplitude: 5.5,
    swayHz: 3.4,
    // 落地时楼层被压扁的比例与回弹时长（秒）。
    // 时长必须短于 FEEL.settleDelaySec，否则下一次投放时楼层还扁着、会露出缝
    landingSquash: 0.16,
    landingSquashSec: 0.1,
    // 失误时画面抖动幅度（像素）与时长
    missShakePx: 7,
    missShakeSec: 0.22,
    // 坍塌的倒塌演出：从触发到倒稳的时长（秒），以及叠加在派生倾角之上的额外倒塌角（度）。
    //
    // 重要：这个额外角度是**纯演出量**，不参与任何判定。内核的 leanAngle 由偏心算出、
    // 是派生量，不可改动；这里给的是「倒了多少」，两者相加才是画面上的总倾角。
    // 把它设成 0 即只保留抖动、塔身不倾，等于关闭这个演出。
    collapseSec: 0.65,
    collapseSweepDeg: 18
  },

  FEEL: {
    // 逻辑定步长：物理推进固定用这个步长，与帧率解耦
    fixedDt: 1 / 60,
    // 单帧最大步长，防止切后台回来后一次跳太多
    maxFrameDt: 1 / 20,
    // 落地后停顿多久才允许下一次投放（秒）
    settleDelaySec: 0.12
  },

  AUDIO: {
    enabled: true,
    masterVolume: 0.45
  },

  VIBRATE: { enabled: true },

  TUTORIAL: {
    enabled: true,
    // 建到这么多层后隐藏引导
    minFloorsToHide: 2
  }
};

module.exports = config;
