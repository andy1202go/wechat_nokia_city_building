/**
 * 塔与楼层的绘制。
 *
 * 三个关键设计（见 docs/adr/0003 的 Consequences）：
 *   1. 每层楼按自己真实的绝对位置绘制，玩家能看见「我这一层偏在哪」——
 *      这是可学习性的唯一来源，也是否决「刚体整体倾斜」方案的理由。
 *   2. 整塔再按由偏心导出的倾角轻微旋转，作为「要倒了」的预警。
 *      倾角是派生量，不是独立状态，所以不会与判定脱节。
 *   3. 坍塌时在倾角之上再叠加一个**纯演出**的倒塌旋转（见 docs/adr/0005）。
 *      它来自表现层状态而非内核，因为内核的倾角是派生量、渲染层只读。
 *
 * 另外画一条地基中线：没有它，玩家无法理解塔为什么会倒。
 */
const towerCore = require('../core/tower');
const vpMod = require('./viewport');
const draw = require('./draw');
const presenterMod = require('./presenter');

/**
 * 楼层的立面参数。都是「占一层楼宽/高的比例」，所以不随屏幕缩放而变。
 *
 * 这三个数一起决定「一摞方块」读起来是积木还是建筑 —— 属于形态问题，
 * 与配色无关。配色只负责「不花」，这里负责「不幼稚」。
 */
/** 右侧暗面占宽的比例。低于 ~0.14 就只是一道脏边，读不出「这栋楼有厚度」 */
const SIDE_W_RATIO = 0.16;
/** 窗格。3×3 是「少而长」的取舍，见 drawFloorBlock 里的说明 */
const WIN_COLS = 3;
const WIN_ROWS = 3;

/** 地基中线：从地面向上穿到塔顶之上。颜色随稳定性占用比例从白变红。 */
function drawAxis(ctx, vp, run, cfg, pal) {
  const x = vpMod.worldX(vp, run.tower.foundationCenterX);
  const yTop = vpMod.worldY(vp, towerCore.topY(run.tower, cfg) + 46);
  const yBottom = vpMod.worldY(vp, 0);
  const ratio = towerCore.stabilityUsed(run.tower, cfg);
  const color = ratio >= 0.8 ? pal.axisDanger : pal.axis;

  draw.dashedLine(ctx, x, yTop, x, yBottom, [4, 5], color, 1);
}

/**
 * 视锥剔除：某一层是否可能出现在屏幕内。
 *
 * 必须先把世界坐标换算成屏幕坐标再判断。曾经这里直接拿局部坐标的
 * bottomY（= -(i * 层高)）去和屏幕高度比较 —— 局部 y 在地面之上恒为负，
 * 于是从第 3 层起全部满足 bottomY < -40 而被剔除，画面上只剩最底下两层。
 * 这个 bug 已由 tests/render.test.js 的「高塔楼层确实被绘制」钉住。
 */
function isFloorVisible(vp, index, cfg) {
  const bottomWorldY = index * cfg.FLOOR.height;
  const topWorldY = bottomWorldY + cfg.FLOOR.height;
  const screenTop = vpMod.worldY(vp, topWorldY);
  const screenBottom = vpMod.worldY(vp, bottomWorldY);
  // 余量随层高走。只有「整层都在屏外」时才能剔除，而固定 40 是照着当年的
  // 22 高层高定的：层高变成 64 之后，40 已经装不下一层了。
  const margin = Math.max(40, cfg.FLOOR.height);
  return screenBottom >= -margin && screenTop <= vp.height + margin;
}

/**
 * 单层楼：主体 + 体积感 + 窗格 + 完美落点的金色压顶。
 *
 * 体积感靠三层叠加做出来（受光顶面 / 右侧暗面 / 底部压暗）。
 * 全部是**半透明色叠在主色上**，所以换主题时不用另外配三套明暗色。
 *
 * 注意：明暗带都按圆角半径内缩，否则会从圆角处露出方角 ——
 * 这是不用 clip 的代价，但省掉了每层一次 save/clip/restore 的开销。
 */
