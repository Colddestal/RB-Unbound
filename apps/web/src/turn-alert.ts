export function playTurnChime(): void {
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    void context.resume().then(() => {
      const start = context.currentTime;
      for (const [index, frequency] of [660, 880].entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = start + index * 0.16;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.21);
      }
      window.setTimeout(() => { void context.close(); }, 600);
    }).catch(() => { void context.close(); });
  } catch {
    // The visible turn indicator still works when browser audio is unavailable.
  }
}
