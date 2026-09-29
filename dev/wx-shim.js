/**
 * 浏览器运行壳：把微信小游戏的 wx.* 能力映射到标准 Web API。
 *
 * 存在意义：本工程是小游戏（compileType: "game"），正式运行环境只有微信开发者工具
 * 与微信客户端。这个壳让你在普通浏览器里就能玩到**同一份 js/ 代码**，改 config.js
 * 存盘刷新即可看到手感变化，不必等开发者工具。
 *
 * 工程对 wx 的依赖面很窄（只在 js/platform/env.js 与 js/audio/sfx.js 里），一共 6 个 API：
 *   createCanvas / getWindowInfo / getStorageSync / setStorageSync
 *   vibrateShort / onTouchStart / onShow / createWebAudioContext
 * 这里的实现逐条对齐微信的入参出参形状，不额外发明接口。
 *
 * 仅用于本地预览，不参与小游戏打包（project.config.json 的 packOptions 已忽略 dev/）。
 */
(function (global) {
  'use strict';

  const params = new URLSearchParams(global.location.search);

  // 模拟手机状态栏安全区高度。设 0 可看「刘海贴边」的极端效果，用于验证 HUD 布局。
  const SAFE_TOP = params.has('safeTop') ? Number(params.get('safeTop')) || 0 : 20;

  // 画布最长边（CSS 像素）。超过这个值再大也没意义，反而拖慢绘制。
  const MAX_STAGE_HEIGHT = 812;
  // 设计基准长宽比，与小游戏 game.json 的竖屏 + 工程默认 375×667 一致。
  const DESIGN_ASPECT = 375 / 667;

  // ---------- 舞台尺寸：按设计比例尽量铺满可用空间 ----------

  function computeStage() {
    const host = document.getElementById('stage');
    const availW = Math.max(240, host.clientWidth);
    const availH = Math.max(320, host.clientHeight);

    let height = Math.min(availH, MAX_STAGE_HEIGHT);
    let width = height * DESIGN_ASPECT;
    if (width > availW) {
      width = availW;
      height = width / DESIGN_ASPECT;
    }
    return { width: Math.round(width), height: Math.round(height) };
  }

  const stage = computeStage();
  const dpr = Math.min(global.devicePixelRatio || 1, 3);

  // ---------- 主画布 ----------
  // 微信里主画布尺寸由宿主决定，逻辑像素与物理像素的关系靠 ctx 变换抹平。
  // 这里照搬同样的做法：后备存储用物理像素，CSS 尺寸用逻辑像素。

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(stage.width * dpr);
  canvas.height = Math.round(stage.height * dpr);
  canvas.style.width = stage.width + 'px';
  canvas.style.height = stage.height + 'px';
  document.getElementById('stage').appendChild(canvas);

  // ---------- 触摸 ----------
  // 微信的 onTouchStart 回调签名：{ touches: [{ clientX, clientY, ... }] }
  // clientX/clientY 相对窗口。浏览器里减去画布矩形偏移即得同一坐标系。

  const touchHandlers = [];

  function emitTouch(x, y) {
    const res = {
      touches: [{ clientX: x, clientY: y }],
      changedTouches: [{ clientX: x, clientY: y }]
    };
    for (let i = 0; i < touchHandlers.length; i += 1) touchHandlers[i](res);
  }

  canvas.addEventListener(
    'touchstart',
    function (e) {
      const rect = canvas.getBoundingClientRect();
      const touch = e.changedTouches && e.changedTouches[0];
      if (touch) emitTouch(touch.clientX - rect.left, touch.clientY - rect.top);
      // 阻止滚动 / 双击缩放，否则手机上点两下会放大页面
      e.preventDefault();
    },
    { passive: false }
  );

  // 桌面浏览器没有触摸事件，用鼠标顶上，方便本机调参
  canvas.addEventListener('mousedown', function (e) {
    const rect = canvas.getBoundingClientRect();
    emitTouch(e.clientX - rect.left, e.clientY - rect.top);
    e.preventDefault();
  });

  // ---------- 震动：桌面无马达，用边框脉冲把「震动触发」变成看得见的事件 ----------
  // 这一层在真机上靠手感验证，在桌面上原本完全不可观测；给它一个视觉替身，
  // 调 VIBRATE / 完美落点反馈时才有依据。

  const VIBRATE_MS = { light: 10, medium: 22, heavy: 45 };

  function visualBuzz(type) {
    const host = document.getElementById('phone');
    if (!host) return;
    const cls = 'buzz-' + (VIBRATE_MS[type] ? type : 'light');
    host.classList.remove('buzz-light', 'buzz-medium', 'buzz-heavy');
    // 强制回流，让连续两次同类型震动也能重新播放动画
    void host.offsetWidth;
    host.classList.add(cls);
    clearTimeout(visualBuzz.timer);
    visualBuzz.timer = setTimeout(function () {
      host.classList.remove(cls);
    }, 260);
  }

  const storageKey = function (key) {
    return 'skyline_dev:' + key;
  };

  const shownHandlers = [];
  let pageHidden = false;

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      pageHidden = true;
      return;
    }
    if (pageHidden) {
      pageHidden = false;
      for (let i = 0; i < shownHandlers.length; i += 1) shownHandlers[i]();
    }
  });

  // ---------- wx 全局对象 ----------

  let canvasCalls = 0;
  let audioCtx = null;

  global.wx = {
    /** 第一次调用返回主画布，后续调用返回离屏画布（与微信行为一致）。 */
    createCanvas: function () {
      canvasCalls += 1;
      if (canvasCalls === 1) return canvas;
      return document.createElement('canvas');
    },

    getWindowInfo: function () {
      return {
        pixelRatio: dpr,
        windowWidth: stage.width,
        windowHeight: stage.height,
        safeArea: {
          left: 0,
          right: stage.width,
          top: SAFE_TOP,
          bottom: stage.height,
          width: stage.width,
          height: stage.height - SAFE_TOP
        }
      };
    },

    getStorageSync: function (key) {
      try {
        const raw = global.localStorage.getItem(storageKey(key));
        if (raw === null) return '';
        return JSON.parse(raw);
      } catch (err) {
        return '';
      }
    },

    setStorageSync: function (key, value) {
      try {
        global.localStorage.setItem(storageKey(key), JSON.stringify(value));
      } catch (err) {
        /* 隐私模式下写入会失败，静默忽略：与微信里存储失败的表现一致 */
      }
    },

    vibrateShort: function (options) {
      const type = (options && options.type) || 'light';
      visualBuzz(type);
      try {
        if (navigator.vibrate) navigator.vibrate(VIBRATE_MS[type] || 10);
      } catch (err) {
        /* 桌面浏览器多半不支持，忽略 */
      }
    },

    onTouchStart: function (handler) {
      touchHandlers.push(handler);
    },

    onShow: function (handler) {
      shownHandlers.push(handler);
    },

    createWebAudioContext: function () {
      const Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) return null;
      // 只建一个上下文：每次音效都新建会很快撞上浏览器的上下文数量上限
      if (!audioCtx) audioCtx = new Ctor();
      return audioCtx;
    }
  };

  // 供预览页读取，不影响游戏逻辑
  global.__devStage = {
    width: stage.width,
    height: stage.height,
    dpr: dpr,
    safeTop: SAFE_TOP,
    canvas: canvas
  };
})(window);
