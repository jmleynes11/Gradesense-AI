import { useCallback, useEffect, useRef, useState } from "react";

const SETTINGS_KEY = "gradesense.quiz-game-audio-settings";
const clamp = (value, fallback) => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : fallback));

function readSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY));
    const legacy = JSON.parse(window.localStorage.getItem("gradesense.quiz-game-sound-settings"));
    return {
      effectsEnabled: saved?.effectsEnabled ?? legacy?.enabled ?? true,
      musicEnabled: saved?.musicEnabled ?? true,
      effectsVolume: clamp(saved?.effectsVolume ?? legacy?.volume, 0.45),
      musicVolume: clamp(saved?.musicVolume, 0.12),
    };
  } catch {
    return { effectsEnabled: true, musicEnabled: true, effectsVolume: 0.45, musicVolume: 0.12 };
  }
}

// Dependency-free Quiz Arena audio: short effects plus a low-volume synthesized loop.
export function useQuizGameSounds() {
  const [settings, setSettings] = useState(readSettings);
  const settingsRef = useRef(settings);
  const contextRef = useRef(null);
  const effectsRef = useRef(null);
  const musicRef = useRef(null);
  const activeNodesRef = useRef(new Set());
  const musicNodesRef = useRef(new Set());
  const musicTimerRef = useRef(null);

  const getContext = useCallback(() => {
    try {
      if (typeof window === "undefined" || !(window.AudioContext || window.webkitAudioContext)) return null;
      if (!contextRef.current) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const effects = context.createGain();
        const music = context.createGain();
        effects.connect(context.destination);
        music.connect(context.destination);
        contextRef.current = context;
        effectsRef.current = effects;
        musicRef.current = music;
      }
      return contextRef.current;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage is optional */ }
    const context = contextRef.current;
    if (!context) return;
    effectsRef.current?.gain.setTargetAtTime(settings.effectsEnabled ? settings.effectsVolume : 0, context.currentTime, 0.02);
    musicRef.current?.gain.setTargetAtTime(settings.musicEnabled ? settings.musicVolume : 0, context.currentTime, 0.08);
  }, [settings]);

  const stopNodes = useCallback((nodes) => {
    nodes.forEach((node) => { try { node.stop(); } catch { /* already stopped */ } });
    nodes.clear();
  }, []);

  const stopMusic = useCallback(() => {
    if (musicTimerRef.current) window.clearInterval(musicTimerRef.current);
    musicTimerRef.current = null;
    stopNodes(musicNodesRef.current);
  }, [stopNodes]);

  const stopAll = useCallback(() => {
    stopNodes(activeNodesRef.current);
    stopMusic();
  }, [stopMusic, stopNodes]);

  const unlock = useCallback(async () => {
    const context = getContext();
    if (context?.state === "suspended") await context.resume().catch(() => {});
  }, [getContext]);

  const play = useCallback((name, delay = 0) => {
    if (!settingsRef.current.effectsEnabled) return;
    const context = getContext();
    if (!context || context.state !== "running" || !effectsRef.current) return;
    const patterns = {
      loading: [[392, 0, 0.07, "sine"], [523, 0.08, 0.1, "sine"]], start: [[262, 0, 0.08, "square"], [392, 0.08, 0.08, "square"], [523, 0.16, 0.16, "square"]],
      question: [[659, 0, 0.06, "sine"], [784, 0.07, 0.09, "sine"]], timerStart: [[523, 0, 0.045, "sine"]], select: [[620, 0, 0.045, "sine"]],
      correct: [[523, 0, 0.08, "triangle"], [659, 0.09, 0.08, "triangle"], [784, 0.18, 0.12, "triangle"]], incorrect: [[220, 0, 0.1, "sine"], [174, 0.11, 0.12, "sine"]],
      warning10: [[660, 0, 0.08, "sine"]], warning5: [[880, 0, 0.07, "square"], [880, 0.12, 0.07, "square"]], countdown: [[740, 0, 0.045, "sine"]], timeout: [[330, 0, 0.1, "sine"], [220, 0.12, 0.16, "sine"]],
      points: [[880, 0, 0.07, "sine"], [1047, 0.08, 0.1, "sine"]], streak: [[523, 0, 0.07, "triangle"], [659, 0.08, 0.07, "triangle"], [784, 0.16, 0.07, "triangle"], [1047, 0.24, 0.16, "triangle"]],
      complete: [[523, 0, 0.12, "triangle"], [659, 0.13, 0.12, "triangle"], [784, 0.26, 0.12, "triangle"], [1047, 0.39, 0.24, "triangle"]], completeLow: [[392, 0, 0.1, "sine"], [523, 0.12, 0.16, "sine"]],
    };
    try {
      const now = context.currentTime + delay;
      (patterns[name] || []).forEach(([frequency, offset, duration, type]) => {
        const oscillator = context.createOscillator(); const gain = context.createGain(); const start = now + offset; const end = start + duration;
        oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start); gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.18, start + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain); gain.connect(effectsRef.current); activeNodesRef.current.add(oscillator); oscillator.onended = () => activeNodesRef.current.delete(oscillator); oscillator.start(start); oscillator.stop(end + 0.02);
      });
    } catch { /* playback failure does not affect gameplay */ }
  }, [getContext]);

  const scheduleMusicBar = useCallback(() => {
    const context = contextRef.current;
    if (!context || context.state !== "running" || !musicRef.current || !settingsRef.current.musicEnabled) return;
    try {
      const notes = [261.63, 329.63, 392, 329.63, 293.66, 369.99, 440, 369.99]; const now = context.currentTime + 0.03;
      notes.forEach((frequency, step) => {
        const oscillator = context.createOscillator(); const gain = context.createGain(); const start = now + step * 0.28; const end = start + 0.22;
        oscillator.type = "triangle"; oscillator.frequency.setValueAtTime(frequency, start); gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.16, start + 0.025); gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain); gain.connect(musicRef.current); musicNodesRef.current.add(oscillator); oscillator.onended = () => musicNodesRef.current.delete(oscillator); oscillator.start(start); oscillator.stop(end + 0.02);
      });
    } catch { /* playback failure does not affect gameplay */ }
  }, []);

  const startMusic = useCallback(() => {
    if (!settingsRef.current.musicEnabled || musicTimerRef.current) return;
    const context = getContext();
    if (!context || context.state !== "running") return;
    scheduleMusicBar();
    musicTimerRef.current = window.setInterval(scheduleMusicBar, 2240);
  }, [getContext, scheduleMusicBar]);

  const setEffectsEnabled = useCallback((effectsEnabled) => { setSettings((current) => ({ ...current, effectsEnabled })); if (!effectsEnabled) stopNodes(activeNodesRef.current); }, [stopNodes]);
  const setMusicEnabled = useCallback((musicEnabled) => { setSettings((current) => ({ ...current, musicEnabled })); if (!musicEnabled) stopMusic(); }, [stopMusic]);
  const setEffectsVolume = useCallback((effectsVolume) => setSettings((current) => ({ ...current, effectsVolume: clamp(effectsVolume, 0.45) })), []);
  const setMusicVolume = useCallback((musicVolume) => setSettings((current) => ({ ...current, musicVolume: clamp(musicVolume, 0.12) })), []);

  useEffect(() => () => { stopAll(); contextRef.current?.close().catch(() => {}); }, [stopAll]);
  return { ...settings, unlock, play, startMusic, stopMusic, stopAll, setEffectsEnabled, setMusicEnabled, setEffectsVolume, setMusicVolume };
}
