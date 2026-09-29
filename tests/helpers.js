/**
 * 测试辅助：构造带参数覆盖的配置与局面，以及「按偏差投放」的便捷函数。
 */
const core = require('../js/core');

function deepMerge(target, patch) {
  Object.keys(patch).forEach((key) => {
    const patchValue = patch[key];
    const isPlainObject =
      patchValue !== null && typeof patchValue === 'object' && !Array.isArray(patchValue);
    if (isPlainObject && target[key] && typeof target[key] === 'object') {
      deepMerge(target[key], patchValue);
    } else {
      target[key] = patchValue;
    }
  });
  return target;
}

function cloneConfig() {
  return JSON.parse(JSON.stringify(core.config));
}

/** 深拷贝全局配置并施加局部覆盖，用于试验参数。 */
function withConfig(patch) {
  const cfg = cloneConfig();
  if (patch) deepMerge(cfg, patch);
  return cfg;
}

function createRunWith(patch) {
  return core.run.createRun(patch ? withConfig(patch) : core.config);
}

/** 相对当前塔顶投出一个指定偏差的落点。 */
function dropAtOffset(run, offset) {
  const top = core.tower.topCenterX(run.tower);
  return core.run.landAt(run, top + offset);
}

/** 反复投放直到局面结束或达到上限，返回投出的偏差序列。 */
function dropMany(run, offsets, limit) {
  const cap = limit === undefined ? offsets.length : limit;
  const results = [];
  for (let i = 0; i < cap; i += 1) {
    if (core.run.isEnded(run)) break;
    results.push(dropAtOffset(run, offsets[i % offsets.length]));
  }
  return results;
}

/** 确定性伪随机（LCG），避免测试依赖 Math.random。 */
function makeRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

module.exports = { withConfig, cloneConfig, createRunWith, dropAtOffset, dropMany, makeRandom, deepMerge };
