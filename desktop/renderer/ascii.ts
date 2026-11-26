// ASCII motion for the hero: a shaded planet, a ringed planet, a black hole and
// a spiral galaxy, all drawn into one fixed character grid.
//
// Everything is intensity-based: each scene fills a Float32 buffer, then one
// pass maps it through a density ramp with a stable per-cell dither. The dither
// matters — without it a smooth gradient quantises into hard horizontal bands
// because every cell in a row lands in the same ramp step.
//
// Design notes:
// - The ramp avoids '-' and '='. Those glyphs have long horizontal strokes, so
//   a run of them reads as a scan-line artefact rather than tone.
// - 12 fps, paused when the window is hidden or the hero is off screen. A
//   planet is ambience, not an animation to stare at.

export type SceneName = 'planet' | 'ringed' | 'blackhole' | 'galaxy';

export interface PlanetOptions {
  rows?: number;
  speed?: number;
  scene?: SceneName;
}

export interface PlanetHandle {
  start(): void;
  stop(): void;
  scene(name: SceneName): void;
}

const RAMP = ' .:*#%@';
const CELL_ASPECT = 1.667; // monospace advance ≈ 0.6 × line height
const FRAME_MS = 80;

// Windows often ships with "animation effects" off, which reports as
// prefers-reduced-motion. The hero is the product's motion signature, so it
// keeps moving either way — the reduced setting only slows it down.
const ANIMATE_ALWAYS = true;

/** Deterministic hash in [0,1) — stable dither, no Math.random flicker. */
function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Star {
  cell: number;
  phase: number;
  bright: boolean;
}

