/**
 * 内核统一出口。
 *
 * 这一层刻意不 require 任何 wx.* / Canvas 相关模块，因此
 * `require('./js/core')` 在 Node 下可以直接跑，测试无需任何桩件。
 */
const config = require('./config');
const tower = require('./tower');
const crane = require('./crane');
const judge = require('./judge');
const combo = require('./combo');
const score = require('./score');
const run = require('./run');
const { validateConfig } = require('./validate');

module.exports = {
  config,
  tower,
  crane,
  judge,
  combo,
  score,
  run,
  validateConfig
};
