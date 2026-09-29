/**
 * 源码清单：预览壳需要按需取回哪些文件。
 *
 * 单独成一个模块而不是写在 serve.js 里，有两个理由：
 *   1. 测试要能引用同一份逻辑，而不是在测试里重写一遍扫描规则
 *      （重写的规则一旦和实现分叉，测试就变成了自欺）
 *   2. 懒加载的清单必须与磁盘实际内容一致，这是「白屏」类问题的源头之一
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 递归收集目录下的 .js，返回相对工程根的路径列表（跳过隐藏目录）。 */
function collectJs(dir, prefix, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      collectJs(path.join(dir, entry.name), prefix + entry.name + '/', out);
    } else if (entry.name.endsWith('.js')) {
      out.push(prefix + entry.name);
    }
  }
  return out;
}

/** 游戏运行需要的全部源码：js/ 下的所有 .js。 */
function buildManifest() {
  return collectJs(path.join(ROOT, 'js'), 'js/', []);
}

module.exports = { ROOT, buildManifest, collectJs };
