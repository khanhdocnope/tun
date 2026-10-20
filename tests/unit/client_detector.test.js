const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const detectorModulePath = path.join(__dirname, '../../web-in-vercel/public/typeset-studio/js/client-detector.js');

test('findBoundingBoxesFromBinaryMask: detects two isolated boxes correctly', async () => {
  const { findBoundingBoxesFromBinaryMask } = await import(`file://${detectorModulePath.replace(/\\/g, '/')}`);

  const width = 100;
  const height = 100;
  const mask = new Uint8Array(width * height);

  // Box 1: from (10, 10) to (30, 30) -> size 21x21
  for (let y = 10; y <= 30; y++) {
    for (let x = 10; x <= 30; x++) {
      mask[y * width + x] = 255;
    }
  }

  // Box 2: from (60, 50) to (85, 80) -> size 26x31
  for (let y = 50; y <= 80; y++) {
    for (let x = 60; x <= 85; x++) {
      mask[y * width + x] = 255;
    }
  }

  const boxes = findBoundingBoxesFromBinaryMask(mask, width, height, 10);
  assert.equal(boxes.length, 2, 'Should detect exactly 2 distinct boxes');

  // Verify coordinates
  const b1 = boxes.find(b => b.xmin === 10);
  assert.notEqual(b1, undefined);
  assert.equal(b1.ymin, 10);
  assert.equal(b1.xmax, 30);
  assert.equal(b1.ymax, 30);

  const b2 = boxes.find(b => b.xmin === 60);
  assert.notEqual(b2, undefined);
  assert.equal(b2.ymin, 50);
  assert.equal(b2.xmax, 85);
  assert.equal(b2.ymax, 80);
});

test('mergeCloseBoxes: merges adjacent fragments within distance threshold', async () => {
  const { mergeCloseBoxes } = await import(`file://${detectorModulePath.replace(/\\/g, '/')}`);

  const closeBoxes = [
    { ymin: 10, xmin: 10, ymax: 20, xmax: 30 },
    { ymin: 24, xmin: 10, ymax: 35, xmax: 30 } // distance is only 4px
  ];

  const merged = mergeCloseBoxes(closeBoxes, 8);
  assert.equal(merged.length, 1, 'Close boxes should merge into 1');
  assert.equal(merged[0].ymin, 10);
  assert.equal(merged[0].ymax, 35);
});

test('sortReadingOrderClient: manga order correctly sorts right-to-left within horizontal band', async () => {
  const { sortReadingOrderClient } = await import(`file://${detectorModulePath.replace(/\\/g, '/')}`);

  const boxes = [
    { ymin: 10, xmin: 20, ymax: 50, xmax: 40 }, // Left bubble in top panel
    { ymin: 12, xmin: 80, ymax: 52, xmax: 100 }, // Right bubble in top panel (should be read FIRST)
    { ymin: 150, xmin: 50, ymax: 180, xmax: 70 } // Bottom panel bubble
  ];

  const sorted = sortReadingOrderClient(boxes, 'manga', 40);
  assert.equal(sorted.length, 3);
  // Top-right bubble must be #1
  assert.equal(sorted[0].xmin, 80, 'Manga reading order must read rightmost bubble first');
  // Top-left bubble must be #2
  assert.equal(sorted[1].xmin, 20);
  // Bottom bubble must be #3
  assert.equal(sorted[2].ymin, 150);
});
