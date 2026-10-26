// ---------------------------------------------------------------------------
// Live voice harmonizer — AudioWorkletProcessor, loaded by app.js.
//
// Mono mic in → YIN pitch detection → one harmony voice per target
// frequency → summed out (both channels). Two characters:
//
// natural — TD-PSOLA. Re-spaces whole pitch periods ("grains") of the real
//   voice rather than resampling it, so the singer's formants (vowel color)
//   survive the shift instead of going chipmunk/monster. Each grain is taken
//   from the most recent fully-received period, which keeps the delay to
//   roughly 2.5–3 input periods (measured ~10 ms at 220 Hz, ~27 ms at 110 Hz).
//
// messina — channel vocoder, the robotic Bon Iver sound. The mic is split
//   into bands and each band's loudness is imposed on the same band of a
//   synthetic carrier (one sawtooth per target, noise during consonants), so
//   the chord "speaks" with the singer's vowels. Nothing waits for a pitch
//   period, so the delay is a few ms regardless of the input pitch.
// ---------------------------------------------------------------------------
const MAX_HARM_VOICES = 8;
const RING = 16384;               // power of two — many times the longest grain, even at 96 kHz
const MASK = RING - 1;
const DEC_RING = RING / 2;        // 2× decimated copy used only for pitch detection
const DEC_MASK = DEC_RING - 1;
const MARKS = 64;                 // analysis-mark history (power of two)
const MARK_MASK = MARKS - 1;

const DETECT_HOP = 256;           // input samples between pitch estimates
const DETECT_LOWPASS_HZ = 1500;   // pitch lives in the low harmonics; cutting the rest steadies YIN
const YIN_THRESHOLD = 0.15;
const VOICED_MAX_APERIODICITY = 0.2;
const MAX_F0 = 1200;
const OCTAVE_JUMP_FRAMES = 2;     // a sudden ~octave jump must repeat this many frames to be believed
const UNVOICED_HANGOVER = 2;      // frames of "unvoiced" needed before the voices gate off
const RATIO_MIN = 0.25, RATIO_MAX = 4;   // ±2 octaves
const GATE_RAMP_S = 0.005;
const REPORT_EVERY_S = 0.05;
const PSOLA_DELAY_PERIODS = 2.75; // measured onset delay, in input periods, reported to the UI
const LEVEL_RELEASE_S = 0.05;     // full-band input level, used by the vocoder's gate

const VOC_BANDS = 22;
const VOC_LOW_HZ = 100, VOC_HIGH_HZ = 7500;   // band centres, log-spaced
const VOC_Q = 4;                  // per biquad; each band is two in series…
const VOC_Q_CORNER_HZ = 400, VOC_Q_MIN = 1.5; // …widening below the corner, since a narrow low band is slow to respond
const VOC_ENV_PERIODS = 1;        // mic band envelope smoothing, in periods of the band centre
const VOC_ENV_MIN_S = 0.003, VOC_ENV_MAX_S = 0.008; // floor: faster lets the singer's own pitch buzz through
const VOC_CARRIER_RELEASE_S = 0.02; // carrier band envelope: instant attack, so a new note can't overshoot
const VOC_PREEMPH = 0.9;          // flattens the sawtooth's falling spectrum so the top bands have carrier to shape
const VOC_CARRIER_FLOOR = 0.002;  // stops near-empty carrier bands being boosted without limit
const VOC_TRIM = 1.85;            // output level, matched to the natural character
const VOC_DELAY_MIN_MS = 7;       // measured vocoder onset delay: ~7 ms, or one input period for low voices

// Hann window lookup over [-1, 1]
const HANN_RES = 1024;
const HANN = new Float32Array(2 * HANN_RES + 1);
for (let i = 0; i <= 2 * HANN_RES; i++) HANN[i] = 0.5 * (1 + Math.cos(Math.PI * (i / HANN_RES - 1)));

class HarmonizerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};

    this.inBuf = new Float32Array(RING);
    this.n = 0;                   // absolute index of the next input sample

    this.lp = 0;
    this.lpCoef = 1 - Math.exp(-2 * Math.PI * DETECT_LOWPASS_HZ / sampleRate);
    this.decBuf = new Float32Array(DEC_RING);
    this.decN = 0;
    this.sinceDetect = 0;
    this.setMinF0(opts.minF0 || 70);
    this.gate = Math.pow(10, (opts.gateDb != null ? opts.gateDb : -50) / 20);
    this.level = 0;
    this.character = opts.character || 'natural';

    this.f0 = 0;
    this.period = 0;              // input samples per cycle (sampleRate / f0)
    this.voiced = false;
    this.pendingF0 = 0;
    this.pendingCount = 0;
    this.unvoicedFrames = 0;

    this.markPos = new Float64Array(MARKS);
    this.markT = new Float32Array(MARKS);
    this.markHead = 0;
    this.markCount = 0;
    this.lastMark = 0;

    this.voices = Array.from({ length: MAX_HARM_VOICES }, () => ({
      target: 0,                  // Hz the keyboard wants (0 = released)
      hz: 0,                      // Hz being synthesized (holds the last target while fading out)
      out: new Float32Array(RING),
      next: -1,                   // absolute position of the next synthesis mark (-1 = idle)
      gain: 0,
      phase: 0,                   // vocoder carrier oscillator
      carGain: 0,
    }));
    this.gainStep = 1 / (GATE_RAMP_S * sampleRate);
    this.mixScale = 1;
    this.buildVocoder();

    this.sinceReport = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  setMinF0(minF0) {
    const decRate = sampleRate / 2;
    this.maxLag = Math.ceil(decRate / minF0);
    this.minLag = Math.max(2, Math.floor(decRate / MAX_F0));
    this.yinW = Math.max(this.maxLag, Math.round(decRate * 0.008));
    this.yinFrame = new Float32Array(this.yinW + this.maxLag + 1);
    this.yinDiff = new Float32Array(this.maxLag + 2);
  }

  onMessage(msg) {
    if (msg.type === 'targets') {
      for (let i = 0; i < MAX_HARM_VOICES; i++) {
        const hz = msg.hz[i] || 0;
        this.voices[i].target = hz;
        if (hz > 0) this.voices[i].hz = hz;
      }
    } else if (msg.type === 'config') {
      if (msg.minF0) this.setMinF0(msg.minF0);
      if (msg.gateDb != null) this.gate = Math.pow(10, msg.gateDb / 20);
      if (msg.character) this.character = msg.character;
    }
  }

  // ---- pitch detection (YIN, de Cheveigné & Kawahara 2002) ----
  detect() {
    const W = this.yinW, L = this.maxLag, span = W + L + 1;
    if (this.decN < span) return;
    const x = this.yinFrame, d = this.yinDiff;
    const start = this.decN - span;
    for (let j = 0; j < span; j++) x[j] = this.decBuf[(start + j) & DEC_MASK];

    let energy = 0;
    for (let j = L + 1; j < span; j++) energy += x[j] * x[j];
    const rms = Math.sqrt(energy / W);

    // cumulative-mean-normalized difference, written in place over d
    let running = 0, tau = -1;
    d[0] = 1;
    for (let t = 1; t <= L; t++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = x[j] - x[j + t];
        sum += diff * diff;
      }
      running += sum;
      d[t] = running > 0 ? (sum * t) / running : 1;
    }
    for (let t = this.minLag; t <= L; t++) {
      if (d[t] < YIN_THRESHOLD) {
        while (t + 1 <= L && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) { // no dip under the threshold — fall back to the global minimum
      tau = this.minLag;
      for (let t = this.minLag + 1; t <= L; t++) if (d[t] < d[tau]) tau = t;
    }
    const aperiodicity = d[tau];

    let exactTau = tau;
    if (tau > 1 && tau < L) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const denom = a - 2 * b + c;
      if (denom > 0) exactTau = tau + 0.5 * (a - c) / denom;
    }
    const f0 = (sampleRate / 2) / exactTau;
    const isVoiced = aperiodicity < VOICED_MAX_APERIODICITY && rms > this.gate;

    if (!isVoiced) {
      if (++this.unvoicedFrames >= UNVOICED_HANGOVER) this.voiced = false;
      return;
    }
    this.unvoicedFrames = 0;
    if (this.voiced) {
      const jump = f0 / this.f0;
      if (jump < 0.6 || jump > 1.66) {
        if (this.pendingF0 && Math.abs(f0 / this.pendingF0 - 1) < 0.06) this.pendingCount++;
        else { this.pendingF0 = f0; this.pendingCount = 1; }
        if (this.pendingCount < OCTAVE_JUMP_FRAMES) return;
      }
    }
    this.pendingF0 = 0;
    this.pendingCount = 0;
    this.f0 = f0;
    this.period = sampleRate / f0;
    this.voiced = true;
  }

  // ---- analysis marks: one per input period, snapped to the waveform peak ----
  trackMarks() {
    const latest = this.n - 1;
    const T = this.period || sampleRate / 150;
    if (latest - this.lastMark > RING / 2) this.lastMark = latest - 2 * T; // resync after silence
    const reach = Math.floor(T / 4);
    for (;;) {
      const c = Math.round(this.lastMark + T);
      if (c + reach > latest) break;
      let m = c;
      if (this.voiced) {
        let best = -Infinity;
        for (let k = c - reach; k <= c + reach; k++) {
          const v = this.inBuf[k & MASK];
          if (v > best) { best = v; m = k; }
        }
      }
      this.markPos[this.markHead] = m;
      this.markT[this.markHead] = T;
      this.markHead = (this.markHead + 1) & MARK_MASK;
      if (this.markCount < MARKS) this.markCount++;
      this.lastMark = m;
    }
  }

  // Newest mark whose whole grain (±T) has already arrived.
  latestCompleteMark(latest) {
    for (let i = 0; i < this.markCount; i++) {
      const idx = (this.markHead - 1 - i) & MARK_MASK;
      if (this.markPos[idx] + Math.ceil(this.markT[idx]) <= latest) return idx;
    }
    return -1;
  }

  // ---- TD-PSOLA: overlap-add grains at the target pitch's spacing ----
  synthesize(blockStart, N) {
    const blockEnd = blockStart + N - 1;
    const markIdx = this.latestCompleteMark(blockEnd);
    const natural = this.character === 'natural';
    for (const v of this.voices) {
      const want = v.target > 0 && this.voiced && natural;
      if (!want && v.next < 0) continue;
      if (markIdx < 0 || v.hz <= 0) continue;
      const a = this.markPos[markIdx], T = this.markT[markIdx], half = Math.ceil(T);
      if (v.next < blockStart) v.next = blockStart + half;
      const ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, (T * v.hz) / sampleRate));
      const spacing = T / ratio;
      const grainGain = ratio >= 1 ? 1 / ratio : 1 / Math.sqrt(ratio);
      const scale = HANN_RES / half;
      const inBuf = this.inBuf, out = v.out;
      while (v.next - half <= blockEnd) {
        const s = Math.round(v.next);
        const kStart = Math.max(-half, blockStart - s);
        let w = (kStart + half) * scale + 0.5; // +0.5 so the |0 below rounds
        for (let k = kStart; k <= half; k++, w += scale) {
          out[(s + k) & MASK] += grainGain * HANN[w | 0] * inBuf[(a + k) & MASK];
        }
        v.next += spacing;
      }
    }
  }

  // ---- messina character: channel vocoder ----
  buildVocoder() {
    const top = Math.min(VOC_HIGH_HZ, 0.4 * sampleRate);
    this.vocCoef = new Float64Array(VOC_BANDS * 7);
    this.vocState = new Float64Array(VOC_BANDS * 12); // per band, for mic and for carrier: 2 biquads × 2 states, previous output, envelope
    for (let b = 0; b < VOC_BANDS; b++) {
      const fc = VOC_LOW_HZ * Math.pow(top / VOC_LOW_HZ, b / (VOC_BANDS - 1));
      const q = Math.max(VOC_Q_MIN, VOC_Q * Math.min(1, fc / VOC_Q_CORNER_HZ));
      const w = (2 * Math.PI * fc) / sampleRate, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
      const envS = Math.min(VOC_ENV_MAX_S, Math.max(VOC_ENV_MIN_S, VOC_ENV_PERIODS / fc));
      this.vocCoef.set([
        alpha / a0,                   // b0 (bandpass: b1 = 0, b2 = −b0)
        (-2 * Math.cos(w)) / a0,      // a1
        (1 - alpha) / a0,             // a2
        Math.cos(w), 1 / Math.sin(w), // quadrature envelope
        1 - Math.exp(-1 / (envS * sampleRate)),
        q / VOC_Q,                    // a wider band overlaps its neighbours more, so it contributes less
      ], b * 7);
    }
    this.vocCarRelease = 1 - Math.exp(-1 / (VOC_CARRIER_RELEASE_S * sampleRate));
    this.vocGain = 0;
    this.noiseAmt = 0;
    this.prevCarrier = 0;
  }

  vocode(input, left, N) {
    const goal = this.character === 'messina' && this.level > this.gate ? 1 : 0;
    if (goal === 0 && this.vocGain === 0) return;
    if (!this.vocIn || this.vocIn.length !== N) {
      this.vocIn = new Float32Array(N);
      this.vocCar = new Float32Array(N);
      this.vocOut = new Float32Array(N);
    }
    const mic = this.vocIn, car = this.vocCar, acc = this.vocOut, step = this.gainStep;
    if (input) mic.set(input); else mic.fill(0);
    car.fill(0);
    acc.fill(0);

    // carrier: a band-limited (polyBLEP) sawtooth per target…
    let held = 0;
    for (const v of this.voices) {
      const want = v.target > 0 ? 1 : 0;
      if (want === 0 && v.carGain === 0) continue;
      const dt = v.hz / sampleRate;
      let phase = v.phase, g = v.carGain;
      for (let i = 0; i < N; i++) {
        if (g !== want) g = g < want ? Math.min(want, g + step) : Math.max(want, g - step);
        let s = 2 * phase - 1;
        if (phase < dt) { const t = phase / dt; s -= t + t - t * t - 1; }
        else if (phase > 1 - dt) { const t = (phase - 1) / dt; s -= t * t + t + t + 1; }
        car[i] += g * s;
        phase += dt;
        if (phase >= 1) phase -= 1;
      }
      v.phase = phase;
      v.carGain = g;
      if (g > held) held = g;
    }
    // …plus noise while the input is unvoiced, so consonants come through
    const noiseGoal = this.voiced ? 0 : held;
    let noise = this.noiseAmt, prev = this.prevCarrier;
    for (let i = 0; i < N; i++) {
      if (noise !== noiseGoal) noise = noise < noiseGoal ? Math.min(noiseGoal, noise + step) : Math.max(noiseGoal, noise - step);
      const c = car[i] + noise * (Math.random() * 2 - 1);
      car[i] = c - VOC_PREEMPH * prev;
      prev = c;
    }
    this.noiseAmt = noise;
    this.prevCarrier = prev;

    // per band: the mic band's envelope × the carrier band normalized to unit level.
    // Envelopes are quadrature estimates: a band filter's current and previous
    // outputs give the amplitude of a sinusoid at the band centre directly, so
    // they need little smoothing and add little delay.
    const coef = this.vocCoef, st = this.vocState, kRel = this.vocCarRelease;
    for (let b = 0; b < VOC_BANDS; b++) {
      const c = b * 7, o = b * 12;
      const b0 = coef[c], a1 = coef[c + 1], a2 = coef[c + 2];
      const cw = coef[c + 3], invSin = coef[c + 4], k = coef[c + 5], bandGain = coef[c + 6];
      let m1 = st[o], m2 = st[o + 1], m3 = st[o + 2], m4 = st[o + 3], mPrev = st[o + 4], mEnv = st[o + 5];
      let c1 = st[o + 6], c2 = st[o + 7], c3 = st[o + 8], c4 = st[o + 9], cPrev = st[o + 10], cEnv = st[o + 11];
      for (let i = 0; i < N; i++) {
        // transposed direct form II; each band is two bandpass stages in series
        let x = mic[i], y = b0 * x + m1;
        m1 = m2 - a1 * y; m2 = -b0 * x - a2 * y;
        x = y; y = b0 * x + m3;
        m3 = m4 - a1 * y; m4 = -b0 * x - a2 * y;
        let quad = (y - cw * mPrev) * invSin;
        mEnv += k * (Math.sqrt(quad * quad + mPrev * mPrev) - mEnv);
        mPrev = y;

        x = car[i]; y = b0 * x + c1;
        c1 = c2 - a1 * y; c2 = -b0 * x - a2 * y;
        x = y; y = b0 * x + c3;
        c3 = c4 - a1 * y; c4 = -b0 * x - a2 * y;
        quad = (y - cw * cPrev) * invSin;
        const amp = Math.sqrt(quad * quad + cPrev * cPrev);
        cEnv = amp > cEnv ? amp : cEnv + kRel * (amp - cEnv);
        cPrev = y;

        acc[i] += (y * mEnv * bandGain) / (cEnv + VOC_CARRIER_FLOOR);
      }
      st[o] = m1; st[o + 1] = m2; st[o + 2] = m3; st[o + 3] = m4; st[o + 4] = mPrev; st[o + 5] = mEnv;
      st[o + 6] = c1; st[o + 7] = c2; st[o + 8] = c3; st[o + 9] = c4; st[o + 10] = cPrev; st[o + 11] = cEnv;
    }

    let g = this.vocGain;
    for (let i = 0; i < N; i++) {
      if (g !== goal) g = g < goal ? Math.min(goal, g + step) : Math.max(goal, g - step);
      left[i] += VOC_TRIM * g * acc[i];
    }
    this.vocGain = g;
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const out = outputs[0];
    const N = out[0].length;
    const blockStart = this.n;

    let energy = 0;
    for (let i = 0; i < N; i++) {
      const x = input ? input[i] : 0;
      this.inBuf[this.n & MASK] = x;
      this.lp += this.lpCoef * (x - this.lp);
      if (this.n & 1) this.decBuf[this.decN++ & DEC_MASK] = this.lp;
      this.n++;
      energy += x * x;
    }
    this.level = Math.max(Math.sqrt(energy / N), this.level * Math.exp(-N / (LEVEL_RELEASE_S * sampleRate)));
    this.sinceDetect += N;
    if (this.sinceDetect >= DETECT_HOP) {
      this.sinceDetect -= DETECT_HOP;
      this.detect();
    }
    this.trackMarks();
    this.synthesize(blockStart, N);

    let active = 0;
    for (const v of this.voices) if (v.target > 0) active++;
    const scaleFrom = this.mixScale, scaleTo = 1 / Math.sqrt(Math.max(1, active));
    this.mixScale = scaleTo;

    const left = out[0];
    left.fill(0);
    const natural = this.character === 'natural';
    for (const v of this.voices) {
      if (v.next < 0) continue;
      const goal = v.target > 0 && this.voiced && natural ? 1 : 0;
      const vOut = v.out, step = this.gainStep;
      let gain = v.gain;
      for (let i = 0; i < N; i++) {
        const idx = (blockStart + i) & MASK;
        if (gain !== goal) gain = gain < goal ? Math.min(goal, gain + step) : Math.max(goal, gain - step);
        left[i] += vOut[idx] * gain;
        vOut[idx] = 0;
      }
      v.gain = gain;
      if (goal === 0 && v.gain === 0) { // fully faded — go idle and drop any grain tails already written ahead
        v.next = -1;
        v.out.fill(0);
      }
    }
    for (let i = 0; i < N; i++) left[i] *= scaleFrom + (scaleTo - scaleFrom) * (i / N);
    this.vocode(input, left, N); // its carrier normalization already keeps the level independent of chord size
    for (let c = 1; c < out.length; c++) out[c].set(left);

    this.sinceReport += N;
    if (this.sinceReport >= REPORT_EVERY_S * sampleRate) {
      this.sinceReport = 0;
      this.port.postMessage({
        type: 'pitch',
        f0: this.voiced ? this.f0 : 0,
        delayMs: !this.voiced ? 0 : natural ? ((PSOLA_DELAY_PERIODS * this.period) / sampleRate) * 1000
          : Math.max(VOC_DELAY_MIN_MS, (this.period / sampleRate) * 1000),
      });
    }
    return true;
  }
}

registerProcessor('harmonizer', HarmonizerProcessor);
