// Welds doodles and text onto a steel plate texture.
// Left-click and drag to weld, right-click and drag to grind it away.

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

let pointer = null;
let isWelding = false;
let isGrinding = false;
let lastWeldPoint = null;

// Beads start red-hot and settle into a grey steel colour. The threshold
// values are just eyeballed checkpoints from a few test runs.
function heatColor(heat) {
  if (heat > 0.90) return '#ff5a40';
  if (heat > 0.70) return '#f2321a';
  if (heat > 0.50) return '#d31f0c';
  if (heat > 0.35) return '#a81a10';
  if (heat > 0.20) return '#7a3e2e';
  if (heat > 0.06) return '#59606b';
  return '#4d535d';
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

// Carves a trench for the segment, then drops weld puddles along it.
function addWeldBeads(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);

  // ~3.4px apart keeps the cooled beads overlapping into one solid line.
  const steps = Math.max(1, Math.floor(distance / 3.4));

  surfaceContext.strokeStyle = 'rgba(0,0,0,0.6)';
  surfaceContext.lineWidth = 12;
  surfaceContext.lineCap = 'round';
  surfaceContext.beginPath();
  surfaceContext.moveTo(x0, y0);
  surfaceContext.lineTo(x1, y1);
  surfaceContext.stroke();

  // A faint trace of light where metal meets metal sells the cut.
  surfaceContext.strokeStyle = 'rgba(255,255,255,0.05)';
  surfaceContext.lineWidth = 1;
  surfaceContext.beginPath();
  surfaceContext.moveTo(x0, y0);
  surfaceContext.lineTo(x1, y1);
  surfaceContext.stroke();

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    weldBeads.push({ x: x0 + dx * t, y: y0 + dy * t, heat: 1 });
  }
}

// A live puddle. The centre uses a hotter colour than the rim so it reads
// like a droplet of glowing metal rather than a flat dot.
function drawMoltenBead(bead) {
  const radius = 5.2 + bead.heat * 1.8;
  const coreHeat = Math.min(1, bead.heat + 0.3);
  const glow = context.createRadialGradient(
    bead.x - radius * 0.35, bead.y - radius * 0.35, radius * 0.1, bead.x, bead.y, radius
  );
  glow.addColorStop(0, heatColor(coreHeat));
  glow.addColorStop(1, heatColor(bead.heat));
  context.shadowBlur = 32 * bead.heat;
  context.shadowColor = `rgba(255,70,25,${bead.heat})`;
  context.fillStyle = glow;
  context.beginPath();
  context.arc(bead.x, bead.y, radius, 0, Math.PI * 2);
  context.fill();
}

// Permanent version of a bead, painted onto the offscreen canvas. A drop
// shadow underneath gives it the raised-weld look.
function bakeBead(bead) {
  const r = 5.6;

  const shadow = surfaceContext.createRadialGradient(
    bead.x, bead.y + 1.2, r * 0.3, bead.x, bead.y + 1.2, r * 1.6
  );
  shadow.addColorStop(0, 'rgba(0,0,0,0.45)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  surfaceContext.fillStyle = shadow;
  surfaceContext.beginPath();
  surfaceContext.arc(bead.x, bead.y + 1.2, r * 1.6, 0, Math.PI * 2);
  surfaceContext.fill();

  // One even silver tone for the whole bead - no bright hotspots.
  const body = surfaceContext.createRadialGradient(
    bead.x, bead.y, r * 0.2, bead.x, bead.y, r
  );
  body.addColorStop(0, '#aab1bc');
  body.addColorStop(1, '#565b65');
  surfaceContext.fillStyle = body;
  surfaceContext.beginPath();
  surfaceContext.arc(bead.x, bead.y, r, 0, Math.PI * 2);
  surfaceContext.fill();
}

// Sparks are short-lived; gravity drags them down and they shrink as they
// burn out. Base hue keeps grinding sparks a duller orange than welding.
function emitSparks(x, y, count, baseHue) {
  for (let i = 0; i < count; i++) {
    sparks.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.9) * 6,
      life: 1,
      size: Math.random() * 2 + 1,
      hue: baseHue + Math.random() * 20
    });
  }
}

function drawSparks() {
  // Iterate backwards because dead sparks are removed mid-loop.
  for (let i = sparks.length - 1; i >= 0; i--) {
    const spark = sparks[i];
    spark.x += spark.vx;
    spark.y += spark.vy;
    spark.vy += 0.25;
    spark.vx *= 0.98;
    spark.life -= 0.03;

    if (spark.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }

    context.save();
    context.globalAlpha = spark.life;
    context.fillStyle = `hsl(${spark.hue},100%,${60 + spark.life * 30}%)`;
    context.shadowBlur = 12;
    context.shadowColor = `hsl(${spark.hue},100%,60%)`;
    context.beginPath();
    context.arc(spark.x, spark.y, spark.size * spark.life, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

// Grinding doesn't erase so much as rough the surface back up - a bright
// patch of bare steel where the weld used to be.
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
}

// The 'torch' is just the glowing arc at the cursor - no handle, no barrel.
function drawTorch(x, y) {
  const radius = (isWelding ? 34 : 18) * (0.9 + Math.random() * 0.3);
  const glow = context.createRadialGradient(x, y, 0, x, y, radius * 1.6);
  glow.addColorStop(0, 'rgba(255,245,215,0.95)');
  glow.addColorStop(0.35, isWelding ? 'rgba(255,205,95,0.7)' : 'rgba(255,205,95,0.3)');
  glow.addColorStop(1, 'rgba(255,120,0,0)');
  context.save();
  context.shadowBlur = isWelding ? 44 : 22;
  context.shadowColor = 'rgba(255,170,45,1)';
  context.fillStyle = glow;
  context.beginPath();
  context.arc(x, y, radius * 1.6, 0, Math.PI * 2);
  context.fill();

  // Hot white centre sits inside the wider glow.
  const core = context.createRadialGradient(x, y, 0, x, y, radius * 0.5);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,225,140,0)');
  context.fillStyle = core;
  context.beginPath();
  context.arc(x, y, radius * 0.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

// Main loop: stamp the frozen surface down, then layer the still-glowing
// beads and sparks on top.
function render() {
  if (pointer) {
    if (isWelding) emitSparks(pointer.x, pointer.y, 2, 35);
    if (isGrinding) emitSparks(pointer.x, pointer.y, 1, 25);
  }

  context.drawImage(surfaceCanvas, 0, 0);

  // Cooling is kept slow (0.0032/frame) so the red glow fades out over
  // a second or two rather than snapping straight to the steel colour.
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
  context.shadowBlur = 0;

  if (pointer) {
    drawTorch(pointer.x, pointer.y);
  }

  drawSparks();
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
    // Seed a single puddle so a click (instead of a drag) still welds a dot.
    addWeldBeads(pointer.x, pointer.y, pointer.x, pointer.y);
  }
});

canvas.addEventListener('pointermove', event => {
  const next = getPointerPosition(event);
  pointer = next;

  if (isWelding && lastWeldPoint) {
    addWeldBeads(lastWeldPoint.x, lastWeldPoint.y, next.x, next.y);
    if (Math.random() < 0.7) emitSparks(next.x, next.y, 3, 35);
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
  paintBasePlate();
});

// Nothing can draw until the texture has finished decoding.
plateImage.onload = () => {
  paintBasePlate();
  requestAnimationFrame(render);
};
plateImage.src = 'metal.png';