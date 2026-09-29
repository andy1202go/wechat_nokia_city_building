/**
 * Canvas / CanvasRenderingContext2D / WebAudio / wx 的桩实现。
 *
 * 目的不是模拟像素，而是让整条渲染与编排链在 Node 下真实跑一遍，抓三类问题：
 *
 *   1. 运行时异常 —— 字段拼错、在 undefined 上取属性。这类问题在真机上一开就炸，
 *      但只在打开微信开发者工具时才发现；在这里能提前抓到。
 *   2. 非有限数值 —— NaN / Infinity 传给 Canvas 是**静默不绘制**的，不报错。
 *      肉眼只看到「某块东西不见了」，是渲染层最难定位的一类 bug，所以桩要主动报警。
 *   3. 越界的上下文状态 —— globalAlpha 超出 [0,1]、arc 负半径、负的 lineWidth。
 *      真 Canvas 对这些要么忽略、要么直接抛异常，都会让画面对不上。
 *
 * 另外记录 save/restore 的配对深度：render() 中途 return 而漏掉 restore，
 * 会让后续所有绘制整体偏移，属于典型的「改一处、坏一片」。
 */

/** 从 ctx.font 里解析字号，形如 "500 22px sans-serif"。 */
function parseFontSize(font) {
  const matched = /(\d+(?:\.\d+)?)\s*px/.exec(String(font));
  return matched ? parseFloat(matched[1]) : 14;
}

/** CJK 与全角符号按一个字号宽算，其余按 0.55 字号宽算。 */
function textWidth(content, size) {
  let width = 0;
  const text = String(content);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.codePointAt(i);
    width += code > 0x2e80 ? size : size * 0.55;
  }
  return width;
}

