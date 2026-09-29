/**
 * 极简 CommonJS 运行时（仅用于本地预览）。
 *
 * 工程是标准 CJS（require / module.exports），浏览器没有这两个东西。
 * 这里只实现工程实际用到的解析规则，不做通用 npm 解析：
 *   1. 相对路径 './x' / '../x'
 *   2. 省略 .js 后缀
 *   3. 目录下的 index.js
 * 括号外的裸模块（如 'lodash'）会直接抛错 —— 本工程零外部依赖，真出现了就是 bug。
 *
 * 做法是先把源码文本取回，再用 new Function 包装成模块执行。
 * 每个文件独立 eval（而不是整体打包），因此报错的堆栈能精确指到源文件行号，
 * 调试体验与原生 require 接近。
 */
(function (global) {
  'use strict';

  const sources = Object.create(null); // 绝对路径 -> 源码文本
  const cache = Object.create(null); // 绝对路径 -> { exports }

  /** 把 '/./js/../js/core' 这类路径压成 '/js/core' */
  function normalize(p) {
    const parts = p.split('/');
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
      const seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        out.pop();
        continue;
      }
      out.push(seg);
    }
    return '/' + out.join('/');
  }

  function dirname(p) {
    const at = p.lastIndexOf('/');
    return at <= 0 ? '/' : p.slice(0, at);
  }

  /** 按「原样 -> 加 .js -> 补 index.js」的顺序找文件 */
  function resolve(id) {
    if (sources[id]) return id;
    if (sources[id + '.js']) return id + '.js';
    const index = (id === '/' ? '' : id) + '/index.js';
    if (sources[index]) return index;
    return null;
  }

  function requireFrom(baseDir) {
    function localRequire(request) {
      if (request.charAt(0) !== '.') {
        throw new Error('预览壳不支持裸模块名：' + request + '（本工程应当零外部依赖）');
      }
      const target = resolve(normalize(baseDir + '/' + request));
      if (!target) {
        throw new Error('找不到模块 ' + request + '（从 ' + baseDir + ' 引入）');
      }
      return load(target);
    }
    return localRequire;
  }

  function load(id) {
    if (cache[id]) return cache[id].exports;

    const mod = { exports: {} };
    cache[id] = mod;

    const dir = dirname(id);
    const wrapped =
      sources[id] + '\n//# sourceURL=' + id; // 让浏览器把这段 eval 认成该文件，堆栈可读

    const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', wrapped);
    fn(mod, mod.exports, requireFrom(dir), id, dir);

    return mod.exports;
  }

  /**
   * 取回 manifest 里列出的全部源码并启动游戏。
   *
   * 注意：这里直接调 js/game.js 的 boot()，与根目录 game.js 的内容完全一致
   * （根入口就是 `require('./js/game').boot()`）。之所以不绕一层根入口，
   * 是为了拿到 boot() 的返回值交给预览页做状态面板。
   */
  function boot() {
    // 用绝对路径：预览页可能挂在 '/' 或 '/dev/'，相对路径会在前者上解析错
    return fetch('/dev/manifest.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('取 manifest 失败：HTTP ' + res.status);
        return res.json();
      })
      .then(function (files) {
        return Promise.all(
          files.map(function (file) {
            return fetch('/' + file, { cache: 'no-store' }).then(function (res) {
              if (!res.ok) throw new Error('取 ' + file + ' 失败：HTTP ' + res.status);
              return res.text();
            });
          })
        ).then(function (texts) {
          files.forEach(function (file, i) {
            sources['/' + file] = texts[i];
          });
          return files.length;
        });
      })
      .then(function (count) {
        const game = load('/js/game.js');
        return { fileCount: count, game: game.boot() };
      });
  }

  global.__cjs = {
    boot: boot,
    /** 控制台里可以直接 __cjs.load('/js/core/config.js') 查看实时参数 */
    load: load,
    sources: sources
  };
})(window);
