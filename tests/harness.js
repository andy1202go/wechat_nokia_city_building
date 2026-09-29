/**
 * 极简测试框架。零依赖，只用 Node 的 process 输出。
 * 之所以不引 mocha/jest：内核本身零依赖，测试也不该拖进 node_modules。
 */

let currentSection = '';
const results = [];

function section(name) {
  currentSection = name;
  process.stdout.write(`\n${name}\n`);
}

function test(name, fn) {
  try {
    fn();
    results.push({ section: currentSection, name, ok: true });
    process.stdout.write(`  ok    ${name}\n`);
  } catch (err) {
    results.push({ section: currentSection, name, ok: false, message: err.message });
    process.stdout.write(`  FAIL  ${name}\n`);
    process.stdout.write(`        ${err.message}\n`);
  }
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message || '断言失败');
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message || 'eq'}: 期望 ${show(expected)}，实际 ${show(actual)}`);
  }
}

function close(actual, expected, epsilon, message) {
  const eps = epsilon === undefined ? 1e-9 : epsilon;
  if (!(Math.abs(actual - expected) <= eps)) {
    fail(`${message || 'close'}: 期望 ${show(expected)} ± ${eps}，实际 ${show(actual)}`);
  }
}

function lt(a, b, message) {
  if (!(a < b)) fail(`${message || 'lt'}: 期望 ${show(a)} < ${show(b)}`);
}

function gt(a, b, message) {
  if (!(a > b)) fail(`${message || 'gt'}: 期望 ${show(a)} > ${show(b)}`);
}

function show(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  return String(value);
}

function summary() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${'-'.repeat(52)}\n`);
  if (failed.length === 0) {
    process.stdout.write(`全部通过：${passed} 个用例\n`);
  } else {
    process.stdout.write(`通过 ${passed} 个，失败 ${failed.length} 个：\n`);
    failed.forEach((f) => {
      process.stdout.write(`  [${f.section}] ${f.name}\n    ${f.message}\n`);
    });
  }
  return failed.length;
}

module.exports = { section, test, assert, eq, close, lt, gt, fail, summary };