function drawFloorBlock(ctx, x, y, w, h, index, floor, vp, cfg, pal, detailed) {
  const color = pal.building[index % pal.building.length];
  const radius = cfg.FLOOR.radius * vp.scale;
  const inset = radius * 0.8;

  draw.fillRoundRect(ctx, x, y, w, h, radius, color, pal.buildingEdge, 1);

  if (detailed) {
    // 右侧暗面：读作「这栋楼有厚度」。
    // 16% 是让这层厚度看得出来的下限 —— 13% 时它读起来只是「右边一道脏」
    const sideW = Math.max(1, w * SIDE_W_RATIO);
    draw.fillRect(ctx, x + w - sideW - 1, y + inset, sideW,
      Math.max(1, h - inset * 2), pal.buildingShade);

    // 顶面受光
    draw.fillRect(ctx, x + inset, y + 1, Math.max(1, w - inset * 2),
      Math.max(1, 1.6 * vp.scale), pal.buildingLight);

    // 底部压暗：让层层之间读得出「叠」而不是「拼」
    draw.fillRect(ctx, x + inset, y + h - Math.max(1, 1.2 * vp.scale),
      Math.max(1, w - inset * 2), Math.max(1, 1.2 * vp.scale), pal.buildingShade);

    // 窗格：3 列 × 3 行，且**每扇窗是竖长条**。
    //
    // 原来 4×4 的均匀方格（窗比栅格矮胖）有两个问题：一是密，64px 里塞 16 扇，
    // 缩小后读作一层「网格贴图」，而不是一栋楼的立面；二是方窗像乐高凸点。
    // 少而长的窗才有建筑感 —— 竖向开窗是塔楼立面的默认语言。
    const padX = w * 0.11;
    const padY = h * 0.15;
    // 窗格整体避开右侧暗面，否则窗户会画到「侧墙」上
    const usableW = w - padX * 2 - w * SIDE_W_RATIO;
    const gridW = usableW / WIN_COLS;
    const gridH = (h - padY * 2) / WIN_ROWS;
    const winW = gridW * 0.58;
    const winH = gridH * 0.70;

    for (let r = 0; r < WIN_ROWS; r += 1) {
      for (let c = 0; c < WIN_COLS; c += 1) {
        const wx = x + padX + c * gridW + (gridW - winW) / 2;
        const wy = y + padY + r * gridH + (gridH - winH) / 2;
        // 亮窗的散列。取模 7 而不是 5：5 会把行号项消掉（5r % 5 === 0），
        // 于是同一层的三行亮窗落在同一列上，读起来是一条竖光带而不是散落的灯。
        // 三个系数也都与 7 互质，保证每层的图案真的不一样
        const lit = (index * 5 + c * 3 + r * 2) % 7 === 0;
        draw.fillRect(ctx, wx, wy, winW, winH, lit ? pal.windowLit : pal.window);
      }
    }
  }

  if (floor && floor.verdict === 'perfect') {
    // 精准落点的即时奖励：顶面一道金边 + 下方一层更淡的金，做出厚度
    const capH = Math.max(1.5, 2.4 * vp.scale);
    draw.fillRect(ctx, x + 2, y, Math.max(1, w - 4), capH, pal.perfectCap);
    draw.fillRect(ctx, x + 2, y + capH, Math.max(1, w - 4), capH * 0.6, pal.buildingLight);
  }
}

/**
 * 地基：地面上的一块铺装带，也是「塔站得了多宽」的唯一视觉提示。
 *
 * 关键：它**不参与塔的任何变换**（倾角 / 摇摆 / 倒塌旋转）。地基是地面的一部分，
 * 不是塔的一部分 —— 这是它和楼层最本质的区别，也是它必须画在变换之外的原因。
 *
 * 配色取自主题的 foundation（三套主题各自按自己的 ground 色系配，见 themes.js），
 * 所以它读起来是「地面在这里换了一种铺装」，而不是「压着一块板」。
 */
