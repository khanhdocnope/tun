const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock browser Canvas 2D context for Node test environment
function createMockCanvasContext() {
  return {
    font: '',
    textBaseline: '',
    textAlign: '',
    measureText(text) {
      // Simulate proportional font measurement
      return { width: String(text).length * 12 };
    },
    strokeText() {},
    fillText() {},
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    roundRect() {},
    ellipse() {}
  };
}

const typesetEnginePath = path.join(__dirname, '../../web-in-vercel/public/typeset-studio/js/typeset-engine.js');

test('computeFittedBox: properly shrinks oversized bounding box to fit text', async () => {
  const { TypesetEngine } = await import(`file://${typesetEnginePath.replace(/\\/g, '/')}`);
  const mockCtx = createMockCanvasContext();

  const oversizedBubble = {
    x: 100,
    y: 100,
    width: 250,
    height: 600, // Giant height spanning across panels
    text: 'ごめん！！',
    fontSize: 24,
    padding: 8,
    autoFit: false,
    verticalAlign: 'middle'
  };

  const fitted = TypesetEngine.computeFittedBox(oversizedBubble, mockCtx);

  assert.notEqual(fitted, null);
  // Fitted height must be substantially smaller than the original 600px
  assert.equal(fitted.height < 100, true, `Fitted height (${fitted.height}) should be much smaller than 600`);
  assert.equal(fitted.width < oversizedBubble.width, true, `Fitted width (${fitted.width}) should be compact`);
  // Must preserve valid positive coordinates
  assert.equal(fitted.x >= 0, true);
  assert.equal(fitted.y >= 0, true);
});

test('computeFittedBox: respects verticalAlign top vs middle vs bottom', async () => {
  const { TypesetEngine } = await import(`file://${typesetEnginePath.replace(/\\/g, '/')}`);
  const mockCtx = createMockCanvasContext();

  const baseBubble = {
    x: 100,
    y: 100,
    width: 200,
    height: 400,
    text: 'Alo',
    fontSize: 20,
    padding: 6,
    autoFit: false
  };

  const fittedTop = TypesetEngine.computeFittedBox({ ...baseBubble, verticalAlign: 'top' }, mockCtx);
  const fittedMiddle = TypesetEngine.computeFittedBox({ ...baseBubble, verticalAlign: 'middle' }, mockCtx);
  const fittedBottom = TypesetEngine.computeFittedBox({ ...baseBubble, verticalAlign: 'bottom' }, mockCtx);

  assert.equal(fittedTop.y, 100);
  assert.equal(fittedMiddle.y > fittedTop.y, true);
  assert.equal(fittedBottom.y > fittedMiddle.y, true);
});

test('snapBoxToBubble simulation: stops at dark panel border line and does not overshoot', () => {
  // Simulate a 100x200 pixel region with white speech bubble at rows 0..90,
  // dark horizontal panel border at row 95, and content below
  const sw = 100;
  const sh = 200;
  const mockData = new Uint8ClampedArray(sw * sh * 4);

  // Fill bubble with white (255, 255, 255) for rows 10..89
  for (let y = 10; y <= 89; y++) {
    for (let x = 20; x <= 80; x++) {
      const idx = (y * sw + x) * 4;
      mockData[idx] = 250;
      mockData[idx + 1] = 250;
      mockData[idx + 2] = 250;
      mockData[idx + 3] = 255;
    }
  }

  // Row 92 to 96 is a solid black panel line (0, 0, 0)
  for (let y = 92; y <= 96; y++) {
    for (let x = 0; x < sw; x++) {
      const idx = (y * sw + x) * 4;
      mockData[idx] = 10;
      mockData[idx + 1] = 10;
      mockData[idx + 2] = 10;
      mockData[idx + 3] = 255;
    }
  }

  const getLum = (lx, ly) => {
    const idx = (ly * sw + lx) * 4;
    return 0.299 * mockData[idx] + 0.587 * mockData[idx + 1] + 0.114 * mockData[idx + 2];
  };

  // Scan downward from center of bubble (x=50, y=50)
  const seedX = 50;
  let bottomY = 50;
  while (bottomY < sh - 1) {
    const lum = getLum(seedX, bottomY + 1);
    if (lum < 85) break; // Hits dark panel border line!
    bottomY++;
  }

  // The bottom scan MUST stop at row 91, never crossing row 92 panel line!
  assert.equal(bottomY < 92, true, `bottomY (${bottomY}) must not cross panel line at row 92`);
  assert.equal(bottomY >= 89, true);
});
