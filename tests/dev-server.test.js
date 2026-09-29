/**
 * 本地预览壳（dev/）的回归测试。
 *
 * 为什么值得给一个开发工具写测试：**它坏掉的时候是静默的**。
 * <script> 加载失败既不触发 window.onerror、也不抛异常，页面上只留下白屏。
 * 搭这个壳的过程中就真的踩到了：<script src="./wx-shim.js"> 在挂在 '/' 的页面上
 * 会解析成 '/wx-shim.js' 而 404，排查整一轮才定位 —— 因为错误根本没出声。
 * 下面这几条把同类问题钉在提交之前。
 *
 * 全部为静态检查 + 一次真实的模块加载：同步执行，不依赖浏览器。
 */
const fs = require('fs');
const path = require('path');

const manifestMod = require('../dev/manifest');
const { createStubPlatform } = require('./canvas-stub');

const ROOT = manifestMod.ROOT;

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

/** 取出 HTML 里所有 <script src="..."> 的值。 */
function scriptSources(html) {
  const out = [];
  const pattern = /<script[^>]*\bsrc\s*=\s*"([^"]+)"/g;
  let matched = pattern.exec(html);
  while (matched !== null) {
    out.push(matched[1]);
    matched = pattern.exec(html);
  }
  return out;
}

module.exports = function (t) {
  t.test('源码清单扫的是 js/ 且每个文件都读得到', () => {
    const files = manifestMod.buildManifest();

    // 钉住扫描根目录：扫错目录时上面的数量断言可能仍然通过，但这里会立刻失败
    ['js/game.js', 'js/core/config.js', 'js/render/index.js', 'js/platform/env.js', 'js/audio/sfx.js'].forEach(
      (expected) => {
        t.assert(files.indexOf(expected) >= 0, `清单里缺少 ${expected}`);
      }
    );

    t.gt(files.length, 15, '清单至少应包含 15 个源码文件');

    const unreadable = files.filter((file) => !exists(file));
    t.eq(unreadable.length, 0, `以下文件在清单里但磁盘上读不到：\n    ${unreadable.join('\n    ')}`);

    const empty = files.filter((file) => read(file).trim().length === 0);
    t.eq(empty.length, 0, `以下文件是空的：${empty.join(', ')}`);
  });

  t.test('预览页引用的脚本全部存在，且用绝对路径（钉住导致白屏的 404）', () => {
    const sources = scriptSources(read('dev/index.html'));
    t.gt(sources.length, 0, '预览页应至少引用一个脚本');

    const problems = [];
    sources.forEach((src) => {
      if (src.charAt(0) !== '/') {
        // 页面挂在 '/'，而脚本在 '/dev/' 下；相对路径会解析到根目录去
        problems.push(`${src} —— 必须写成以 / 开头的绝对路径`);
      } else if (!exists(src.replace(/^\//, ''))) {
        problems.push(`${src} —— 磁盘上不存在`);
      }
    });

    t.eq(problems.length, 0, `预览页的脚本引用有问题：\n    ${problems.join('\n    ')}`);
  });

  t.test('加载器与服务器对 manifest 路径的约定一致', () => {
    // 这一对字面量必须同步：任何一边改了路径，另一边就会 404 而页面只表现为白屏
    const loader = read('dev/loader.js');
    const serve = read('dev/serve.js');

    t.assert(loader.indexOf('/dev/manifest.json') >= 0, 'loader 应以绝对路径 /dev/manifest.json 取清单');
    t.assert(serve.indexOf('/dev/manifest.json') >= 0, 'serve 应处理 /dev/manifest.json 这个路径');
  });

  t.test('浏览器加载器能解析整个依赖图、启动游戏并稳定跑帧', () => {
    const platform = createStubPlatform({ windowWidth: 375, windowHeight: 667 });
    const savedWindow = global.window;

    try {
      // loader.js 是浏览器脚本，靠 window 全局挂载自己的导出
      global.window = global;
      delete require.cache[require.resolve('../dev/loader.js')];
      require('../dev/loader.js');

      t.assert(global.__cjs && typeof global.__cjs.load === 'function', 'loader 应导出 __cjs.load');

      // 用真实源码文本填满加载器的文件表 —— 等价于浏览器里 fetch 回来的那批响应。
      // 这一步会走通 loader 自己的解析规则（相对路径 / 省略后缀 / 目录 index.js），
      // 任何一条规则写错都会在这里抛「找不到模块」。
      manifestMod.buildManifest().forEach((file) => {
        global.__cjs.sources['/' + file] = read(file);
      });

      const game = global.__cjs.load('/js/game.js').boot();
      t.assert(game !== null && typeof game === 'object', 'boot() 不应返回空值');

      t.eq(platform.pump(240, 16), 240, '主循环应连续接受 240 帧');
      platform.touch(120, 200);
      t.eq(platform.pump(150, 16), 150, '投放之后主循环应继续');

      t.eq(
        platform.stub.problems.length,
        0,
        `渲染过程中出现异常数值：\n    ${platform.stub.problems.slice(0, 6).join('\n    ')}`
      );
    } finally {
      platform.cleanup();
      delete global.__cjs;
      if (savedWindow === undefined) delete global.window;
      else global.window = savedWindow;
    }
  });

  t.test('dev/ 不会被当成游戏代码打进小游戏包', () => {
    const config = JSON.parse(read('project.config.json'));

    t.eq(config.compileType, 'game', '工程必须以小游戏类型编译');

    const ignored = ((config.packOptions && config.packOptions.ignore) || []).map((entry) => entry.value);
    ['dev', 'tests', 'docs'].forEach((folder) => {
      t.assert(ignored.indexOf(folder) >= 0, `打包应忽略 ${folder}/`);
    });
  });
};