function drawFoundation(ctx, vp, cfg, pal) {
  const w = cfg.FOUNDATION.width * vp.scale;
  const h = Math.max(2, cfg.FOUNDATION.height * vp.scale);
  // 地基中心恒在世界中线，与塔的偏心无关：偏心的定义就是「重心相对地基中心」，
  // 所以地基自己不该跟着动
  const x = vpMod.worldX(vp, cfg.WORLD.width / 2) - w / 2;
  const y = vpMod.worldY(vp, 0);

  const edgeW = Math.max(1, 1.2 * vp.scale);
  const edgeH = Math.max(1, 1.2 * vp.scale);

  draw.fillRect(ctx, x, y, w, h, pal.foundation.body);
  // 两侧短竖边与底边：把这条带子收住，否则它看起来像「地面漏了一条」
  draw.fillRect(ctx, x, y, edgeW, h, pal.foundation.edge);
  draw.fillRect(ctx, x + w - edgeW, y, edgeW, h, pal.foundation.edge);
  draw.fillRect(ctx, x, y + h - edgeH, w, edgeH, pal.foundation.edge);
  // 与地面相接的受光上边缘。它同时也是那条「塔能在多宽的范围内站住」的刻度
  draw.fillRect(ctx, x, y, w, Math.max(1, 1.6 * vp.scale), pal.foundation.top);
}

function drawTower(ctx, vp, run, presenter, cfg, pal) {
  const tower = run.tower;
  const count = tower.floors.length;
  const scaledFloorW = cfg.FLOOR.width * vp.scale;
  const scaledFloorH = cfg.FLOOR.height * vp.scale;

  const originX = vpMod.worldX(vp, tower.foundationCenterX);
  const originY = vpMod.worldY(vp, 0);
  const lean = towerCore.leanAngle(tower, cfg) * cfg.VISUAL.leanVisualGain;
  // 倒向哪一侧：取自偏移心的符号，与判定同源。eccentricitySigned 为 0 时按 +x 侧处理
  const fallSign = towerCore.eccentricitySigned(tower) < 0 ? -1 : 1;
  const sweep = presenterMod.collapseTilt(presenter, cfg, fallSign);
  const swayPhase = presenter.t * Math.PI * 2 * cfg.VISUAL.swayHz;
  const sway = Math.sin(swayPhase) * cfg.VISUAL.swayAmplitude * tower.sway * vp.scale;

  // 地基先画，而且**不进下面任何一个变换** —— 它是地面的一部分，不是塔的一部分。
  // 曾经它被画在 ctx.rotate(lean) 之后，塔一歪它就跟着翘：一端扎进地面、
  // 一端翘到草地上，压着一块平整贯通的地面，整幅画面读起来就是跷跷板。
  drawFoundation(ctx, vp, cfg, pal);

  ctx.save();
  ctx.translate(originX + sway, originY);

  if (sweep !== 0) {
    // 绕「倾倒侧的地基边缘」旋转，而不是绕中线：
    // 绕中线转会让塔身的一角扎进地面，看起来像整座塔陷下去，而不是倒下去。
    // 绕边缘转则是一侧抬起、另一侧始终贴地，才读得出「翻倒」。
    const pivotX = fallSign * (cfg.FOUNDATION.width / 2) * vp.scale;
    ctx.translate(pivotX, 0);
    ctx.rotate(sweep);
    ctx.translate(-pivotX, 0);
  }

  ctx.rotate(lean);

  // 楼层：底层的底面贴在地面（y = 0），向上逐层堆叠
  for (let i = 0; i < count; i += 1) {
    const floor = tower.floors[i];
    if (!isFloorVisible(vp, i, cfg)) continue;

    const bottomY = -(i * scaledFloorH);
    const squash = presenterMod.squashScale(presenter, i, cfg);
    const h = scaledFloorH * squash;
    const x = (floor.x - tower.foundationCenterX) * vp.scale - scaledFloorW / 2;
    const y = bottomY - h;

    drawFloorBlock(ctx, x, y, scaledFloorW, h, i, floor, vp, cfg, pal, scaledFloorH >= 9);
  }

  ctx.restore();
}

// WIN_COLS / WIN_ROWS 一并导出：测试要按「每层几个窗格」来设下界，
// 写死数字会在改窗格时静默失效（阈值大于实际值，却仍被别处的 fillRect 垫高而通过）。
module.exports = { drawTower, drawAxis, drawFloorBlock, drawFoundation, isFloorVisible, WIN_COLS, WIN_ROWS };