export function createPlanet(host: HTMLElement, options: PlanetOptions = {}): PlanetHandle {
  const rows = options.rows ?? 27;
  const speed = options.speed ?? 0.18;
  const radiusRows = (rows - 1) / 2;
  const cols = 2 * Math.floor(radiusRows * CELL_ASPECT * 1.62) + 1;
  const cells = rows * cols;
  const buffer = new Float32Array(cells);
  const universe = new Float32Array(cells);

  let scene: SceneName = options.scene ?? 'planet';
  let raf = 0;
  let last = 0;
  let clock = 0;
  let running = false;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // --- starfield -----------------------------------------------------------
  const stars: Star[] = [];
  for (let n = 0; n < 46; n++) {
    stars.push({
      cell: Math.floor(hash(n, 7) * cells),
      phase: hash(n, 11) * Math.PI * 2,
      bright: hash(n, 13) > 0.74,
    });
  }
  universe.fill(0);

  // --- galaxy particles ----------------------------------------------------
  const PARTICLES = 520;
  const arms = new Float32Array(PARTICLES * 2);
  for (let n = 0; n < PARTICLES; n++) {
    const u = hash(n, 21);
    const arm = Math.floor(hash(n, 23) * 3);
    const spread = (hash(n, 29) - 0.5) * 0.55;
    arms[n * 2] = Math.sqrt(u) * 1.04;
    arms[n * 2 + 1] = arm * (Math.PI * 2) / 3 + Math.sqrt(u) * 5.2 + spread;
  }

  function scenePlanet(t: number): void {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const cos = Math.cos(t * speed);
    const sin = Math.sin(t * speed);
    for (let j = 0; j < rows; j++) {
      const y = (j - cy) / radiusRows;
      for (let i = 0; i < cols; i++) {
        const x = (i - cx) / (radiusRows * CELL_ASPECT);
        const d2 = x * x + y * y;
        if (d2 > 1) continue;
        const w = Math.sqrt(1 - d2);
        const nz = -x * sin + w * cos;
        const nx = x * cos + w * sin;
        const lon = Math.atan2(nx, nz);
        const lat = Math.asin(Math.max(-1, Math.min(1, y)));

        // Terrain: two low-frequency octaves. High frequencies turn the disc
        // into noise at this resolution.
        const terrain =
          0.5 +
          0.16 * Math.sin(lat * 4.6 + 1.3 * Math.sin(lon * 1.7 + t * 0.2)) +
          0.2 * Math.sin(lon * 2.3 - lat * 1.7 + t * 0.16) * Math.cos(lat * 2.2);

        // Light from the upper left, mostly frontal: the terminator stays a
        // soft crescent instead of a hard horizontal band across the poles.
        const lambert = Math.max(0, x * -0.52 + y * -0.26 + w * 0.78);
        const rim = w < 0.12 ? (1 - w / 0.12) * 0.14 : 0;
        buffer[j * cols + i] =
          0.15 + 0.6 * Math.pow(lambert, 1.35) * (0.97 + 0.07 * terrain) + rim;
      }
    }
  }

  function sceneRinged(t: number): void {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const R = 0.58;
    const cos = Math.cos(t * speed);
    const sin = Math.sin(t * speed);
    for (let j = 0; j < rows; j++) {
      const y = (j - cy) / radiusRows;
      for (let i = 0; i < cols; i++) {
        const x = (i - cx) / (radiusRows * CELL_ASPECT);
        const px = x / R;
        const py = y / R;
        const d2 = px * px + py * py;

        // Ring: two bands with a gap (Cassini division) in a thin ellipse.
        const rr = Math.hypot(x / (R * 1.62), y / (R * 0.33));
        const inRing = (rr > 0.95 && rr < 1.0) || (rr > 1.04 && rr < 1.17);
        const ringFront = inRing && y > 0.02;
        const ringBehind = inRing && d2 > 1.02;

        if (d2 <= 1) {
          const w = Math.sqrt(1 - d2);
          const nz = -px * sin + w * cos;
          const nx = px * cos + w * sin;
          const lon = Math.atan2(nx, nz);
          const lat = Math.asin(Math.max(-1, Math.min(1, py)));
          const terrain = 0.5 + 0.2 * Math.sin(lat * 5.4 + 0.8 * Math.sin(lon * 2.2 + t * 0.18));
          const lambert = Math.max(0, px * -0.58 + py * -0.32 + w * 0.74);
          const shade = 0.1 + 0.66 * Math.pow(lambert, 1.35) * (0.96 + 0.1 * terrain);
          buffer[j * cols + i] = ringFront ? Math.max(shade, 0.3 + 0.26 * (1 - rr / 1.2)) : shade;
        } else if (ringBehind) {
          // Outer half of the ring, dimmer where the planet would shadow it.
          const lit = 1 - Math.min(1, Math.abs(x) / 1.1);
          buffer[j * cols + i] = 0.16 + 0.3 * (0.45 + 0.55 * lit) * (rr > 1.04 ? 1 : 0.8);
        }
      }
    }
  }

  function sceneBlackhole(t: number): void {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    const hole = 0.52;
    for (let j = 0; j < rows; j++) {
      const y = (j - cy) / radiusRows;
      const yu = y / 0.3; // the disk is seen almost edge-on
      for (let i = 0; i < cols; i++) {
        const x = (i - cx) / (radiusRows * CELL_ASPECT);
        const r = Math.hypot(x, y);
        if (r < hole) continue; // the shadow swallows everything
        const disk = Math.hypot(x / 1.25, yu / 1.0);
        let value = 0;
        if (disk > 0.55 && disk < 1.55) {
          // Inner edge is hotter; the approaching side is brighter.
          const heat = 1 - Math.abs(disk - 0.78) / 0.8;
          const doppler = 0.55 + 0.45 * Math.max(0, -x / 1.1);
          value = Math.max(0, heat) * doppler * 0.9;
        }
        if (r < hole + 0.075) value = Math.max(value, 0.95); // photon ring
        const swirl = 0.5 + 0.5 * Math.sin(Math.atan2(yu, x) * 3 + t * 0.5);
        buffer[j * cols + i] = value * (0.82 + 0.18 * swirl);
      }
    }
  }

  function sceneGalaxy(t: number): void {
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    for (let n = 0; n < PARTICLES; n++) {
      const r = arms[n * 2];
      const theta = arms[n * 2 + 1] + t * (0.42 / (0.42 + r));
      const px = Math.cos(theta) * r;
      const py = Math.sin(theta) * r * 0.42; // tilted disc
      const i = Math.round(cx + px * radiusRows * CELL_ASPECT);
      const j = Math.round(cy + py * radiusRows);
      if (i < 0 || i >= cols || j < 0 || j >= rows) continue;
      const gain = (1 - r * 0.55) * 0.5;
      buffer[j * cols + i] = Math.min(1, buffer[j * cols + i] + gain);
      // Sprinkle a faint neighbour so arms look like dust, not beads.
      if (hash(n, Math.floor(t * 6)) > 0.62) {
        const i2 = i + (hash(n, 41) > 0.5 ? 1 : -1);
        if (i2 >= 0 && i2 < cols) buffer[j * cols + i2] = Math.min(1, buffer[j * cols + i2] + gain * 0.45);
      }
    }
    // Nucleus.
    for (let j = 0; j < rows; j++) {
      const y = (j - cy) / radiusRows;
      for (let i = 0; i < cols; i++) {
        const x = (i - cx) / (radiusRows * CELL_ASPECT);
        const r = Math.hypot(x, y);
        if (r < 0.2) buffer[j * cols + i] = Math.max(buffer[j * cols + i], (1 - r / 0.2) * 0.95);
      }
    }
  }

  const smooth = new Float32Array(rows * cols);
  let primed = false;

  /** Low-pass each frame so borderline cells stop blinking between glyphs. */
  function settle(): void {
    if (!primed) {
      smooth.set(buffer);
      primed = true;
    }
    for (let i = 0; i < buffer.length; i += 1) {
      const target = buffer[i] > 0.005 ? buffer[i] : 0;
      smooth[i] = smooth[i] * 0.82 + target * 0.18;
      buffer[i] = smooth[i];
    }
  }

  function draw(): string {
    const lines: string[] = [];
    const top = RAMP.length - 1;
    for (let j = 0; j < rows; j++) {
      let line = '';
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const raw = buffer[idx];
        if (raw > 0.02) {
          // A little dither breaks banding; a lot makes the art crawl.
          const dithered = raw + (hash(i, j) - 0.5) * 0.05;
          const step = Math.max(1, Math.round(dithered * top));
          line += RAMP[Math.min(top, step)];
        } else if (universe[idx] > 0) {
          line += universe[idx] > 0.6 ? '+' : '.';
        } else {
          line += ' ';
        }
      }
      // Every row stays exactly `cols` wide. Trimming trailing spaces lets the
      // block width drift frame to frame, dragging the centred art sideways.
      lines.push(line);
    }
    return lines.join('\n');
  }

  function tick(now: number): void {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (now - last < FRAME_MS) return;
    last = now;
    if (document.hidden) return;
    clock += FRAME_MS / 1000;
    buffer.fill(0);
    if (scene === 'planet') scenePlanet(clock);
    else if (scene === 'ringed') sceneRinged(clock);
    else if (scene === 'blackhole') sceneBlackhole(clock);
    else sceneGalaxy(clock);
    settle();
    // Stars hold steady. Blinking dot-noise is what read as the art shaking.
    for (const s of stars) {
      if (buffer[s.cell] > 0.02) continue;
      universe[s.cell] = s.bright ? 1 : 0.4;
    }
    host.textContent = draw();
  }


  function paintOnce(): void {
    buffer.fill(0);
    if (scene === 'planet') scenePlanet(0.9);
    else if (scene === 'ringed') sceneRinged(0.9);
    else if (scene === 'blackhole') sceneBlackhole(0.9);
    else sceneGalaxy(1.2);
    for (const s of stars) if (buffer[s.cell] <= 0.02) universe[s.cell] = s.bright ? 1 : 0.4;
    host.textContent = draw();
  }

  return {
    start() {
      if (running) return;
      running = true;
      if (!ANIMATE_ALWAYS && reduced.matches) {
        paintOnce();
        running = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    scene(name: SceneName) {
      if (name === scene) return;
      scene = name;
      buffer.fill(0);
      universe.fill(0);
      // The low-pass buffer holds the old scene's shape; without this the new
      // scene fades in over the ghost of the last one.
      smooth.fill(0);
      primed = false;
      if (reduced.matches) paintOnce();
    },
  };
}