function createStubCanvas(options) {
  const opt = options || {};
  const log = [];
  const problems = [];
  const styleLog = [];
  let stackDepth = 0;

  const state = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '400 14px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1
  };

  function note(message) {
    problems.push(message);
  }

  function record(name, args) {
    const list = args || [];
    for (let i = 0; i < list.length; i += 1) {
      const value = list[i];
      if (typeof value === 'number' && !Number.isFinite(value)) {
        note(`${name}() 的第 ${i + 1} 个参数不是有限数：${value}`);
      }
    }
    log.push({ name, args: list.slice() });
  }

  const ctx = {
    // ---- 状态属性（getter/setter 以便校验） ----
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value) {
      state.fillStyle = value;
      styleLog.push(value);
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value) {
      state.strokeStyle = value;
      styleLog.push(value);
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value) {
      if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) {
        note(`lineWidth 被设为非正数或非有限数：${value}`);
      }
      state.lineWidth = value;
    },
    get font() {
      return state.font;
    },
    set font(value) {
      state.font = value;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textAlign(value) {
      state.textAlign = value;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(value) {
      state.textBaseline = value;
    },
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(value) {
      if (typeof value === 'number' && (value < 0 || value > 1)) {
        note(`globalAlpha 被设为越界值：${value}`);
      }
      state.globalAlpha = value;
    },

    // ---- 栈 ----
    save: function () {
      stackDepth += 1;
      record('save', []);
    },
    restore: function () {
      if (stackDepth === 0) note('restore() 在没有对应 save() 的情况下被调用');
      else stackDepth -= 1;
      record('restore', []);
    },

    // ---- 路径 ----
    beginPath: function () {
      record('beginPath', []);
    },
    closePath: function () {
      record('closePath', []);
    },
    moveTo: function (x, y) {
      record('moveTo', [x, y]);
    },
    lineTo: function (x, y) {
      record('lineTo', [x, y]);
    },
    rect: function (x, y, w, h) {
      record('rect', [x, y, w, h]);
    },
    arc: function (x, y, r, startAngle, endAngle) {
      if (typeof r === 'number' && r < 0) note(`arc() 半径为负：${r}（真 Canvas 会抛异常）`);
      record('arc', [x, y, r, startAngle, endAngle]);
    },
    arcTo: function (x1, y1, x2, y2, r) {
      if (typeof r === 'number' && r < 0) note(`arcTo() 半径为负：${r}`);
      record('arcTo', [x1, y1, x2, y2, r]);
    },
    bezierCurveTo: function (a, b, c, d, e, f) {
      record('bezierCurveTo', [a, b, c, d, e, f]);
    },
    quadraticCurveTo: function (a, b, c, d) {
      record('quadraticCurveTo', [a, b, c, d]);
    },
    fill: function () {
      record('fill', []);
    },
    stroke: function () {
      record('stroke', []);
    },
    clip: function () {
      record('clip', []);
    },

    // ---- 矩形 ----
    fillRect: function (x, y, w, h) {
      record('fillRect', [x, y, w, h]);
    },
    strokeRect: function (x, y, w, h) {
      record('strokeRect', [x, y, w, h]);
    },
    clearRect: function (x, y, w, h) {
      record('clearRect', [x, y, w, h]);
    },

    // ---- 文字 ----
    fillText: function (content, x, y, maxWidth) {
      record('fillText', [content, x, y, maxWidth]);
    },
    strokeText: function (content, x, y, maxWidth) {
      record('strokeText', [content, x, y, maxWidth]);
    },
    measureText: function (content) {
      record('measureText', [content]);
      return { width: textWidth(content, parseFontSize(state.font)) };
    },

    // ---- 变换 ----
    translate: function (x, y) {
      record('translate', [x, y]);
    },
    rotate: function (angle) {
      record('rotate', [angle]);
    },
    scale: function (x, y) {
      record('scale', [x, y]);
    },
    setTransform: function (a, b, c, d, e, f) {
      record('setTransform', [a, b, c, d, e, f]);
    },
    resetTransform: function () {
      record('resetTransform', []);
    },

    // ---- 其他 ----
    setLineDash: function (segments) {
      record('setLineDash', [segments]);
    },
    createLinearGradient: function (x0, y0, x1, y1) {
      record('createLinearGradient', [x0, y0, x1, y1]);
      return {
        addColorStop: function (offset, color) {
          if (typeof offset === 'number' && (offset < 0 || offset > 1)) {
            note(`addColorStop() 的偏移越界：${offset}`);
          }
          record('addColorStop', [offset, color]);
        }
      };
    },
    createRadialGradient: function (x0, y0, r0, x1, y1, r1) {
      record('createRadialGradient', [x0, y0, r0, x1, y1, r1]);
      return {
        addColorStop: function (offset, color) {
          record('addColorStop', [offset, color]);
        }
      };
    }
  };

  if (opt.withoutSetLineDash) delete ctx.setLineDash;

  const canvas = {
    width: opt.width === undefined ? 750 : opt.width,
    height: opt.height === undefined ? 1334 : opt.height,
    getContext: function (kind) {
      return kind === '2d' ? ctx : null;
    }
  };

  return {
    canvas: canvas,
    ctx: ctx,
    log: log,
    problems: problems,
    /** 未配对的 save 数量，正常渲染结束后应为 0 */
    stackDepth: function () {
      return stackDepth;
    },
    /** 某个绘制方法的调用次数 */
    countOf: function (name) {
      let n = 0;
      for (let i = 0; i < log.length; i += 1) if (log[i].name === name) n += 1;
      return n;
    },
    /** 取出某方法收到的所有参数，便于断言坐标 */
    argsOf: function (name) {
      const out = [];
      for (let i = 0; i < log.length; i += 1) {
        if (log[i].name === name) out.push(log[i].args);
      }
      return out;
    },
    /** 本帧用过的全部颜色（fillStyle / strokeStyle 的赋值序列） */
    colorsUsed: function () {
      return styleLog.slice();
    },
    /** 某个颜色是否被使用过 */
    usedColor: function (color) {
      return styleLog.indexOf(color) >= 0;
    },
    reset: function () {
      log.length = 0;
      problems.length = 0;
      styleLog.length = 0;
      stackDepth = 0;
    }
  };
}

/** WebAudio 桩：只记录调用，不做任何真实的音频处理。 */
function createStubAudioContext(record) {
  const calls = [];
  function note(name, detail) {
    calls.push({ name, detail });
    if (record) record(name, detail);
  }

  function makeParam(owner) {
    return {
      value: 0,
      setValueAtTime: function (value, time) {
        note(owner + '.setValueAtTime', { value, time });
        return this;
      },
      exponentialRampToValueAtTime: function (value, time) {
        if (value === 0) note(owner + '.exponentialRampToZero', { value, time });
        note(owner + '.exponentialRampToValueAtTime', { value, time });
        return this;
      },
      linearRampToValueAtTime: function (value, time) {
        note(owner + '.linearRampToValueAtTime', { value, time });
        return this;
      }
    };
  }

  const audioCtx = {
    state: 'running',
    currentTime: 1.5,
    destination: { name: 'destination' },
    calls: calls,
    resume: function () {
      audioCtx.state = 'running';
      note('resume');
    },
    createGain: function () {
      const gain = {
        gain: makeParam('gain'),
        connect: function (target) {
          note('gain.connect', target === audioCtx.destination ? 'destination' : 'node');
          return target;
        },
        disconnect: function () {
          note('gain.disconnect');
        }
      };
      gain.gain.value = 1;
      return gain;
    },
    createOscillator: function () {
      return {
        type: 'sine',
        frequency: makeParam('frequency'),
        connect: function (target) {
          note('osc.connect');
          return target;
        },
        disconnect: function () {
          note('osc.disconnect');
        },
        start: function (time) {
          note('osc.start', { time });
        },
        stop: function (time) {
          note('osc.stop', { time });
        }
      };
    }
  };
  return audioCtx;
}

