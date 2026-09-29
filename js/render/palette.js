/**
 * 配色入口。
 *
 * 真正的主题数据在 ./themes.js（共有晴日 / 黄昏 / 夜晚三套，见那里的说明）。
 * 这里只负责决定「当前用哪一套」并把它导出 ——
 * 渲染层其余模块统一 `require('./palette')`，拿到的始终是一个完整的主题对象，
 * 所以换皮肤不需要改动任何绘制逻辑。
 *
 * 三套主题的键完全一致（都由 themes.js 的 merge 补齐共享部分），
 * 因此也可以把任意一套直接传给渲染函数来预览，例如出图工具就是这么做的。
 */
const themes = require('./themes');

module.exports = themes.default;
