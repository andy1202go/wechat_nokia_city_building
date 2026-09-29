/**
 * 主题。
 *
 * 每个主题是一套**完整**的配色 + 天空氛围参数。渲染层只读这些值，
 * 不知道当前是白天还是夜晚 —— 想换皮肤只改这里。
 *
 * 为什么要把天空做得这么重：
 *   竖屏里天空占了约 65% 的画面。之前的版本天空只是一段纯渐变，
 *   整屏大面积留白，是"简陋"感的最大来源。优秀休闲游戏的共通做法是
 *   把天空当成一个有内容的舞台（天体 + 光晕 + 云层 + 星辰），
 *   再用大气透视把远处的城市推远。
 *
 * 三个主题参考的风格取向：
 *   day   明亮清爽的多层天空         —— Alto's Adventure 一类的日间氛围
 *   dusk  逆光剪影 + 被染色的云      —— Alto's Odyssey 的落日
 *   night 万家灯火的城市夜景         —— 与「建造城市」的主题最贴合
 *
 * 注意：主题只影响观感，**不参与任何判定**。判定参数仍在 js/core/config.js。
 *
 * ---- 塔身配色（building）的三条规则 ----
 *
 * 1. **同一色相，只分三档明度。** 曾经每层换一个颜色，六个色相循环 ——
 *    在扁砖上像彩色条纹还过得去，方块化之后色块面积翻三倍，直接成了
 *    一摞彩虹积木。这是「低幼感」最大的来源。克制才有艺术感：
 *    Monument Valley 每关只用一个主题色 + 70-20-10，Alto's Odyssey 只有剪影。
 *    低幼来自「多」，艺术感来自「少」。
 *
 * 2. **中档取明度的算术中点，顺序排成 中 → 浅 → 深。**
 *    这样相邻层的明暗是「+d, −2d, +d」的等步长上下交替，节奏均匀；
 *    若三档不等距或顺序随意，会出现忽明忽暗的杂乱感。
 *
 * 3. **最亮的一档不能比地平线附近的天空还亮。** 塔是前景，天空是背景，
 *    前者更亮会失去纵深。白天主题的天空下端约 0.85 明度，所以那套色板
 *    最亮停在 0.73 左右。
 *
 * 层与层之间仍然分得清（玩家必须看得出哪层偏了），靠的不是换色相，
 * 而是明度 + 每层自带的受光顶面与右侧暗面（见 towerView.drawFloorBlock）。
 */

/**
 * 与主题无关的部分：UI 与吊车共用一套，避免三份重复。
 *
 * 注意 foundation **不在这里** —— 地基已经并入地面（见 towerView.drawFoundation），
 * 它的配色必须跟着各主题的 ground 走。共用一套灰会让它重新读成「压在地面上的一块板」。
 */
const SHARED = {
  crane: {
    rail: '#4A525E',
    railLight: 'rgba(255, 255, 255, 0.20)',
    railEdge: '#2E353F',
    trolley: '#39404A',
    // 吊绳比轨道亮一档：它多数时候悬在天空上，用轨道那个深灰就看不见了
    rope: '#8792A3',
    hook: '#39404A'
  },

  // 地基中线：让玩家看懂塔为什么倒（见 docs/adr/0003 的 Consequences）
  axis: 'rgba(255, 255, 255, 0.50)',
  axisDanger: 'rgba(255, 107, 92, 0.72)',

  hud: {
    bg: 'rgba(10, 22, 38, 0.42)',
    text: '#FFFFFF',
    dim: 'rgba(255, 255, 255, 0.64)',
    track: 'rgba(255, 255, 255, 0.24)',
    safe: '#7BE495',
    warn: '#FFD95C',
    danger: '#FF6B5C',
    accent: '#FFD95C'
  },

  panel: {
    bg: 'rgba(12, 26, 44, 0.90)',
    border: 'rgba(255, 255, 255, 0.20)',
    text: '#FFFFFF',
    dim: 'rgba(255, 255, 255, 0.68)',
    primary: '#F2C14E',
    primaryText: '#20303F',
    ghost: 'rgba(255, 255, 255, 0.14)'
  }
};

