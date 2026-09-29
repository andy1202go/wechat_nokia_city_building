/**
 * 微信小游戏入口。
 *
 * 这个文件只做一件事：启动游戏。所有逻辑在 js/ 下：
 *   js/core/      纯逻辑内核，零 wx 依赖，可在 Node 下直接跑测试
 *   js/render/    Canvas 2D 渲染层，只读内核状态，不写
 *   js/audio/     程序合成音效
 *   js/platform/  wx.* 能力适配，全部做特性检测
 *
 * 改手感参数请只改 js/core/config.js，改完跑：node tests/run-tests.js
 */
const { boot } = require('./js/game');

boot();
