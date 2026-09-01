const SpadesAudio = (() => {
  let ctx = null;
  let muted = window.localStorage.getItem('spadesSound') === 'off';
  let lastSpeech = '';
  let lastSpeechAt = 0;

  function getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function unlock() {
    const audio = getCtx();
    if (audio && audio.state === 'suspended') audio.resume();
  }

  function setMuted(next) {
    muted = Boolean(next);
    window.localStorage.setItem('spadesSound', muted ? 'off' : 'on');
    if (muted && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function isMuted() {
    return muted;
  }

  function tone(audio, { freq, freqEnd, duration = 0.12, type = 'sine', gain = 0.08, delay = 0 }) {
    const start = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp);
    amp.connect(audio.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function rustle(audio, { duration = 0.05, gain = 0.04, freq = 1600, delay = 0 }) {
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
    filter.Q.value = 0.9;
    const amp = audio.createGain();
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(audio.destination);
    src.start(start);
  }

  function card() {
    if (muted) return;
    const audio = getCtx();
    if (!audio) return;
    rustle(audio, { duration: 0.045, gain: 0.05, freq: 1800 });
    tone(audio, { freq: 210, freqEnd: 90, duration: 0.09, type: 'triangle', gain: 0.05 });
  }

  function trump() {
    if (muted) return;
    const audio = getCtx();
    if (!audio) return;
    rustle(audio, { duration: 0.07, gain: 0.07, freq: 900 });
    tone(audio, { freq: 140, freqEnd: 55, duration: 0.18, type: 'sine', gain: 0.1 });
    tone(audio, { freq: 420, duration: 0.08, type: 'square', gain: 0.02, delay: 0.02 });
  }

  function chip() {
    if (muted) return;
    const audio = getCtx();
    if (!audio) return;
    tone(audio, { freq: 880, duration: 0.05, type: 'square', gain: 0.03 });
    tone(audio, { freq: 1320, duration: 0.04, type: 'square', gain: 0.02, delay: 0.04 });
  }

  function deal() {
    if (muted) return;
    const audio = getCtx();
    if (!audio) return;
    for (let i = 0; i < 8; i += 1) {
      rustle(audio, { duration: 0.04, gain: 0.03, freq: 1400 + i * 80, delay: i * 0.045 });
      tone(audio, { freq: 240 - i * 8, duration: 0.05, type: 'triangle', gain: 0.025, delay: i * 0.045 });
    }
  }

  function turn() {
    if (muted) return;
    const audio = getCtx();
    if (!audio) return;
    tone(audio, { freq: 620, duration: 0.09, type: 'sine', gain: 0.05 });
    tone(audio, { freq: 930, duration: 0.12, type: 'sine', gain: 0.035, delay: 0.07 });
  }

  function trickWon() {
    if (muted) return;
    const audio = getCtx();
    if (!audio) return;
    rustle(audio, { duration: 0.12, gain: 0.045, freq: 1100 });
    tone(audio, { freq: 392, duration: 0.12, type: 'sine', gain: 0.05 });
    tone(audio, { freq: 523, duration: 0.16, type: 'sine', gain: 0.045, delay: 0.08 });
  }

  function spadesBroken() {
    if (muted) return;
    const audio = getCtx();
    if (!audio) return;
    rustle(audio, { duration: 0.18, gain: 0.08, freq: 700 });
    tone(audio, { freq: 196, duration: 0.28, type: 'sine', gain: 0.08 });
    tone(audio, { freq: 247, duration: 0.32, type: 'sine', gain: 0.06, delay: 0.05 });
    tone(audio, { freq: 311, duration: 0.4, type: 'triangle', gain: 0.05, delay: 0.1 });
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
    if (text === lastSpeech && now - lastSpeechAt < 1500) return;
    lastSpeech = text;
    lastSpeechAt = now;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 0.96;
    utterance.pitch = 0.85;
    utterance.volume = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  return { unlock, setMuted, isMuted, card, trump, chip, deal, turn, trickWon, spadesBroken, say };
})();

window.addEventListener('pointerdown', () => SpadesAudio.unlock(), { once: true });
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
