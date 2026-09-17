// Adapted verbatim from src/weather.js; added deterministic disposal for parent previews.
import * as THREE from 'three';
import {WEATHER_AMOUNT_LIMITS} from '../../src/weather.js';
const clampAmount=(amount,max=2)=>THREE.MathUtils.clamp(Number(amount)||0,0,max);
export function createWeatherAudio() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  let context = null;
  let master = null;
  let rainSource = null;
  let rainGain = null;
  let rainAmount = 1;
  let thunderVoices = 0;
  let muted = false;

  const rainGainValue = () => Math.max(0.0001, 0.105 * Math.min(rainAmount, 1.8));

  function ensureContext() {
    if (!AudioContextCtor) return null;
    if (!context) {
      context = new AudioContextCtor();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.72;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }

  function makeNoiseBuffer(ctx, seconds, shape = null) {
    const length = Math.ceil(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let smoothed = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      smoothed += (white - smoothed) * 0.18;
      data[i] = shape ? shape(i / ctx.sampleRate, white, smoothed) : white * 0.72 + smoothed * 0.28;
    }
    return buffer;
  }

  function startRain() {
    if (rainSource) return;
    const ctx = ensureContext();
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = makeNoiseBuffer(ctx, 2.4);
    source.loop = true;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 620;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 7200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(rainGainValue(), ctx.currentTime + 0.55);
    source.connect(highpass).connect(lowpass).connect(gain).connect(master);
    source.start();
    rainSource = source;
    rainGain = gain;
  }

  function stopRain() {
    if (!rainSource || !context) return;
    const source = rainSource;
    const gain = rainGain;
    rainSource = null;
    rainGain = null;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
    source.stop(context.currentTime + 0.38);
  }

  function setRain(enabled) {
    if (enabled) startRain();
    else stopRain();
  }

  function setRainAmount(nextAmount) {
    rainAmount = clampAmount(nextAmount, WEATHER_AMOUNT_LIMITS.rain);
    if (!context || !rainGain) return;
    rainGain.gain.cancelScheduledValues(context.currentTime);
    rainGain.gain.setValueAtTime(Math.max(rainGain.gain.value, 0.0001), context.currentTime);
    rainGain.gain.linearRampToValueAtTime(rainGainValue(), context.currentTime + 0.18);
  }

  function playThunder(intensity = 1) {
    const ctx = ensureContext();
    if (!ctx) return;
    thunderVoices += 1;
    const duration = THREE.MathUtils.randFloat(2.7, 4.1);
    const source = ctx.createBufferSource();
    source.buffer = makeNoiseBuffer(ctx, duration, (time, white, smoothed) => {
      const decay = Math.exp(-time * 1.15);
      const firstCrack = Math.exp(-Math.pow((time - 0.045) / 0.035, 2));
      const echo = 0.52 * Math.exp(-Math.pow((time - 0.48) / 0.18, 2));
      return (smoothed * 0.88 + white * 0.12) * decay + white * (firstCrack + echo) * 0.34;
    });
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(1150, ctx.currentTime);
    lowpass.frequency.exponentialRampToValueAtTime(210, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.46 * intensity, ctx.currentTime + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.connect(lowpass).connect(gain).connect(master);
    source.addEventListener('ended', () => {
      thunderVoices = Math.max(0, thunderVoices - 1);
    }, { once: true });
    source.start();

    const rumble = ctx.createOscillator();
    const rumbleGain = ctx.createGain();
    rumble.type = 'sine';
    rumble.frequency.setValueAtTime(58, ctx.currentTime);
    rumble.frequency.exponentialRampToValueAtTime(34, ctx.currentTime + duration * 0.8);
    rumbleGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    rumbleGain.gain.exponentialRampToValueAtTime(0.14 * intensity, ctx.currentTime + 0.08);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration * 0.82);
    rumble.connect(rumbleGain).connect(master);
    rumble.start();
    rumble.stop(ctx.currentTime + duration);
  }

  return {
    dispose() {
      stopRain();
      const previous=context;context=null;master=null;
      if(previous&&previous.state!=='closed')previous.close().catch(()=>{});
    },
    setMuted(value) {
      muted = Boolean(value);
      if (master && context) {
        master.gain.cancelScheduledValues(context.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : 0.72, context.currentTime, 0.025);
      }
    },
    prepare: ensureContext,
    setRain,
    setRainAmount,
    playThunder,
    getState: () => ({
      available: !!AudioContextCtor,
      contextState: context?.state ?? 'idle',
      rainActive: !!rainSource,
      rainAmount,
      thunderVoices,
      muted,
    }),
  };
}
