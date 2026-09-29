/**
 * 内核测试入口。
 *
 *   node tests/run-tests.js
 *
 * 零依赖，不需要 npm install。退出码 0 表示全部通过、1 表示有失败。
 */
const harness = require('./harness');

const SUITES = [
  ['config · 参数自检', './config.test.js'],
  ['tower · 塔与稳定性', './tower.test.js'],
  ['crane · 吊车与钟摆几何', './crane.test.js'],
  ['judge · 容差判定', './judge.test.js'],
  ['combo · 连击机', './combo.test.js'],
  ['run · 局面状态机', './run.test.js'],
  ['render · 视口 / 表现层 / 渲染链', './render.test.js'],
  ['game · 编排层端到端', './boot.test.js'],
  ['dev · 本地预览壳', './dev-server.test.js']
];

process.stdout.write('摩天叠楼师 · 内核单元测试\n');
process.stdout.write('='.repeat(52) + '\n');

SUITES.forEach((entry) => {
  const title = entry[0];
  const file = entry[1];
  harness.section(title);
  try {
    const register = require(file);
    register(harness);
  } catch (err) {
    // 套件文件本身加载失败（require 写错、语法错误）绝不能拖垮整个进程：
    // 进程崩掉时一条用例统计都看不到，其它套件的结果也一起丢了，
    // 而真正的原因（哪个文件、哪一行）会被一堆 Node 内部堆栈埋掉。
    // 借 test() 自带的 try/catch 把它记成一条可读的失败。
    harness.test(`套件文件加载失败：${file}`, function () {
      throw err;
    });
  }
});

const failed = harness.summary();
process.exit(failed > 0 ? 1 : 0);
