/**
 * 音效：全部用 Web Audio 程序合成，零音频文件。
 *
 * 这样做的理由与「代码即美术」一致（见 docs/adr/0002）：不引入任何外部素材，
 * 包体为零、无版权风险，且音高可以跟着连击数实时变化。
 *
 * 所有调用都做特性检测与 try/catch：宿主不支持 Web Audio 时静默失效，
 * 游戏照常能玩。
 */
const DEFAULT = require('../core/config');

function createSfx(cfg = DEFAULT) {
  const sfx = {
    enabled: false,
    ctx: null,
    master: null,
    muteGain: 1,
    cfg: cfg
  };

  if (!cfg.AUDIO.enabled) return sfx;
  if (typeof wx === 'undefined' || typeof wx.createWebAudioContext !== 'function') return sfx;

  try {
    const audioCtx = wx.createWebAudioContext();
    if (!audioCtx) return sfx;

    const master = audioCtx.createGain();
    master.gain.value = cfg.AUDIO.masterVolume;
    master.connect(audioCtx.destination);

    sfx.ctx = audioCtx;
    sfx.master = master;
    sfx.enabled = true;
  } catch (err) {
    sfx.enabled = false;
  }
  return sfx;
}

/** 部分宿主需要一次用户手势才能唤醒音频上下文。 */
function resume(sfx) {
  if (!sfx.enabled || !sfx.ctx) return;
  if (sfx.ctx.state === 'suspended' && typeof sfx.ctx.resume === 'function') {
    try {
      sfx.ctx.resume();
    } catch (err) {
      /* 忽略 */
    }
  }
}

function setMuted(sfx, muted) {
  sfx.muteGain = muted ? 0 : 1;
  if (sfx.enabled && sfx.master) {
    try {
      sfx.master.gain.value = sfx.cfg.AUDIO.masterVolume * sfx.muteGain;
    } catch (err) {
      /* 忽略 */
    }
  }
}

/** 单个带包络的振荡器音。 */
function tone(sfx, spec) {
  if (!sfx.enabled || sfx.muteGain === 0) return;

  const ctx = sfx.ctx;
  const start = ctx.currentTime + (spec.delay || 0);
  const dur = spec.dur || 0.12;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = spec.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, spec.freq), start);
    if (spec.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqEnd), start + dur);
    }

    const peak = Math.max(0.0002, spec.gain === undefined ? 0.28 : spec.gain);
    const attack = spec.attack === undefined ? 0.006 : spec.attack;

    // exponentialRamp 不接受 0，所以用 0.0001 代替静音
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(gain);
    gain.connect(sfx.master);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  } catch (err) {
    /* 音效失败不影响游戏 */
  }
}

const SOUNDS = {
  // 松手：短促的下滑，提示「已经放出」
  release: function (sfx) {
    tone(sfx, { type: 'triangle', freq: 620, freqEnd: 300, dur: 0.09, gain: 0.15 });
  },

  // 一般落点：低沉的落块声
  imperfect: function (sfx) {
    tone(sfx, { type: 'sine', freq: 150, freqEnd: 84, dur: 0.16, gain: 0.32 });
    tone(sfx, { type: 'triangle', freq: 300, freqEnd: 180, dur: 0.08, gain: 0.09 });
  },

  // 完美落点：两个上行音，精准的正反馈
  perfect: function (sfx) {
    tone(sfx, { type: 'sine', freq: 880, dur: 0.09, gain: 0.2 });
    tone(sfx, { type: 'sine', freq: 1318, dur: 0.14, gain: 0.16, delay: 0.07 });
  },

  // 连击升级：音高随连击数半音上行，越连越亮
  combo: function (sfx, level) {
    const step = Math.min(12, Math.max(0, (level || 2) - 2));
    const freq = 660 * Math.pow(1.0595, step * 2);
    tone(sfx, { type: 'triangle', freq: freq, dur: 0.1, gain: 0.13 });
    tone(sfx, { type: 'sine', freq: freq * 1.5, dur: 0.1, gain: 0.07, delay: 0.05 });
  },

  // 失误：下行锯齿，明确但不刺耳
  miss: function (sfx) {
    tone(sfx, { type: 'sawtooth', freq: 320, freqEnd: 90, dur: 0.3, gain: 0.15 });
  },

  // 封顶：中性收尾。机会用完了，但塔还站着，不该听起来像失败
  toppedOut: function (sfx) {
    tone(sfx, { type: 'sine', freq: 523, dur: 0.22, gain: 0.18 });
    tone(sfx, { type: 'sine', freq: 392, dur: 0.42, gain: 0.16, delay: 0.18 });
  },

  // 坍塌：低频下坠，配合画面抖动
  collapse: function (sfx) {
    tone(sfx, { type: 'sawtooth', freq: 180, freqEnd: 40, dur: 0.85, gain: 0.24 });
    tone(sfx, { type: 'square', freq: 90, freqEnd: 30, dur: 0.7, gain: 0.1, delay: 0.04 });
  }
};

function play(sfx, name, arg) {
  const sound = SOUNDS[name];
  if (sound) sound(sfx, arg);
}

/** 把内核事件翻译成音效。 */
function consumeEvents(sfx, events) {
  if (!events || events.length === 0) return;
  if (!sfx.enabled) return;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];

    if (event.type === 'release') {
      SOUNDS.release(sfx);
    } else if (event.type === 'land') {
      if (event.verdict === 'perfect') {
        SOUNDS.perfect(sfx);
        if (event.comboAfter >= 2) SOUNDS.combo(sfx, event.comboAfter);
      } else if (event.verdict === 'imperfect') {
        SOUNDS.imperfect(sfx);
      } else {
        SOUNDS.miss(sfx);
      }
    } else if (event.type === 'end') {
      if (event.ending === 'collapsed') SOUNDS.collapse(sfx);
      else SOUNDS.toppedOut(sfx);
    }
  }
}

module.exports = { createSfx, consumeEvents, play, resume, setMuted, SOUNDS };