const THEMES = {
  /** 晴日：明亮、清爽，云的层次是主角。 */
  day: {
    name: 'day',
    label: '晴日',

    sky: {
      stops: [
        [0, '#2F7FD0'],
        [0.40, '#6FB6E6'],
        [0.70, '#B5DDF3'],
        [1, '#E6F4FB']
      ]
    },

    // 天体：太阳高挂，光晕大而柔。位置是**屏幕高度比例**，不随镜头移动 ——
    // 太阳在天上，摄像机升高时它在画面里的位置本就该基本不动。
    //
    // 白天主题的天空其实很窄：上方是 HUD、下方是吊车轨道，两道横线之间只剩
    // 约 90px。太阳半径和高度都是照着这条夹缝定的，改之前先看一遍出图。
    celestial: {
      kind: 'sun',
      x: 0.74,
      y: 0.20,
      radius: 22,
      core: '#FFFFFF',
      rim: 'rgba(255, 252, 235, 0.95)',
      glow: 'rgba(255, 246, 206, 0.80)',
      // 白天光晕收敛一些，否则会铺到顶部 HUD 上
      glowScale: 3.8
    },

    clouds: {
      count: 12,
      opacity: 0.95,
      lit: '#FFFFFF',
      // 背光面压深一点，云才有体积；太接近天空色会糊成一片
      shade: 'rgba(178, 206, 230, 0.95)',
      minW: 90,
      maxW: 190,
      bandTop: 0.08,
      bandBottom: 0.52
    },

    stars: { enabled: false, count: 0, color: '#FFFFFF' },

    // 大气透视：越远越淡、越偏天空色；越近越深
    skyline: {
      far: 'rgba(160, 194, 222, 0.85)',
      mid: 'rgba(134, 172, 206, 0.90)',
      near: 'rgba(108, 150, 188, 0.95)',
      // 白天不点灯
      windows: null
    },

    // 草地的绿原来是最饱和的那一档（#8DD05A），整幅画里只有它在喊。
    // 降成鼠尾草绿：环境越安静，塔才越像主角 —— 这是「少即是多」里最先该做的一步
    ground: { top: '#9DC17F', bottom: '#5F8A4A', edge: '#4A7038' },
    // 地基：地面上的一块铺装，比草色深一档 —— 读作「地面在这里换了材质」。
    // top 是它与地面相接的那条受光边，同时也是「塔站得了多宽」的视觉提示
    foundation: { body: '#3E6B31', top: '#82AB63', edge: '#2C5223' },

    // 暖砂岩的三档明度。白天场景里塔身**是唯一的暖色** ——
    // 蓝天、青灰城市、冷绿草地全在对面，暖色只需要出现一次就够醒目。
    // 颜色的职责是「指明这是塔」，不是「让每层都不一样的颜色」
    building: ['#C08A52', '#DFB37C', '#9C6B3E'],
    buildingEdge: 'rgba(28, 40, 56, 0.44)',
    // 阴影偏蓝：白天的环境光来自蓝天，暖色物体上的阴影本来就是冷色的
    buildingShade: 'rgba(24, 42, 68, 0.30)',
    buildingLight: 'rgba(255, 246, 224, 0.38)',
    window: 'rgba(26, 40, 60, 0.30)',
    windowLit: 'rgba(255, 236, 172, 0.60)',
    perfectCap: '#FFD95C'
  },

  /** 黄昏：逆光剪影 + 被夕阳染色的云。层次最强。 */
  dusk: {
    name: 'dusk',
    label: '黄昏',

    sky: {
      stops: [
        [0, '#243063'],
        [0.34, '#7A4A85'],
        [0.63, '#DC7A5E'],
        [0.85, '#F5AC66'],
        [1, '#FFD79C']
      ]
    },

    // 太阳低垂，贴着城市天际线 —— 这是整幅画面的视觉锚点，
    // 但不能落进吊车的活动区，否则会干扰判断落点。
    celestial: {
      kind: 'sun',
      x: 0.68,
      y: 0.74,
      radius: 36,
      core: '#FFF4CF',
      rim: 'rgba(255, 226, 168, 0.95)',
      glow: 'rgba(255, 174, 96, 0.62)',
      glowScale: 6.0
    },

    // 云被夕阳从下方照亮：受光面暖橙、背光面紫灰。
    // 云带压得很高，让暖色云浮在深紫的高空上 —— 那里对比最强。
    clouds: {
      count: 13,
      opacity: 0.9,
      lit: 'rgba(255, 209, 154, 0.95)',
      shade: 'rgba(122, 84, 122, 0.85)',
      minW: 110,
      maxW: 230,
      bandTop: 0.04,
      bandBottom: 0.42
    },

    stars: { enabled: true, count: 26, color: 'rgba(255, 255, 255, 0.85)' },

    // 逆光：越近越暗，城市成为剪影，把亮色的塔衬出来
    skyline: {
      far: 'rgba(122, 98, 148, 0.80)',
      mid: 'rgba(84, 68, 116, 0.88)',
      near: 'rgba(50, 42, 76, 0.95)',
      // 天刚黑，零星亮起几盏
      windows: { color: 'rgba(255, 216, 150, 0.55)', ratio: 0.18 }
    },

    ground: { top: '#3E4266', bottom: '#242842', edge: '#191D33' },
    // 铺装比地面更暗、受光边更亮：黄昏的逆光里，只有靠明度差才分得出这条带
    foundation: { body: '#171B2E', top: '#5A6088', edge: '#0E1120' },

    // 暖金三档。原来那六个色里混了砖红与紫（#C9735A / #8E6B8E），
    // 在深紫剪影的衬托下它们各自为政，读起来像「一摞不同颜色的盒子」。
    // 收敛到同一色相后，逆光里的塔才是**一座**被夕阳照亮的塔
    building: ['#CB9C56', '#E9C27E', '#A97B3E'],
    buildingEdge: 'rgba(30, 22, 44, 0.46)',
    buildingShade: 'rgba(38, 20, 52, 0.36)',
    buildingLight: 'rgba(255, 232, 180, 0.42)',
    window: 'rgba(38, 24, 50, 0.38)',
    windowLit: 'rgba(255, 220, 140, 0.72)',
    perfectCap: '#FFE08A'
  },

  /** 夜晚：深空 + 星辰 + 万家灯火。与「建造城市」的主题最贴。 */
  night: {
    name: 'night',
    label: '夜晚',

    sky: {
      stops: [
        [0, '#060B1E'],
        [0.42, '#101C42'],
        [0.74, '#1E3A68'],
        [1, '#2E5A8C']
      ]
    },

    // 月亮下移到 HUD 之下：原来贴在右上角，正好压住「机会」指示点
    celestial: {
      kind: 'moon',
      x: 0.70,
      y: 0.22,
      radius: 20,
      core: '#F4F7FF',
      rim: 'rgba(214, 228, 255, 0.90)',
      glow: 'rgba(164, 200, 255, 0.38)',
      glowScale: 5.5
    },

    clouds: {
      count: 9,
      opacity: 0.55,
      lit: 'rgba(74, 98, 142, 0.75)',
      shade: 'rgba(28, 42, 70, 0.75)',
      minW: 120,
      maxW: 240,
      bandTop: 0.08,
      bandBottom: 0.46
    },

    stars: { enabled: true, count: 120, color: '#FFFFFF' },

    skyline: {
      far: 'rgba(40, 58, 98, 0.90)',
      mid: 'rgba(26, 38, 70, 0.94)',
      near: 'rgba(13, 20, 40, 0.97)',
      // 万家灯火：这一版夜景的主力观感
      windows: { color: 'rgba(255, 214, 140, 0.85)', ratio: 0.34 }
    },

    // 夜里的地面是城市的地面：深，但不至于黑成一片
    ground: { top: '#1B2440', bottom: '#0E1426', edge: '#080D18' },
    // 夜里地面已经很暗，所以受光边调得比地面亮一档才看得见
    foundation: { body: '#070B14', top: '#2C3858', edge: '#03050B' },

    // 冷蓝三档。夜景里塔身刻意压暗：这一版的主角是**窗光**（暖黄），
    // 塔身越沉，那一片暖色才越像是「有人在里面」
    building: ['#38507E', '#4A689E', '#26385C'],
    buildingEdge: 'rgba(6, 12, 24, 0.52)',
    buildingShade: 'rgba(4, 9, 20, 0.44)',
    buildingLight: 'rgba(150, 190, 255, 0.26)',
    window: 'rgba(10, 18, 36, 0.44)',
    windowLit: 'rgba(255, 214, 140, 0.85)',
    perfectCap: '#8ED0FF'
  }
};

function merge(theme) {
  const out = {};
  Object.keys(SHARED).forEach((key) => { out[key] = SHARED[key]; });
  Object.keys(theme).forEach((key) => { out[key] = theme[key]; });
  return out;
}

/** 按名字取主题；不认识的名字回落到黄昏。 */
function themeByName(name) {
  const raw = THEMES[name] || THEMES.dusk;
  return merge(raw);
}

const DEFAULT_THEME = 'dusk';

module.exports = {
  THEMES,
  NAMES: Object.keys(THEMES),
  DEFAULT_THEME,
  themeByName,
  default: themeByName(DEFAULT_THEME)
};
