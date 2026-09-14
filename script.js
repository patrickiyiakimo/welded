// Welds doodles and text onto a steel plate texture.
// Left-click and drag to weld, right-click and drag to grind it away.
//
// The torch is drawn as a proper oxy-acetylene flame: a luminous orange
// feather around a hot blue-white inner cone, a molten pool where it kisses
// the metal, sparks, drifting fumes and a heat-affected zone that stays
// glowing red after the flame has moved on.

const canvas = document.getElementById('pan');
const context = canvas.getContext('2d');
const resetButton = document.getElementById('weldBtn');

const width = canvas.width;
const height = canvas.height;

// Everything that has already cooled is drawn once onto this offscreen
// canvas, so the main loop only ever re-paints what's still hot.
const surfaceCanvas = document.createElement('canvas');
surfaceCanvas.width = width;
surfaceCanvas.height = height;
const surfaceContext = surfaceCanvas.getContext('2d');

const plateImage = new Image();

// Puddles currently cooling down; once cool they move onto surfaceCanvas.
const weldBeads = [];
const sparks = [];
const smoke = [];
const heatPatches = [];

let pointer = null;
let isWelding = false;
let isGrinding = false;
let lastWeldPoint = null;
let lastSeen = null;
let smoothVel = { x: 0, y: 0 };
let idleFrames = 0;

// Beads start incandescent and settle into a grey steel colour as they cool.
function heatColor(heat) {
  if (heat > 0.90) return '#fff1c9';
  if (heat > 0.70) return '#ffd166';
  if (heat > 0.50) return '#ff7a1f';
  if (heat > 0.35) return '#e83a12';
  if (heat > 0.20) return '#8a2016';
  if (heat > 0.06) return '#6a6f78';
  return '#4f5560';
}

function paintBasePlate() {
  // The texture is larger than the canvas, so scale it up until it covers
  // the whole surface and centre the crop.
  const scale = Math.max(width / plateImage.naturalWidth, height / plateImage.naturalHeight);
  const imageWidth = plateImage.naturalWidth * scale;
  const imageHeight = plateImage.naturalHeight * scale;
  surfaceContext.drawImage(
    plateImage, 0, 0, plateImage.naturalWidth, plateImage.naturalHeight,
    (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight
  );

  // Soft falloff around the edges, otherwise the texture feels flat.
  const vignette = surfaceContext.createRadialGradient(
    width / 2, height / 2, width * 0.25, width / 2, height / 2, width * 0.72
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  surfaceContext.fillStyle = vignette;
  surfaceContext.fillRect(0, 0, width, height);
}

// The groove the weld sits in: a dark cut with a scorched inner edge and a
// faint light lip where the parent metal was sheared.
function carveTrench(x0, y0, x1, y1) {
  surfaceContext.lineCap = 'round';
  surfaceContext.lineJoin = 'round';

  surfaceContext.strokeStyle = 'rgba(18,15,12,0.85)';
  surfaceContext.lineWidth = 11;
  surfaceContext.beginPath();
  surfaceContext.moveTo(x0, y0);
  surfaceContext.lineTo(x1, y1);
  surfaceContext.stroke();

  surfaceContext.strokeStyle = 'rgba(82,52,28,0.3)';
  surfaceContext.lineWidth = 5.5;
  surfaceContext.beginPath();
  surfaceContext.moveTo(x0, y0);
  surfaceContext.lineTo(x1, y1);
  surfaceContext.stroke();

  surfaceContext.strokeStyle = 'rgba(255,255,255,0.05)';
  surfaceContext.lineWidth = 1;
  surfaceContext.beginPath();
  surfaceContext.moveTo(x0, y0);
  surfaceContext.lineTo(x1, y1);
  surfaceContext.stroke();
}

// Carves the trench for the segment, then drops weld puddles along it.
function addWeldBeads(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);

  // ~3.4px apart keeps the cooled beads overlapping into one solid line.
  const steps = Math.max(1, Math.floor(distance / 3.2));

  carveTrench(x0, y0, x1, y1);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    weldBeads.push({
      x: x0 + dx * t,
      y: y0 + dy * t,
      heat: 1,
      seed: Math.random()
    });
  }
}