/**
 * 平台桩：模拟小游戏运行环境，并接管时间与 rAF，让主循环可以在测试里被手动泵动。
 * 返回的控制器里包含一个可控时钟，避免测试依赖真实时间而变慢或抖动。
 */
function createStubPlatform(options) {
  const opt = options || {};
  const canvasStub = createStubCanvas({
    width: opt.canvasWidth === undefined ? 750 : opt.canvasWidth,
    height: opt.canvasHeight === undefined ? 1334 : opt.canvasHeight,
    withoutSetLineDash: opt.withoutSetLineDash
  });

  const clock = { t: opt.startTime === undefined ? 100000 : opt.startTime };
  const pendingRaf = [];
  const storage = new Map();
  const touchHandlers = [];
  const showHandlers = [];
  const vibrations = [];
  const audioCalls = [];
  const audio = createStubAudioContext(function (name) {
    audioCalls.push(name);
  });

  const windowWidth = opt.windowWidth === undefined ? 375 : opt.windowWidth;
  const windowHeight = opt.windowHeight === undefined ? 667 : opt.windowHeight;

  const wx = {
    createCanvas: function () {
      return canvasStub.canvas;
    },
    getWindowInfo: function () {
      return {
        pixelRatio: opt.pixelRatio === undefined ? 2 : opt.pixelRatio,
        windowWidth: windowWidth,
        windowHeight: windowHeight,
        safeArea: { top: opt.safeTop === undefined ? 20 : opt.safeTop, bottom: windowHeight }
      };
    },
    getStorageSync: function (key) {
      return storage.has(key) ? storage.get(key) : '';
    },
    setStorageSync: function (key, value) {
      storage.set(key, value);
    },
    vibrateShort: function (params) {
      vibrations.push(params && params.type ? params.type : 'default');
    },
    onTouchStart: function (handler) {
      touchHandlers.push(handler);
    },
    onShow: function (handler) {
      showHandlers.push(handler);
    },
    createWebAudioContext: opt.withoutAudio
      ? undefined
      : function () {
          return audio;
        }
  };
  if (opt.withoutAudio) delete wx.createWebAudioContext;

  // 全局注入。env.js 用 `typeof wx !== 'undefined'` 检测，所以挂在 global 上即可。
  global.wx = wx;
  global.performance = {
    now: function () {
      return clock.t;
    }
  };
  global.requestAnimationFrame = function (fn) {
    pendingRaf.push(fn);
    return pendingRaf.length;
  };

  return {
    wx: wx,
    ctx: canvasStub.ctx,
    canvas: canvasStub.canvas,
    stub: canvasStub,
    audio: audio,
    audioCalls: audioCalls,
    storage: storage,
    vibrations: vibrations,
    clock: clock,

    /** 模拟一次触摸（坐标为逻辑像素）。 */
    touch: function (x, y) {
      const event = { touches: [{ clientX: x, clientY: y }] };
      touchHandlers.forEach(function (handler) {
        handler(event);
      });
    },

    /** 模拟一次从后台切回前台。 */
    show: function () {
      showHandlers.forEach(function (handler) {
        handler();
      });
    },

    /** 手动泵动主循环。每帧推进 stepMs 毫秒。返回实际执行的帧数。 */
    pump: function (frames, stepMs) {
      const dt = stepMs === undefined ? 16 : stepMs;
      let done = 0;
      for (let i = 0; i < frames; i += 1) {
        const fn = pendingRaf.shift();
        if (!fn) break;
        clock.t += dt;
        fn(clock.t);
        done += 1;
      }
      return done;
    },

    pendingFrames: function () {
      return pendingRaf.length;
    },

    cleanup: function () {
      delete global.wx;
      delete global.performance;
      delete global.requestAnimationFrame;
      pendingRaf.length = 0;
    }
  };
}

module.exports = {
  createStubCanvas,
  createStubAudioContext,
  createStubPlatform,
  parseFontSize,
  textWidth
};
