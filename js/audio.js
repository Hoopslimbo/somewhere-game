// Tiny WebAudio synth (redo slice 3): zero audio assets — every sound
// is an oscillator or filtered-noise burst. Master gain follows the
// existing Master Audio slider; the mute flag zeroes it. All functions
// are safe to call before any user gesture: the context is created and
// resumed lazily, and a suspended context just stays silent.
let actx = null, master = null, engineNodes = null;
let muted = false, volume = 80;

export function setMuted(m) {
  muted = !!m;
  if (master) master.gain.value = muted ? 0 : volume / 100 * 0.5;
}
export function setVolume(v) {
  volume = Math.max(0, Math.min(100, +v || 0));
  if (master) master.gain.value = muted ? 0 : volume / 100 * 0.5;
}
function ensure() {
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : volume / 100 * 0.5;
      master.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
    return true;
  } catch { return false; }
}
function tone(freq, dur, type = 'sine', vol = 0.25, slideTo = null, delay = 0) {
  if (!actx) return;
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noiseBurst(dur, vol = 0.3, cutoff = 1000, delay = 0) {
  if (!actx) return;
  const t0 = actx.currentTime + delay;
  const len = Math.max(1, Math.floor(actx.sampleRate * dur));
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource(); src.buffer = buf;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0);
}
export function sfx(name) {
  if (!ensure()) return;
  switch (name) {
    case 'chop': noiseBurst(0.09, 0.35, 900); tone(95, 0.09, 'triangle', 0.3); break;
    case 'mine': tone(1200 + Math.random() * 500, 0.05, 'square', 0.08); noiseBurst(0.06, 0.25, 3500); break;
    case 'break': noiseBurst(0.18, 0.4, 700); tone(70, 0.15, 'triangle', 0.3, 45); break;
    case 'dig': noiseBurst(0.12, 0.3, 500); break;
    case 'pickup': tone(660, 0.07, 'sine', 0.25); tone(990, 0.1, 'sine', 0.2, null, 0.06); break;
    case 'craft': tone(523, 0.09, 'sine', 0.25); tone(659, 0.09, 'sine', 0.25, null, 0.08); tone(784, 0.14, 'sine', 0.25, null, 0.16); break;
    case 'hit': noiseBurst(0.1, 0.35, 1400); tone(180, 0.1, 'square', 0.15, 90); break;
    case 'hurt': tone(200, 0.25, 'sawtooth', 0.3, 70); break;
    case 'portal': tone(300, 0.5, 'sine', 0.2, 900); tone(600, 0.5, 'sine', 0.12, 1200, 0.1); break;
    case 'click': tone(1100, 0.04, 'sine', 0.15); break;
    case 'step': noiseBurst(0.06, 0.12, 400); break;
    case 'eat': noiseBurst(0.1, 0.2, 800); tone(300, 0.08, 'triangle', 0.15, null, 0.05); break;
    case 'place': noiseBurst(0.08, 0.25, 1000); tone(220, 0.08, 'triangle', 0.2); break;
    case 'phone': tone(880, 0.08, 'sine', 0.2); tone(1174, 0.1, 'sine', 0.18, null, 0.07); break;
  }
}
// Engine hum: one looping oscillator + lowpass, pitch and level follow
// speed. Started on enterCar, stopped on exitCar / death / quit.
export function startEngine() {
  if (!ensure() || engineNodes) return;
  const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
  const g = actx.createGain(); g.gain.value = 0.0;
  g.gain.linearRampToValueAtTime(0.08, actx.currentTime + 0.3);
  o.connect(f); f.connect(g); g.connect(master);
  o.start();
  engineNodes = { o, f, g };
}
export function setEngineLevel(level) {
  if (!engineNodes) return;
  engineNodes.o.frequency.value = 50 + level * 70;
  engineNodes.g.gain.value = 0.05 + level * 0.06;
}
export function stopEngine() {
  if (!engineNodes) return;
  try {
    engineNodes.g.gain.linearRampToValueAtTime(0, actx.currentTime + 0.2);
    engineNodes.o.stop(actx.currentTime + 0.25);
  } catch { /* already stopped */ }
  engineNodes = null;
}
