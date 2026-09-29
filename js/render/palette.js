/**
 * 配色。
 *
 * 全部视觉都是 Canvas 图元绘制，没有任何图片文件（见 docs/adr/0002）。
 * 风格取向是「一眼认得出是那个年代的堆叠建造游戏」：白天蓝天、远处城市剪影、
 * 彩色楼房配深色窗格 —— 但不复用任何原版素材文件。
 *
 * 想换一套皮肤只改这里，不需要动渲染逻辑。
 */
module.exports = {
  sky: { top: '#3E7CC4', mid: '#8FC5E8', bottom: '#DCEFF8' },

  ground: { top: '#7ECB57', bottom: '#4E9E3A', edge: '#3E7E2E' },

  foundation: { body: '#8A8F98', top: '#A6ABB3', edge: '#5C626B' },

  crane: {
    rail: '#5C6470',
    railEdge: '#3F4650',
    trolley: '#454C57',
    rope: '#39404A',
    hook: '#2F343B'
  },

  // 楼层按索引循环取色，形成「彩色楼房」的城市观感
  building: ['#F2C14E', '#4A90D9', '#E88A4A', '#67B26F', '#B476D8', '#E4E1D8'],
  buildingEdge: 'rgba(28, 40, 56, 0.42)',
  window: 'rgba(22, 36, 54, 0.26)',
  windowLit: 'rgba(255, 238, 176, 0.55)',
  // 完美落点的楼层顶部压一道金色，作为「精准」的即时奖励
  perfectCap: '#FFD95C',

  skyline: { far: '#AFC6D8', near: '#C8D8E4' },

  // 地基中线的辅助指示（让玩家看懂塔为什么倒，见 docs/adr/0003 的 Consequences）
  axis: 'rgba(255, 255, 255, 0.50)',
  axisDanger: 'rgba(255, 107, 92, 0.72)',

  hud: {
    bg: 'rgba(10, 22, 38, 0.42)',
    text: '#FFFFFF',
    dim: 'rgba(255, 255, 255, 0.64)',
    track: 'rgba(255, 255, 255, 0.24)',
    safe: '#7BE495',
    warn: '#FFD95C',
    danger: '#FF6B5C',
    accent: '#FFD95C'
  },

  panel: {
    bg: 'rgba(12, 26, 44, 0.90)',
    border: 'rgba(255, 255, 255, 0.20)',
    text: '#FFFFFF',
    dim: 'rgba(255, 255, 255, 0.68)',
    primary: '#F2C14E',
    primaryText: '#20303F',
    ghost: 'rgba(255, 255, 255, 0.14)'
  }
};
