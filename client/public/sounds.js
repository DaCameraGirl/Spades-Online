const SpadesAudio = (() => {
  let ctx = null;
  let master = null;
  let muted = window.localStorage.getItem('spadesSound') === 'off';
  let lastSpeech = '';
  let lastSpeechAt = 0;

  function getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function unlock() {
    const audio = getCtx();
    if (!audio) return Promise.resolve();
    if (audio.state === 'suspended') return audio.resume().catch(() => {});
    return Promise.resolve();
  }

  function setMuted(next) {
    muted = Boolean(next);
    window.localStorage.setItem('spadesSound', muted ? 'off' : 'on');
    if (muted && window.speechSynthesis) window.speechSynthesis.cancel();
    if (!muted) {
      unlock().then(() => ping());
    }
  }

  function isMuted() {
    return muted;
  }

  function tone(audio, { freq, freqEnd, duration = 0.14, type = 'sine', gain = 0.22, delay = 0 }) {
    const start = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (freqEnd) osc.frequency.linearRampToValueAtTime(Math.max(40, freqEnd), start + duration);
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(gain, start + 0.01);
    amp.gain.linearRampToValueAtTime(0, start + duration);
    osc.connect(amp);
    amp.connect(master || audio.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function rustle(audio, { duration = 0.06, gain = 0.16, freq = 1600, delay = 0 }) {
    const start = audio.currentTime + delay;
    const length = Math.max(1, Math.floor(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const src = audio.createBufferSource();
    src.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const amp = audio.createGain();
    amp.gain.setValueAtTime(gain, start);
    amp.gain.linearRampToValueAtTime(0, start + duration);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master || audio.destination);
    src.start(start);
  }

  function play(fn) {
    if (muted) return;
    unlock().then(() => {
      const audio = getCtx();
      if (!audio) return;
      fn(audio);
    });
  }

  function ping() {
    play((audio) => {
      tone(audio, { freq: 520, duration: 0.12, type: 'sine', gain: 0.28 });
      tone(audio, { freq: 780, duration: 0.16, type: 'sine', gain: 0.2, delay: 0.07 });
    });
  }

  function card() {
    play((audio) => {
      rustle(audio, { duration: 0.05, gain: 0.22, freq: 1700 });
      tone(audio, { freq: 240, freqEnd: 90, duration: 0.12, type: 'triangle', gain: 0.28 });
    });
  }

  function trump() {
    play((audio) => {
      rustle(audio, { duration: 0.08, gain: 0.28, freq: 800 });
      tone(audio, { freq: 160, freqEnd: 60, duration: 0.22, type: 'sine', gain: 0.35 });
      tone(audio, { freq: 420, duration: 0.1, type: 'square', gain: 0.08, delay: 0.02 });
    });
  }

  function chip() {
    play((audio) => {
      tone(audio, { freq: 980, duration: 0.07, type: 'square', gain: 0.12 });
      tone(audio, { freq: 1480, duration: 0.06, type: 'square', gain: 0.08, delay: 0.05 });
    });
  }

  function deal() {
    play((audio) => {
      for (let i = 0; i < 10; i += 1) {
        rustle(audio, { duration: 0.05, gain: 0.14, freq: 1300 + i * 90, delay: i * 0.04 });
        tone(audio, { freq: 260 - i * 10, duration: 0.06, type: 'triangle', gain: 0.12, delay: i * 0.04 });
      }
    });
  }

  function turn() {
    play((audio) => {
      tone(audio, { freq: 660, duration: 0.11, type: 'sine', gain: 0.24 });
      tone(audio, { freq: 990, duration: 0.14, type: 'sine', gain: 0.16, delay: 0.08 });
    });
  }

  function trickWon() {
    play((audio) => {
      rustle(audio, { duration: 0.14, gain: 0.18, freq: 1000 });
      tone(audio, { freq: 392, duration: 0.14, type: 'sine', gain: 0.22 });
      tone(audio, { freq: 523, duration: 0.18, type: 'sine', gain: 0.2, delay: 0.08 });
    });
  }

  function spadesBroken() {
    play((audio) => {
      rustle(audio, { duration: 0.2, gain: 0.3, freq: 650 });
      tone(audio, { freq: 196, duration: 0.35, type: 'sine', gain: 0.32 });
      tone(audio, { freq: 247, duration: 0.38, type: 'sine', gain: 0.24, delay: 0.05 });
      tone(audio, { freq: 311, duration: 0.45, type: 'triangle', gain: 0.2, delay: 0.1 });
    });
    say('Spades are broken.');
  }

  function pickVoice() {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    return voices.find((voice) => /en-US/i.test(voice.lang) && /male|david|guy|tony|aaron/i.test(voice.name))
      || voices.find((voice) => /^en/i.test(voice.lang))
      || voices[0]
      || null;
  }

  function say(text) {
    if (muted || !text || !window.speechSynthesis) return;
    const now = Date.now();
    if (text === lastSpeech && now - lastSpeechAt < 1200) return;
    lastSpeech = text;
    lastSpeechAt = now;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.96;
    utterance.pitch = 0.85;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }

  return { unlock, setMuted, isMuted, ping, card, trump, chip, deal, turn, trickWon, spadesBroken, say };
})();

window.addEventListener('pointerdown', () => SpadesAudio.unlock());
window.addEventListener('keydown', () => SpadesAudio.unlock());
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