// A live puddle drawn with additive blending so it glows. The centre uses a
// hotter colour than the rim, and the whole bead throws a soft halo.
function drawMoltenBead(bead) {
  const radius = 5.2 + bead.heat * 1.8;
  const coreHeat = Math.min(1, bead.heat + 0.3);
  const glowR = radius * 3;

  context.save();
  context.globalCompositeOperation = 'lighter';

  const halo = context.createRadialGradient(bead.x, bead.y, 0, bead.x, bead.y, glowR);
  halo.addColorStop(0, `rgba(255,120,40,${0.5 * bead.heat})`);
  halo.addColorStop(0.4, `rgba(255,80,20,${0.25 * bead.heat})`);
  halo.addColorStop(1, 'rgba(255,60,0,0)');
  context.fillStyle = halo;
  context.beginPath();
  context.arc(bead.x, bead.y, glowR, 0, Math.PI * 2);
  context.fill();

  const body = context.createRadialGradient(
    bead.x - radius * 0.35, bead.y - radius * 0.35, radius * 0.1,
    bead.x, bead.y, radius
  );
  body.addColorStop(0, heatColor(coreHeat));
  body.addColorStop(0.5, heatColor(bead.heat));
  body.addColorStop(1, heatColor(bead.heat * 0.75));
  context.fillStyle = body;
  context.beginPath();
  context.arc(bead.x, bead.y, radius, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

// Permanent version of a bead, painted onto the offscreen canvas: a scorched
// oxide halo, a drop shadow, a raised crown with a glint, and a dark bite
// where the bead meets the parent metal.
function bakeBead(bead) {
  const r = 5.4 + bead.seed * 1.4;
  const tint = 0.04 - bead.seed * 0.08; // subtle cool/warm variance

  const oxidized = surfaceContext.createRadialGradient(bead.x, bead.y, r * 0.4, bead.x, bead.y, r * 2.1);
  oxidized.addColorStop(0, 'rgba(92,64,44,0.28)');
  oxidized.addColorStop(1, 'rgba(92,64,44,0)');
  surfaceContext.fillStyle = oxidized;
  surfaceContext.beginPath();
  surfaceContext.arc(bead.x, bead.y, r * 2.1, 0, Math.PI * 2);
  surfaceContext.fill();

  const shadow = surfaceContext.createRadialGradient(
    bead.x, bead.y + 1.3, r * 0.3, bead.x, bead.y + 1.3, r * 1.7
  );
  shadow.addColorStop(0, 'rgba(0,0,0,0.5)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  surfaceContext.fillStyle = shadow;
  surfaceContext.beginPath();
  surfaceContext.arc(bead.x, bead.y + 1.3, r * 1.7, 0, Math.PI * 2);
  surfaceContext.fill();

  const upper = surfaceContext.createRadialGradient(
    bead.x - r * 0.4, bead.y - r * 0.45, r * 0.15, bead.x, bead.y, r
  );
  upper.addColorStop(0, `hsl(210, 14%, ${82 + tint * 100}%)`);
  upper.addColorStop(0.55, `hsl(212, 12%, ${62 + tint * 100}%)`);
  upper.addColorStop(1, `hsl(214, 10%, ${50 + tint * 100}%)`);
  surfaceContext.fillStyle = upper;
  surfaceContext.beginPath();
  surfaceContext.arc(bead.x, bead.y, r, 0, Math.PI * 2);
  surfaceContext.fill();

  surfaceContext.fillStyle = 'rgba(255,255,255,0.30)';
  surfaceContext.beginPath();
  surfaceContext.arc(bead.x - r * 0.35, bead.y - r * 0.4, r * 0.28, 0, Math.PI * 2);
  surfaceContext.fill();

  surfaceContext.strokeStyle = 'rgba(30,28,26,0.35)';
  surfaceContext.lineWidth = 1.5;
  surfaceContext.beginPath();
  surfaceContext.arc(bead.x, bead.y + r * 0.5, r * 0.62, 0.2, Math.PI * 1.15);
  surfaceContext.stroke();
}

// Sparks fly out of the work, flinging glowing streaks that fall, bounce and
// burn out. Weld sparks are brighter and fling further than grind sparks.
function emitSparks(x, y, count, baseHue, hot) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = hot ? 1.5 + Math.random() * 4 : 1 + Math.random() * 3;
    sparks.push({
      x, y, px: x, py: y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - (hot ? 1.2 : 0.4),
      life: 1,
      size: (Math.random() * 2.2 + 1) * (hot ? 1.2 : 0.8),
      hue: baseHue + Math.random() * 24
    });
  }
}

function drawSparks(surfaceY) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const spark = sparks[i];
    spark.px = spark.x;
    spark.py = spark.y;
    spark.x += spark.vx;
    spark.y += spark.vy;
    spark.vy += 0.22;
    spark.vx *= 0.985;

    // Sparks drop back onto the seam and skip off it.
    if (spark.y > surfaceY + 2) {
      spark.y = surfaceY + 2;
      spark.vy *= -0.35;
      spark.vx *= 0.8;
    }

    spark.life -= 0.022;
    if (spark.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }

    context.save();
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = Math.min(1, spark.life * 1.4);
    context.strokeStyle = `hsl(${spark.hue},100%,${60 + spark.life * 35}%)`;
    context.lineWidth = Math.max(0.5, spark.size * spark.life);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(spark.px, spark.py);
    context.lineTo(spark.x, spark.y);
    context.stroke();
    context.restore();
  }
}

