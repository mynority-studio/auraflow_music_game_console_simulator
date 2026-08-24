import React, { useEffect, useRef } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { VisualEvent } from '../audio/playbackTypes';
import { cueGlowIntensity, snuffGlow, type AuraCueGlowSpec } from '../../features/auraRoaming/cue/cueGlow';
import { subscribeAuraRoaming } from '../../features/auraRoaming/state/auraRoamingStore';

interface LedMatrixProps {
  activeKeys: Set<string>;
  appMode?: string;
}

interface Particle {
  x: number;
  y: number;
  hue: number;
  energy: number;
  spread: number;
  targetX: number;
  targetY: number;
  speed: number;
  active: boolean;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  speed: number;
  hue: number;
  thickness: number;
  active: boolean;
}

export function LedMatrix({ activeKeys, appMode }: LedMatrixProps) {
  // Touch Trail Refs
  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const appModeRef = useRef<string | undefined>(appMode);
  const intensitiesA = useRef(new Float32Array(135));
  const intensitiesB = useRef(new Float32Array(135));
  const huesA = useRef(new Float32Array(135));
  const huesB = useRef(new Float32Array(135));
  const isA = useRef(true);
  const ledRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastTouchPos = useRef({ x: 7, y: 4 });
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const hitColorsRef = useRef<Map<string, number>>(new Map());
  const isFnKeyActiveRef = useRef(false);
  const auraGlowsRef = useRef<AuraCueGlowSpec[]>([]);
  interface AuraHitFlash { col: number; row: number; hue: number; atMs: number; peak: number; fadeMs: number; }
  const auraFlashesRef = useRef<AuraHitFlash[]>([]);
  const auraKeyOnRef = useRef(false);

  useEffect(() => subscribeAuraRoaming((snapshot) => { auraKeyOnRef.current = snapshot.auraKeyOn; }), []);

  useEffect(() => {
    activeKeysRef.current = activeKeys;
    
    // Clean up hit colors for released keys
    for (const key of hitColorsRef.current.keys()) {
      if (!activeKeys.has(key)) {
        hitColorsRef.current.delete(key);
      }
    }
  }, [activeKeys]);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

  useEffect(() => {
    const handleVisualEvent = (event: VisualEvent) => {
      const { type, midiNote, velocity } = event;

      // Aura Key 引导期间关掉整轨"氛围光"(每音符粒子雨会淹没引导呼吸灯);
      // 只保留引导灯、命中光斑(custom_particle)与按键反馈
      if (
        auraKeyOnRef.current
        && (type === 'melody' || type === 'accomp' || type === 'bass' || type === 'drums' || type === 'counterMelody')
      ) {
        return;
      }

      if (type === 'custom_particle') {
        const cx = event.col !== undefined ? event.col * 3 + 1 : 7;
        const cy = event.row !== undefined ? event.row * 3 + 1 : 4;
        let hue = event.hue ?? 180;

        particlesRef.current.push({
          x: cx, y: cy, hue, energy: event.energy ?? 2.0, spread: event.spread ?? 3.0, targetX: -1, targetY: -1, speed: 0,
          active: true
        });
        return;
      }

      if (type === 'fn_key_active') {
        isFnKeyActiveRef.current = !!event.active;
        return;
      }

      // 光律漫游引导呼吸灯:包络参数随事件带入,峰值时刻绝对制(performance.now
      // 时基),rAF 每帧算亮度 → 事件派发抖动不影响"提前 50~100ms 最亮"的契约
      if (type === 'aura_cue') {
        if (event.col !== undefined && event.row !== undefined && event.peakAtMs !== undefined) {
          auraGlowsRef.current.push({
            cueId: event.cueId ?? -1,
            col: event.col,
            row: event.row,
            hue: event.hue ?? 272,
            peakAtMs: event.peakAtMs,
            riseMs: event.riseMs ?? 500,
            holdMs: event.holdMs ?? 320,
            fadeMs: event.fadeMs ?? 260,
          });
        }
        return;
      }
      if (type === 'aura_cue_hit') {
        const atMs = performance.now();
        auraGlowsRef.current = auraGlowsRef.current.map((g) => (g.cueId === event.cueId ? snuffGlow(g, atMs) : g));
        // 命中手感:整键爆闪(瞬时超亮→快速衰减)+ 向外扩满全板的渐暗波浪
        if (event.col !== undefined && event.row !== undefined) {
          auraFlashesRef.current.push({
            col: event.col,
            row: event.row,
            hue: event.hue ?? 272,
            atMs,
            peak: event.energy ?? 2.4,
            fadeMs: 340,
          });
          ripplesRef.current.push({
            x: event.col * 3 + 1,
            y: event.row * 3 + 1,
            radius: 0.5,
            maxRadius: 5,
            speed: 0.34,
            hue: event.hue ?? 272,
            thickness: 1.4,
            active: true,
          });
        }
        return;
      }
      if (type === 'aura_cue_clear') {
        auraGlowsRef.current = [];
        return;
      }

      if (type === 'confirm') {
        const cx = event.col !== undefined ? event.col * 3 + 1 : 7;
        const cy = event.row !== undefined ? event.row * 3 + 1 : 4;
        let hue = event.hue ?? 180;
        
        if (event.col !== undefined && event.row !== undefined) {
          const padId = `key-${event.col}-${event.row}`;
          hitColorsRef.current.set(padId, hue);
        }
        return;
      }

      const hue = (midiNote * 12) % 360;
      
      let x = 0, y = 0, energy = 0, spread = 0;
      let targetX = -1, targetY = -1, speed = 0;

      if (type === 'accomp') {
        // Edges
        x = Math.random() > 0.5 ? Math.floor(Math.random() * 4) : 11 + Math.floor(Math.random() * 4);
        y = 1 + Math.floor(Math.random() * 7);
        energy = velocity * 0.70; // Increased for breathing (+20%)
        spread = 7.2; // Increased spread (+20%)
        
        if (Math.random() > 0.5) {
          // Move inward
          targetX = x < 7 ? x + 3 + Math.random() * 3 : x - 3 - Math.random() * 3;
          targetY = y + (Math.random() * 4 - 2);
          speed = 0.02 + Math.random() * 0.03; // Slower
        }
      } else if (type === 'melody') {
        // Center
        x = 3 + Math.floor(Math.random() * 9);
        y = 1 + Math.floor(Math.random() * 7);
        energy = velocity * 1.03; // Increased (+20%)
        spread = 3.6; // Increased spread (+20%)
        
        if (Math.random() > 0.5) {
          // Move outward
          targetX = x < 7 ? x - 2 - Math.random() * 2 : x + 2 + Math.random() * 2;
          targetY = y + (Math.random() * 4 - 2);
          speed = 0.04 + Math.random() * 0.04; // Slower
        }
      } else if (type === 'drums') {
        // Background wash
        x = Math.floor(Math.random() * 15);
        y = Math.floor(Math.random() * 9);
        energy = velocity * 0.35; // Increased (+20%)
        spread = 10.2; // Increased spread for a wash effect (+20%)
        
        // Slow drift
        targetX = x + (Math.random() * 4 - 2);
        targetY = y + (Math.random() * 4 - 2);
        speed = 0.01 + Math.random() * 0.01; // Extremely slow
      }

      particlesRef.current.push({
        x, y, hue, energy, spread, targetX, targetY, speed,
        active: true
      });
    };

    AudioEngine.addVisualListener(handleVisualEvent);
    return () => AudioEngine.removeVisualListener(handleVisualEvent);
  }, []);

  useEffect(() => {
    let rafId: number;
    const loop = () => {
      const time = performance.now() * 0.001;
      let needsUpdate = false;
      
      const currentIntensities = isA.current ? intensitiesA.current : intensitiesB.current;
      const nextIntensities = isA.current ? intensitiesB.current : intensitiesA.current;
      const currentHues = isA.current ? huesA.current : huesB.current;
      const nextHues = isA.current ? huesB.current : huesA.current;

      // 0. Update Center of Mass
      if (activeKeysRef.current.size > 0) {
        let sumX = 0, sumY = 0, count = 0;
        activeKeysRef.current.forEach(keyId => {
          const parts = keyId.split('-');
          if (parts.length === 3) {
            sumX += parseInt(parts[1]) * 3 + 1;
            sumY += parseInt(parts[2]) * 3 + 1;
            count++;
          }
        });
        if (count > 0) {
          lastTouchPos.current.x += (sumX / count - lastTouchPos.current.x) * 0.3;
          lastTouchPos.current.y += (sumY / count - lastTouchPos.current.y) * 0.3;
        }
      }

      const mixHue = (h1: number, h2: number, w1: number, w2: number) => {
        if (w1 < 0.001) return h2;
        if (w2 < 0.001) return h1;
        let diff = h2 - h1;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        const weight = w2 / (w1 + w2);
        let res = h1 + diff * weight;
        if (res < 0) res += 360;
        return res % 360;
      };

      // 1. Diffusion and Decay
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 15; x++) {
          const idx = y * 15 + x;
          let val = currentIntensities[idx];
          let hue = currentHues[idx];

          if (appModeRef.current === 'custom_clear') {
            // Fast clear for custom modes to keep visuals crisp
            val *= 0.5;
            if (val < 0.05) val = 0;
            else needsUpdate = true;
          } else if (auraKeyOnRef.current) {
            // Aura Key:无扩散的干净衰减 — 场面清爽,引导灯每帧重写不受影响
            val *= 0.8;
            if (val < 0.01) val = 0;
            else needsUpdate = true;
          } else {
            // Diffusion
            let neighborSum = 0;
            let neighbors = 0;
            let neighborHueSumX = 0;
            let neighborHueSumY = 0;

            const addNeighbor = (nIdx: number) => {
              const nVal = currentIntensities[nIdx];
              neighborSum += nVal;
              neighbors++;
              if (nVal > 0.01) {
                const nHue = currentHues[nIdx];
                neighborHueSumX += Math.cos(nHue * Math.PI / 180) * nVal;
                neighborHueSumY += Math.sin(nHue * Math.PI / 180) * nVal;
              }
            };

            if (x > 0) addNeighbor(idx - 1);
            if (x < 14) addNeighbor(idx + 1);
            if (y > 0) addNeighbor(idx - 15);
            if (y < 8) addNeighbor(idx + 15);

            const avgNeighborVal = neighbors > 0 ? neighborSum / neighbors : 0;
            
            // Blend current with neighbors
            val = val * 0.65 + avgNeighborVal * 0.35;

            if (avgNeighborVal > 0.01) {
              const avgNeighborHue = (Math.atan2(neighborHueSumY, neighborHueSumX) * 180 / Math.PI + 360) % 360;
              hue = mixHue(hue, avgNeighborHue, val * 0.65, avgNeighborVal * 0.35);
            }

            // Distance from last touch center
            const dx = x - lastTouchPos.current.x;
            const dy = y - lastTouchPos.current.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Organic smoke decay
            const noise = Math.sin(x * 0.8 + time * 2) * Math.cos(y * 0.8 - time * 1.5);
            const distFactor = Math.pow(Math.max(0, Math.min(1, dist / 12)), 1.5);
            
            // Base decay: 0.96 to 0.98 for slightly longer breathing feel
            const decayBase = 0.96 - (distFactor * 0.015);
            const decay = decayBase + noise * 0.005;

            val *= decay;
            if (val < 0.005) val = 0;
            else needsUpdate = true;
          }

          nextIntensities[idx] = val;
          nextHues[idx] = hue;
        }
      }

      // 2. Inject energy from active keys
      if (activeKeysRef.current.size > 0) {
        const defaultTouchHue = (time * 40) % 360;
        activeKeysRef.current.forEach(keyId => {
          const parts = keyId.split('-');
          if (parts.length === 3) {
            const keyC = parseInt(parts[1]);
            const keyR = parseInt(parts[2]);
            const cx = keyC * 3 + 1;
            const cy = keyR * 3 + 1;

            if (appModeRef.current === 'custom_pad_lit') {
              // In custom modes, just light up the 3x3 block
              let hue = hitColorsRef.current.get(keyId) ?? 180;
              
              for (let y = cy - 1; y <= cy + 1; y++) {
                for (let x = cx - 1; x <= cx + 1; x++) {
                  if (x >= 0 && x < 15 && y >= 0 && y < 9) {
                    const idx = y * 15 + x;
                    const currentE = nextIntensities[idx];
                    nextIntensities[idx] = Math.min(1.5, currentE + 1.5); // Brighter when touched
                    nextHues[idx] = mixHue(nextHues[idx], hue, currentE, 1.5);
                    needsUpdate = true;
                  }
                }
              }
            } else if (auraKeyOnRef.current) {
              // Aura Key:按键反馈用清脆 3×3 小块(暗于引导灯,不喷流体烟雾)
              for (let y = cy - 1; y <= cy + 1; y++) {
                for (let x = cx - 1; x <= cx + 1; x++) {
                  if (x >= 0 && x < 15 && y >= 0 && y < 9) {
                    const idx = y * 15 + x;
                    const currentE = nextIntensities[idx];
                    nextIntensities[idx] = Math.min(1.1, currentE + 0.8);
                    nextHues[idx] = mixHue(nextHues[idx], 190, currentE, 0.8);
                    needsUpdate = true;
                  }
                }
              }
            } else {
              // Default fluid touch trail
              for (let y = 0; y < 9; y++) {
                for (let x = 0; x < 15; x++) {
                  const dx = x - cx;
                  const dy = y - cy;
                  const distSq = dx * dx + dy * dy;

                  const angle = Math.atan2(dy, dx);
                  const shapeNoise = Math.sin(angle * 4 + time * 8) * 2.0;
                  const effectiveDistSq = distSq + shapeNoise;

                  if (effectiveDistSq < 7.2) {
                    const energy = Math.exp(-Math.max(0, effectiveDistSq) / 3.1) * 0.86;
                    const idx = y * 15 + x;
                    const currentE = nextIntensities[idx];
                    nextIntensities[idx] = Math.min(1.44, currentE + energy);
                    nextHues[idx] = mixHue(nextHues[idx], defaultTouchHue, currentE, energy);
                    needsUpdate = true;
                  }
                }
              }
            }
          }
        });
      }

      // 3. Process Particles (Music Events)
      const activeParticles = [];
      for (const p of particlesRef.current) {
        if (!p.active) continue;

        // Inject energy at current position
        for (let y = 0; y < 9; y++) {
          for (let x = 0; x < 15; x++) {
            const dx = x - p.x;
            const dy = y - p.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < p.spread * 2) {
              const energy = Math.exp(-distSq / (p.spread / 2)) * p.energy;
              const idx = y * 15 + x;
              const currentE = nextIntensities[idx];
              nextIntensities[idx] = Math.min(2.0, currentE + energy);
              nextHues[idx] = mixHue(nextHues[idx], p.hue, currentE, energy);
              needsUpdate = true;
            }
          }
        }

        // Move particle
        if (p.targetX !== -1 && p.targetY !== -1) {
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < 0.5) {
            // Reached target, do a final burst and die
            p.energy *= 1.5;
            p.targetX = -1; // Stop moving
            p.active = false;
          } else {
            p.x += (dx / dist) * p.speed;
            p.y += (dy / dist) * p.speed;
            p.energy *= 0.95; // Fade out while moving
            if (p.energy < 0.05) p.active = false;
          }
        } else {
          p.active = false; // Static burst dies immediately
        }

        if (p.active) activeParticles.push(p);
      }
      particlesRef.current = activeParticles;

      // 3.5 Process Ripples
      const activeRipples = [];
      for (const r of ripplesRef.current) {
        if (!r.active) continue;

        for (let y = 0; y < 9; y++) {
          for (let x = 0; x < 15; x++) {
            const dx = x - r.x;
            const dy = y - r.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            const distToRing = Math.abs(dist - r.radius);
            
            if (distToRing < r.thickness) {
              // Sharper crest: energy drops quickly as it moves away from the exact ring radius
              const ringEnergy = Math.exp(-(distToRing * distToRing) / 0.5);
              // Fade out as the ripple expands
              const fadeOut = Math.max(0, 1 - (r.radius / r.maxRadius));
              const energy = ringEnergy * fadeOut * 4.0; // High energy for bright crest
              
              if (energy > 0.05) {
                const idx = y * 15 + x;
                const currentE = nextIntensities[idx];
                nextIntensities[idx] = Math.min(4.0, currentE + energy);
                nextHues[idx] = mixHue(nextHues[idx], r.hue, currentE, energy);
                needsUpdate = true;
              }
            }
          }
        }

        r.radius += r.speed;
        if (r.radius >= r.maxRadius) {
          r.active = false;
        } else {
          activeRipples.push(r);
        }
      }
      ripplesRef.current = activeRipples;

      // 4. Render Function Key (Top Right: c=4, r=0 -> x:12-14, y:0-2)
      if (isFnKeyActiveRef.current) {
        const breathe = 0.5 + 0.5 * Math.sin(time * 4); // Fast breathing
        const hue = (time * 60) % 360; // Rainbow cycle
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            const idx = dy * 15 + (12 + dx);
            nextIntensities[idx] = Math.max(nextIntensities[idx], 0.3 + breathe * 0.7);
            nextHues[idx] = hue;
          }
        }
        needsUpdate = true;
      }

      // 4.5 Aura Key 引导呼吸灯:该键 9 颗灯同步,max 混合不覆盖既有能量
      if (auraGlowsRef.current.length > 0) {
        const glowNowMs = time * 1000;
        const alive: AuraCueGlowSpec[] = [];
        for (const glow of auraGlowsRef.current) {
          const intensity = cueGlowIntensity(glowNowMs, glow);
          if (intensity < 0) continue;
          alive.push(glow);
          if (intensity <= 0) continue;
          const cx = glow.col * 3 + 1;
          const cy = glow.row * 3 + 1;
          const level = intensity * 1.25;
          for (let y = cy - 1; y <= cy + 1; y++) {
            for (let x = cx - 1; x <= cx + 1; x++) {
              if (x < 0 || x >= 15 || y < 0 || y >= 9) continue;
              const idx = y * 15 + x;
              if (level > nextIntensities[idx]) {
                nextIntensities[idx] = level;
                nextHues[idx] = glow.hue;
              }
            }
          }
        }
        auraGlowsRef.current = alive;
        if (alive.length > 0) needsUpdate = true;
      }

      // 4.6 命中爆闪:瞬时打到超亮,二次方衰减(压过引导灯与波纹)
      if (auraFlashesRef.current.length > 0) {
        const flashNowMs = time * 1000;
        const aliveFlashes: AuraHitFlash[] = [];
        for (const flash of auraFlashesRef.current) {
          const t = (flashNowMs - flash.atMs) / flash.fadeMs;
          if (t >= 1) continue;
          aliveFlashes.push(flash);
          const level = flash.peak * (1 - t) * (1 - t);
          const cx = flash.col * 3 + 1;
          const cy = flash.row * 3 + 1;
          for (let y = cy - 1; y <= cy + 1; y++) {
            for (let x = cx - 1; x <= cx + 1; x++) {
              if (x < 0 || x >= 15 || y < 0 || y >= 9) continue;
              const idx = y * 15 + x;
              if (level > nextIntensities[idx]) {
                nextIntensities[idx] = level;
                nextHues[idx] = flash.hue;
              }
            }
          }
        }
        auraFlashesRef.current = aliveFlashes;
        if (aliveFlashes.length > 0) needsUpdate = true;
      }

      // 5. Apply to DOM
      if (needsUpdate) {
        for (let i = 0; i < 135; i++) {
          const el = ledRefs.current[i];
          if (el) {
            const intensity = nextIntensities[i];
            if (intensity > 0.005 || el.style.getPropertyValue('--touch-intensity') !== '0') {
              el.style.setProperty('--touch-intensity', intensity > 0.005 ? intensity.toFixed(3) : '0');
              
              if (intensity > 0.005) {
                el.style.setProperty('--touch-hue', nextHues[i].toFixed(1));
              }
            }
          }
        }
      }

      isA.current = !isA.current;
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const leds = [];
  const ledW = 46;
  const ledH = 46;
  const containerW = 1333;
  const containerH = 780;
  const gapX = (containerW - 15 * ledW) / 14;
  const gapY = (containerH - 9 * ledH) / 8;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 15; c++) {
      const ledIndex = r * 15 + c;
      
      let opacity = 0.07; // Slightly increased background glow (+20%)
      let rgb = { r: 6, g: 182, b: 212 }; // Default Cyan
      let duration = '500ms';
      let timing = 'ease-in';
      let extraClasses = '';

      const colorStr = `${rgb.r},${rgb.g},${rgb.b}`;

      leds.push(
        <div
          key={`led-${c}-${r}`}
          className={`absolute pointer-events-none mix-blend-screen ${extraClasses}`}
          style={{
            left: `calc(${c * (ledW + gapX)} / 1333 * 100%)`,
            top: `calc(${r * (ledH + gapY)} / 780 * 100%)`,
            width: `calc(${ledW} / 1333 * 100%)`,
            height: `calc(${ledH} / 780 * 100%)`,
          }}
        >
          {/* Base Layer */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              opacity: opacity,
              transition: `opacity ${duration} ${timing}`,
              background: `radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(${colorStr},0.8) 40%, transparent 70%)`,
              filter: 'blur(1px)',
              boxShadow: `0 0 12px 2.4px rgba(${colorStr},0.6)`
            }}
          />
          {/* Touch Trail Layer */}
          <div
            ref={el => ledRefs.current[ledIndex] = el}
            className="absolute inset-0 rounded-full will-change-transform will-change-opacity"
            style={{
              opacity: 'calc(var(--touch-intensity, 0) * 0.72)',
              transform: 'scale(calc(1 + var(--touch-intensity, 0) * 0.084))',
              background: `radial-gradient(circle, hsla(var(--touch-hue, 180), 100%, 80%, 0.96) 0%, hsla(var(--touch-hue, 180), 100%, 50%, 0.48) 40%, transparent 70%)`,
              filter: 'blur(1px)',
              boxShadow: `0 0 calc(7.2px * var(--touch-intensity, 0)) calc(0.84px * var(--touch-intensity, 0)) hsla(var(--touch-hue, 180), 100%, 50%, 0.36)`
            }}
          />
        </div>
      );
    }
  }

  return <>{leds}</>;
}
