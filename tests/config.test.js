/**
 * 参数自检测试。
 *
 * 这个项目最常见的失误是「调参调出一个内部自相矛盾的配置」，而这类错误在模拟器里
 * 只表现为怪异手感、不会报错。所以这里既验证默认配置自洽，也逐条验证体检能抓出问题。
 */
const core = require('../js/core');
const h = require('./helpers');

module.exports = function register(t) {
  const cfg = core.config;

  function problemsWith(patch) {
    return core.validateConfig(h.withConfig(patch));
  }

  t.test('默认配置通过全部自检', () => {
    const problems = core.validateConfig(cfg);
    t.eq(problems.length, 0, `默认配置应当自洽，实际报告：\n    ${problems.join('\n    ')}`);
  });

  t.test('抓出：振幅不小于摆臂长（摆角无解）', () => {
    const problems = problemsWith({ CRANE: { amplitude: cfg.CRANE.pendulumLength } });
    t.gt(problems.length, 0, '振幅等于摆臂长必须被拦下');
    t.assert(
      problems.join(' ').indexOf('pendulumLength') >= 0,
      '提示信息应点明 pendulumLength'
    );
  });

  t.test('抓出：失误容差偏离楼层半宽（破坏物理一致性）', () => {
    t.gt(problemsWith({ TOLERANCE: { missRatio: 0.7 } }).length, 0, 'missRatio = 0.7');
    t.gt(problemsWith({ TOLERANCE: { missRatio: 0.4 } }).length, 0, 'missRatio = 0.4');
    t.eq(problemsWith({ TOLERANCE: { missRatio: 0.5 } }).length, 0, 'missRatio = 0.5 应通过');
  });

  t.test('抓出：完美容差不小于失误容差（一般落点区间消失）', () => {
    const problems = problemsWith({ TOLERANCE: { perfectRatio: 0.5 } });
    t.gt(problems.length, 0, '完美容差等于失误容差必须被拦下');
  });

  t.test('抓出：难度曲线反转（最小周期大于起始周期）', () => {
    const problems = problemsWith({ CRANE: { periodSecAtMin: 5 } });
    t.gt(problems.length, 0, '最小周期大于起始周期必须被拦下');
    t.assert(problems.join(' ').indexOf('periodSecAtMin') >= 0, '提示信息应点明 periodSecAtMin');
  });

  t.test('抓出：吊点高度不足以容纳摆臂', () => {
    const problems = problemsWith({ CRANE: { pivotHeightAboveTop: 100 } });
    t.gt(problems.length, 0, '吊点低于摆臂长必须被拦下');
  });

  t.test('抓出：负的高塔惩罚会反转难度曲线', () => {
    const problems = problemsWith({ STABILITY: { topHeavyGain: -1 } });
    t.gt(problems.length, 0, '负的 topHeavyGain 必须被拦下');
  });

  t.test('抓出：坍塌比例越出 (0, 1]', () => {
    t.gt(problemsWith({ STABILITY: { collapseRatio: 0 } }).length, 0, 'collapseRatio = 0');
    t.gt(problemsWith({ STABILITY: { collapseRatio: 1.5 } }).length, 0, 'collapseRatio = 1.5');
  });

  t.test('抓出：失误额度为 0 或负', () => {
    t.gt(problemsWith({ RUN: { missBudget: 0 } }).length, 0, 'missBudget = 0');
    t.gt(problemsWith({ RUN: { missBudget: -1 } }).length, 0, 'missBudget = -1');
  });

  t.test('抓出：地基比楼层还窄', () => {
    const problems = problemsWith({ FOUNDATION: { width: cfg.FLOOR.width - 1 } });
    t.gt(problems.length, 0, '地基宽度小于楼层宽度必须被拦下');
  });

  t.test('抓出：失误容差越过一层的坍塌阈值（判定档位会倒挂）', () => {
    // 只放大楼层宽度、地基不动 —— 这是最容易踩到的一种改法：
    // FLOOR 与 FOUNDATION 在 config 里隔了好几节，看不出两者是绑在一起的。
    const problems = problemsWith({ FLOOR: { width: 88 } });
    t.gt(problems.length, 0, '楼层宽度超过地基的判定尺度时必须被拦下');
    t.assert(
      problems.join(' ').indexOf('FOUNDATION.width') >= 0,
      '提示信息应点明「要同步放大 FOUNDATION.width」'
    );

    // 同比例放大之后应当重新自洽
    t.eq(
      problemsWith({ FLOOR: { width: 88 }, FOUNDATION: { width: 176 } }).length,
      0,
      '楼层与地基同比例放大后不应报错'
    );
  });

  t.test('抓出：振幅小于两层坍塌阈值（局面会变成必死）', () => {
    // 注意：collapseRatio 上限为 1，两层阈值最大也只有约 61，小于默认振幅 118，
    // 所以必须连同振幅一起调小才能触发这条检查。
    const twoFloorThreshold =
      (cfg.FOUNDATION.width / 2) * cfg.STABILITY.collapseRatio * (1 / (1 + cfg.STABILITY.topHeavyGain));
    const problems = problemsWith({ CRANE: { amplitude: twoFloorThreshold - 5 } });
    t.gt(problems.length, 0, '吊车够不到塔顶时必须被拦下');
    t.assert(problems.join(' ').indexOf('amplitude') >= 0, '提示信息应点明 amplitude');

    t.eq(
      problemsWith({ CRANE: { amplitude: twoFloorThreshold + 5 } }).length,
      0,
      '振幅刚够到时不应报错'
    );
  });

  t.test('默认配置的关键不变式同时成立', () => {
    t.lt(cfg.CRANE.amplitude, cfg.CRANE.pendulumLength, '振幅 < 摆臂长');
    t.lt(cfg.TOLERANCE.perfectRatio, cfg.TOLERANCE.missRatio, '完美容差 < 失误容差');
    t.eq(cfg.TOLERANCE.missRatio, 0.5, '失误容差为楼层半宽');
    t.gt(cfg.FOUNDATION.width, cfg.FLOOR.width, '地基宽于楼层');
    t.gt(cfg.CRANE.pivotHeightAboveTop, cfg.CRANE.pendulumLength, '吊点高于摆臂长');
    t.gt(cfg.CRANE.periodSecAtStart, cfg.CRANE.periodSecAtMin, '周期随塔高收紧');

    const twoFloorThreshold =
      (cfg.FOUNDATION.width / 2) * cfg.STABILITY.collapseRatio * (1 / (1 + cfg.STABILITY.topHeavyGain));
    t.gt(cfg.CRANE.amplitude, twoFloorThreshold, '振幅足够够到濒临坍塌的塔顶');

    const oneFloorThreshold = (cfg.FOUNDATION.width / 2) * cfg.STABILITY.collapseRatio;
    t.lt(
      cfg.FLOOR.width * cfg.TOLERANCE.missRatio,
      oneFloorThreshold,
      '失误容差小于一层的坍塌阈值（否则「一般落点」会直接导致坍塌、而失误反而不塌）'
    );
  });

  t.test('config 里每个参数都真的被代码用到（防止出现「改了没反应」的死配置）', () => {
    // 死配置比缺参数更糟：调参的人改它、发现没反应、然后开始怀疑整个配置系统。
    //
    // 判据是启发式的，不追求形式化证明：
    //   某个 SECTION.key，只要存在一个源码文件同时提到了该 SECTION 名与该 key 名，就算被用到。
    // 这样可以覆盖 cfg.SCORE.collapsePenalty 这类属性访问，
    // 也能覆盖 score.js 里 `const { collapsePenalty } = cfg.SCORE` 这类解构写法。
    // 代价是可能漏报（同一文件里恰好出现同名的无关标识符），但足以拦住真正明显的死配置。
    const fs = require('fs');
    const path = require('path');

    const root = path.join(__dirname, '..', 'js');
    const files = [];

    (function walk(dir) {
      fs.readdirSync(dir).forEach(function (entry) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.js$/.test(entry) && entry !== 'config.js') {
          files.push({ name: full.slice(root.length + 1), text: fs.readFileSync(full, 'utf8') });
        }
      });
    })(root);

    const unused = [];

    Object.keys(cfg).forEach(function (section) {
      const group = cfg[section];
      if (group === null || typeof group !== 'object') return;

      const sectionPattern = new RegExp('\\b' + section + '\\b');
      const sectionFiles = files.filter(function (file) {
        return sectionPattern.test(file.text);
      });

      Object.keys(group).forEach(function (key) {
        const keyPattern = new RegExp('\\b' + key + '\\b');
        const used = sectionFiles.some(function (file) {
          return keyPattern.test(file.text);
        });
        if (!used) unused.push(`${section}.${key}`);
      });
    });

    t.eq(
      unused.length,
      0,
      `以下参数在 config.js 里定义了、但没有任何代码读取它：\n    ${unused.join('\n    ')}`
    );
  });

  t.test('反过来：代码里不该引用 config 中不存在的字段', () => {
    // 拼错字段名在 Node 下取到 undefined、不报错，到真机上才表现为「某个功能静默失效」。
    // 靠 render/boot 的烟囱测试只能覆盖跑到的分支，这里做一次全量兜底。
    const fs = require('fs');
    const path = require('path');

    const root = path.join(__dirname, '..', 'js');
    const missing = [];

    (function walk(dir) {
      fs.readdirSync(dir).forEach(function (entry) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          walk(full);
          return;
        }
        if (!/\.js$/.test(entry)) return;
        if (entry === 'config.js') return; // 定义处自身

        const text = fs.readFileSync(full, 'utf8');
        const matcher = /\b(?:cfg|config|DEFAULT)\.[A-Z][A-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*/g;
        let found = matcher.exec(text);
        while (found) {
          const parts = found[0].split('.');
          const section = parts[1];
          const key = parts[2];
          const group = cfg[section];
          if (group === undefined || group[key] === undefined) {
            missing.push(`${entry}: ${found[0]}`);
          }
          found = matcher.exec(text);
        }
      });
    })(root);

    t.eq(
      missing.length,
      0,
      `以下引用指向 config 中不存在的字段（多半是拼写错误）：\n    ${missing.join('\n    ')}`
    );
  });
};