// Pale grey welding fumes that drift up and spread as they cool.
function emitSmoke(x, y) {
  if (smoke.length > 60) return;
  smoke.push({
    x: x + (Math.random() - 0.5) * 6,
    y: y + (Math.random() - 0.5) * 4,
    vx: (Math.random() - 0.5) * 0.35,
    vy: -(0.5 + Math.random() * 0.6),
    life: 1,
    size: 4 + Math.random() * 5
  });
}

function drawSmoke() {
  for (let i = smoke.length - 1; i >= 0; i--) {
    const p = smoke[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.99;
    p.size += 0.35;
    p.life -= 0.011;

    if (p.life <= 0) {
      smoke.splice(i, 1);
      continue;
    }

    const a = p.life * 0.16;
    const g = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
    g.addColorStop(0, `rgba(120,124,138,${a})`);
    g.addColorStop(0.6, `rgba(70,74,86,${a * 0.6})`);
    g.addColorStop(1, 'rgba(60,64,74,0)');
    context.save();
    context.fillStyle = g;
    context.beginPath();
    context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

// The heat-affected zone: where the torch has passed, the parent metal keeps
// glowing dull red for a while before cooling back to steel.
function addHeatPatch(x, y) {
  if (heatPatches.length > 140) heatPatches.shift();
  heatPatches.push({ x, y, r: 16 + Math.random() * 10, heat: 1 });
}

function drawHeatPatches() {
  for (let i = heatPatches.length - 1; i >= 0; i--) {
    const p = heatPatches[i];
    p.heat -= 0.005;
    p.r += 0.12;
    if (p.heat <= 0) {
      heatPatches.splice(i, 1);
      continue;
    }

    const rad = p.r * (0.7 + p.heat * 0.6);
    const g = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
    g.addColorStop(0, `rgba(255,150,60,${0.3 * p.heat})`);
    g.addColorStop(0.45, `rgba(255,70,20,${0.16 * p.heat})`);
    g.addColorStop(1, 'rgba(255,50,10,0)');

    context.save();
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = g;
    context.beginPath();
    context.arc(p.x, p.y, rad, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

// Grinding doesn't erase so much as rough the surface back up - a bright
// patch of bare steel where the weld used to be. It also quenches any glow.
function grindAt(x, y) {
  const radius = 24;
  const patch = surfaceContext.createRadialGradient(x, y, 0, x, y, radius);
  patch.addColorStop(0, 'rgba(206,212,220,0.9)');
  patch.addColorStop(0.5, 'rgba(150,158,168,0.7)');
  patch.addColorStop(1, 'rgba(70,76,84,0)');
  surfaceContext.fillStyle = patch;
  surfaceContext.beginPath();
  surfaceContext.arc(x, y, radius, 0, Math.PI * 2);
  surfaceContext.fill();

  for (let i = weldBeads.length - 1; i >= 0; i--) {
    if (Math.hypot(weldBeads[i].x - x, weldBeads[i].y - y) < radius) {
      weldBeads.splice(i, 1);
    }
  }

  for (let i = heatPatches.length - 1; i >= 0; i--) {
    if (Math.hypot(heatPatches[i].x - x, heatPatches[i].y - y) < radius + 8) {
      heatPatches[i].heat -= 0.15;
    }
  }
}

// --- Flame ---------------------------------------------------------------

// Rough half-width profile along the flame axis: pinched at the nozzle,
// bulky through the middle, wispy at the tip.
function flameWidthShape(t) {
  const bell = Math.sin(Math.PI * Math.min(t * 1.25, 1));
  const tip = Math.max(0, 1 - Math.pow(Math.max(0, t - 0.55) * 2.1, 2.2));
  return Math.max(0.12, bell * (0.45 + 0.55 * tip));
}

// Traces a lens-shaped flame lobe from (ax,ay) out to (bx,by) and fills it.
// The left and right edges flutter on independent phases so it reads as
// live fire rather than a static teardrop.
function traceFlame(ax, ay, bx, by, maxW, flutter, seed) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const N = 20;
  const lx = [], ly = [], rx = [], ry = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = maxW * flameWidthShape(t);
    const tipCut = Math.max(0, Math.pow(1 - Math.max(0, t - 0.45) / 0.55, 2));
    const wl = flutter * t * tipCut * (Math.sin(t * 15 + seed) + 0.45 * Math.sin(t * 27 + seed * 1.9));
    const wr = flutter * t * tipCut * (Math.sin(t * 15 + seed + 2.4) + 0.45 * Math.sin(t * 27 + seed * 1.9 + 4));
    const bx0 = ax + dx * t;
    const by0 = ay + dy * t;
    lx.push(bx0 + nx * (w + wl));
    ly.push(by0 + ny * (w + wl));
    rx.push(bx0 - nx * (w + wr));
    ry.push(by0 - ny * (w + wr));
  }

  context.beginPath();
  context.moveTo(lx[0], ly[0]);
  for (let i = 1; i <= N; i++) context.lineTo(lx[i], ly[i]);
  for (let i = N - 1; i >= 0; i--) context.lineTo(rx[i], ry[i]);
  context.closePath();
  context.fill();
}

// The molten pool where the flame plays on the metal. It stretches in the
// direction of travel and shimmers with chasing ripples.
function drawMoltenPool(cx, cy) {
  const t = performance.now() / 1000;
  const speed = Math.hypot(smoothVel.x, smoothVel.y);
  const ang = Math.atan2(smoothVel.y, smoothVel.x);
  const rx = 13 + Math.min(speed * 0.25, 9);
  const ry = 7;

  context.save();
  context.translate(cx, cy);
  context.rotate(ang);

  const puddle = context.createRadialGradient(0, 0, 0, 0, 0, rx);
  puddle.addColorStop(0, 'rgba(255,236,180,0.95)');
  puddle.addColorStop(0.3, 'rgba(255,170,60,0.8)');
  puddle.addColorStop(0.75, 'rgba(255,90,20,0.35)');
  puddle.addColorStop(1, 'rgba(255,60,0,0)');
  context.fillStyle = puddle;
  context.beginPath();
  context.ellipse(0, 0, rx, ry * 1.5, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = 'rgba(255,255,220,0.5)';
  context.lineWidth = 1;
  for (let k = 0; k < 2; k++) {
    const phase = (t * (10 - k * 3)) % 1;
    context.beginPath();
    context.ellipse(0, 0, rx * (0.4 + phase * 0.5), ry * (0.4 + phase * 0.5), 0,
      Math.PI * 0.2 + k, Math.PI * 0.7 + k);
    context.stroke();
  }

  context.restore();
}

// The copper torch tip and its slender neck, straight above the flame.
function drawTorchHead(x, y) {
  context.save();
  const neck = context.createLinearGradient(x - 2, y - 22, x + 2, y - 22);
  neck.addColorStop(0, '#3a3e45');
  neck.addColorStop(0.5, '#6d7280');
  neck.addColorStop(1, '#3a3e45');
  context.fillStyle = neck;
  context.fillRect(x - 2, y - 22, 4, 22);

  const tip = context.createLinearGradient(x - 3, y - 6, x + 3, y - 6);
  tip.addColorStop(0, '#a45a24');
  tip.addColorStop(0.5, '#e09152');
  tip.addColorStop(1, '#7c3a12');
  context.fillStyle = tip;
  context.beginPath();
  context.moveTo(x - 4.5, y - 6);
  context.lineTo(x + 4.5, y - 6);
  context.lineTo(x + 2.2, y);
  context.lineTo(x - 2.2, y);
  context.closePath();
  context.fill();
  context.restore();
}

// The whole torch assembly. The flame leans slightly into the direction of
// travel, flickers on layered noise, and roared full height while welding.
// At rest it burns down to a quiet pilot flame.
function drawTorchFlame(cx, cy) {
  const now = performance.now() / 1000;
  const on = isWelding;
  const flick = 1 + 0.07 * Math.sin(now * 21) + 0.05 * Math.sin(now * 37 + 2);
  const len = (on ? 62 : 24) * flick;
  const maxW = on ? 9 : 3.5;
  const seed = now * 5;
  const lean = Math.max(-9, Math.min(9, -smoothVel.x * 0.14));

  const ax = cx + lean * 0.55;
  const ay = cy - len;

  context.save();
  context.globalCompositeOperation = 'lighter';

  // Broad sooty halo so the fire bleeds light into the surrounding metal.
  const halo = context.createRadialGradient(cx, cy - len * 0.35, 0, cx, cy - len * 0.35, len * 0.8);
  halo.addColorStop(0, `rgba(255,150,50,${on ? 0.28 : 0.1})`);
  halo.addColorStop(0.6, `rgba(255,90,25,${on ? 0.1 : 0.03})`);
  halo.addColorStop(1, 'rgba(255,60,0,0)');
  context.fillStyle = halo;
  context.beginPath();
  context.arc(cx, cy - len * 0.35, len * 0.8, 0, Math.PI * 2);
  context.fill();

  // Luminous outer feather.
  const feather = context.createLinearGradient(ax, ay, cx, cy);
  feather.addColorStop(0, 'rgba(255,110,30,0.1)');
  feather.addColorStop(0.4, 'rgba(255,160,55,0.6)');
  feather.addColorStop(0.8, `rgba(255,120,30,${on ? 0.35 : 0.15})`);
  feather.addColorStop(1, 'rgba(255,80,0,0)');
  context.fillStyle = feather;
  traceFlame(ax, ay, cx, cy, maxW * 1.7, on ? 2.2 : 0.7, seed);

  // Bright yellow heart of the flame.
  const body = context.createLinearGradient(ax, ay, cx, cy);
  body.addColorStop(0, 'rgba(255,190,70,0.15)');
  body.addColorStop(0.5, `rgba(255,225,130,${on ? 0.85 : 0.35})`);
  body.addColorStop(1, 'rgba(255,140,0,0)');
  context.fillStyle = body;
  traceFlame(ax, ay, cx, cy, maxW * 0.85, on ? 1.2 : 0.4, seed + 3.1);

  // Hot blue-white inner cone, the neutral oxy-acetylene flame cutting down
  // to the surface.
  const coneBase = maxW * 0.5;
  context.beginPath();
  context.moveTo(ax - coneBase, ay);
  context.lineTo(ax + coneBase, ay);
  context.lineTo(cx, cy);
  context.closePath();
  const cone = context.createLinearGradient(ax, ay, cx, cy);
  cone.addColorStop(0, on ? 'rgba(150,205,255,0.75)' : 'rgba(150,205,255,0.3)');
  cone.addColorStop(0.45, on ? 'rgba(235,250,255,0.95)' : 'rgba(235,250,255,0.35)');
  cone.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = cone;
  context.fill();

  // Kiss point where the cone meets the metal.
  const hot = context.createRadialGradient(cx, cy, 0, cx, cy, maxW * 2.4);
  hot.addColorStop(0, on ? 'rgba(255,250,220,0.95)' : 'rgba(255,250,220,0.3)');
  hot.addColorStop(0.4, on ? 'rgba(255,180,70,0.5)' : 'rgba(255,180,70,0.12)');
  hot.addColorStop(1, 'rgba(255,120,0,0)');
  context.fillStyle = hot;
  context.beginPath();
  context.arc(cx, cy, maxW * 2.4, 0, Math.PI * 2);
  context.fill();

  if (on) drawMoltenPool(cx, cy);

  context.restore();

  drawTorchHead(ax, ay);
}

// Spinning abrasive disc used for the right-click grind.
function drawGrinder(x, y) {
  const t = performance.now() / 1000;
  context.save();
  const disc = context.createRadialGradient(x, y, 0, x, y, 16);
  disc.addColorStop(0, '#9aa1ab');
  disc.addColorStop(0.7, '#5c6269');
  disc.addColorStop(1, '#33373c');
  context.fillStyle = disc;
  context.beginPath();
  context.arc(x, y, 16, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = 'rgba(200,210,220,0.5)';
  context.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    context.beginPath();
    context.arc(x, y, 9 + k * 3, t * 14 + k, t * 14 + k + 0.8);
    context.stroke();
  }
  context.restore();
}

// Main loop: stamp the frozen surface down, then layer the heat soak,
// glowing beads, torch flame and particles on top.
function render() {
  const now = performance.now();

  if (pointer) {
    if (lastSeen) {
      const vx = pointer.x - lastSeen.x;
      const vy = pointer.y - lastSeen.y;
      smoothVel.x = smoothVel.x * 0.82 + vx * 0.18;
      smoothVel.y = smoothVel.y * 0.82 + vy * 0.18;
    }
    lastSeen = { x: pointer.x, y: pointer.y };

    if (isWelding) {
      emitSparks(pointer.x, pointer.y, 2, 34, true);
      idleFrames++;
      if (idleFrames % 2 === 0) addHeatPatch(pointer.x, pointer.y);
      if (Math.random() < 0.12) emitSmoke(pointer.x, pointer.y);
    }
    if (isGrinding) emitSparks(pointer.x, pointer.y, 2, 26, false);
  }

  context.drawImage(surfaceCanvas, 0, 0);

  drawHeatPatches();

  // Torchlight plays across everything nearby while the weld is running.
  if (pointer && isWelding) {
    const f = 0.1 + 0.04 * Math.sin(now / 60) + 0.02 * Math.sin(now / 37);
    context.save();
    context.globalCompositeOperation = 'lighter';
    const amb = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 150);
    amb.addColorStop(0, `rgba(255,150,60,${f})`);
    amb.addColorStop(1, 'rgba(255,110,40,0)');
    context.fillStyle = amb;
    context.beginPath();
    context.arc(pointer.x, pointer.y, 150, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // Cooling is kept slow so the red glow fades out over a second or two
  // rather than snapping straight to the steel colour.
  for (let i = weldBeads.length - 1; i >= 0; i--) {
    const bead = weldBeads[i];
    bead.heat -= 0.0032;
    if (bead.heat <= 0.06) {
      bakeBead(bead);
      weldBeads.splice(i, 1);
      continue;
    }
    drawMoltenBead(bead);
  }

  if (pointer) {
    if (isGrinding) drawGrinder(pointer.x, pointer.y);
    else drawTorchFlame(pointer.x, pointer.y);
  }

  drawSmoke();
  drawSparks(pointer ? pointer.y : height);

  requestAnimationFrame(render);
}

// Mouse events arrive in CSS pixels, but the canvas has its own internal
// size, so scale the coordinates across before using them.
function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * width / rect.width,
    y: (event.clientY - rect.top) * height / rect.height
  };
}

canvas.addEventListener('contextmenu', event => event.preventDefault());

canvas.addEventListener('pointerdown', event => {
  pointer = getPointerPosition(event);
  if (event.button === 2) {
    isGrinding = true;
    grindAt(pointer.x, pointer.y);
  } else {
    isWelding = true;
    lastWeldPoint = pointer;
    lastSeen = null;
    smoothVel = { x: 0, y: 0 };
    idleFrames = 0;
    // Seed a single puddle so a click (instead of a drag) still welds a dot.
    addWeldBeads(pointer.x, pointer.y, pointer.x, pointer.y);
  }
});

canvas.addEventListener('pointermove', event => {
  const next = getPointerPosition(event);
  pointer = next;

  if (isWelding && lastWeldPoint) {
    addWeldBeads(lastWeldPoint.x, lastWeldPoint.y, next.x, next.y);
    if (Math.random() < 0.7) emitSparks(next.x, next.y, 3, 34, true);
    lastWeldPoint = next;
  }

  if (isGrinding) {
    grindAt(next.x, next.y);
  }
});

function endStroke() {
  isWelding = false;
  isGrinding = false;
  lastWeldPoint = null;
}

canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointerleave', endStroke);

// Wipes the welds but leaves the plate texture in place.
resetButton.addEventListener('click', () => {
  weldBeads.length = 0;
  sparks.length = 0;
  smoke.length = 0;
  heatPatches.length = 0;
  paintBasePlate();
});

// Nothing can draw until the texture has finished decoding.
plateImage.onload = () => {
  paintBasePlate();
  requestAnimationFrame(render);
};
plateImage.src = 'metal.png';