// speechSynthesis wrapper. iOS only speaks after a user gesture has spoken
// once, so call unlock() from the Start tap.

const synth = () => globalThis.speechSynthesis;
let voice = null;

function pickVoice() {
  const vs = synth()?.getVoices?.() ?? [];
  voice = vs.find((v) => /^en[-_]US/i.test(v.lang) && v.localService) || vs.find((v) => /^en/i.test(v.lang)) || null;
}

/** Call inside a tap handler: speaks a silent utterance to unlock audio. */
export function unlock() {
  const s = synth();
  if (!s) return;
  pickVoice();
  s.onvoiceschanged ??= pickVoice;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    s.speak(u);
  } catch { /* no speech: stay silent */ }
}

/** Speak text now, cutting off whatever was being said. */
export function say(text, { rate = 1.1 } = {}) {
  const s = synth();
  if (!s || !text) return;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    if (voice) u.voice = voice;
    s.speak(u);
  } catch { /* ignore */ }
}

export function cancel() { try { synth()?.cancel(); } catch { /* ignore */ } }
