/**
 * 平台适配层。
 *
 * 所有 wx.* 调用集中在这里，并且全部做特性检测：
 * 任何一个能力缺失都只是降级（静默失效），绝不让游戏崩溃。
 * 这一层之外的所有代码都不直接碰 wx，因此内核与渲染层都能在 Node 下被引用。
 */

function hasWx() {
  return typeof wx !== 'undefined' && wx !== null;
}

/** 优先用新接口 getWindowInfo，老接口 getSystemInfoSync 作为回退。 */
function readWindowInfo() {
  if (!hasWx()) return null;
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo();
      return {
        pixelRatio: info.pixelRatio || 1,
        windowWidth: info.windowWidth,
        windowHeight: info.windowHeight,
        safeArea: info.safeArea
      };
    }
    const legacy = wx.getSystemInfoSync();
    return {
      pixelRatio: legacy.pixelRatio || 1,
      windowWidth: legacy.windowWidth,
      windowHeight: legacy.windowHeight,
      safeArea: legacy.safeArea
    };
  } catch (err) {
    return null;
  }
}

function createEnv() {
  const env = {
    available: false,
    canvas: null,
    ctx: null,
    metrics: { width: 375, height: 667, safeTop: 20, safeBottom: 0, dpr: 1 },
    storage: {
      get: function () {
        return null;
      },
      set: function () {}
    },
    vibrate: {
      short: function () {},
      medium: function () {}
    },
    onTouchStart: function () {},
    onShow: function () {},
    raf: function (fn) {
      return setTimeout(function () {
        fn(Date.now());
      }, 16);
    },
    now: function () {
      return typeof Date !== 'undefined' ? Date.now() : 0;
    }
  };

  if (!hasWx() || typeof wx.createCanvas !== 'function') return env;

  let canvas = null;
  try {
    canvas = wx.createCanvas();
  } catch (err) {
    return env;
  }
  if (!canvas || typeof canvas.getContext !== 'function') return env;

  const ctx = canvas.getContext('2d');
  if (!ctx) return env;

  const info = readWindowInfo() || {};
  const windowWidth = info.windowWidth || 375;
  const windowHeight = info.windowHeight || 667;

  // 画布后备存储是物理像素，绘制坐标统一用逻辑像素，所以要把变换按实际比例设好。
  // 不直接改 canvas.width/height —— 主画布尺寸由宿主决定，改动它会出问题。
  const scaleX = canvas.width ? canvas.width / windowWidth : info.pixelRatio || 1;
  const scaleY = canvas.height ? canvas.height / windowHeight : info.pixelRatio || 1;
  if (typeof ctx.setTransform === 'function') ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

  let safeTop = 20;
  let safeBottom = 0;
  if (info.safeArea) {
    safeTop = Math.max(0, info.safeArea.top || 0);
    safeBottom = Math.max(0, windowHeight - (info.safeArea.bottom || windowHeight));
  }

  env.available = true;
  env.canvas = canvas;
  env.ctx = ctx;
  env.metrics = {
    width: windowWidth,
    height: windowHeight,
    safeTop,
    safeBottom,
    dpr: info.pixelRatio || 1,
    scaleX,
    scaleY
  };

  // 存储
  if (typeof wx.getStorageSync === 'function' && typeof wx.setStorageSync === 'function') {
    env.storage = {
      get: function (key, fallback) {
        try {
          const value = wx.getStorageSync(key);
          return value === '' || value === undefined ? fallback : value;
        } catch (err) {
          return fallback;
        }
      },
      set: function (key, value) {
        try {
          wx.setStorageSync(key, value);
        } catch (err) {
          /* 存储失败不影响游戏进行 */
        }
      }
    };
  }

  // 震动
  if (typeof wx.vibrateShort === 'function') {
    env.vibrate = {
      short: function (type) {
        try {
          wx.vibrateShort({ type: type || 'light' });
        } catch (err) {
          try {
            wx.vibrateShort();
          } catch (ignored) {
            /* 部分机型不支持，忽略 */
          }
        }
      },
      medium: function () {
        this.short('medium');
      }
    };
  }

  // 触摸：取 clientX/clientY，因为绘制坐标已经建立在逻辑像素上
  if (typeof wx.onTouchStart === 'function') {
    env.onTouchStart = function (handler) {
      wx.onTouchStart(function (res) {
        const touch = res && res.touches && res.touches[0];
        if (!touch) return;
        handler(touch.clientX, touch.clientY, res);
      });
    };
  }

  if (typeof wx.onShow === 'function') {
    env.onShow = function (handler) {
      wx.onShow(handler);
    };
  }

  if (typeof requestAnimationFrame === 'function') {
    env.raf = function (fn) {
      return requestAnimationFrame(fn);
    };
  }
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    env.now = function () {
      return performance.now();
    };
  }

  return env;
}

module.exports = { createEnv };
