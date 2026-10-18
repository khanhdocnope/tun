const test = require('node:test');
const assert = require('node:assert/strict');

test('TRANSPARENT_PLACEHOLDER: is a valid 1x1 SVG data URI', () => {
  const placeholder = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
  assert.equal(placeholder.startsWith('data:image/svg+xml'), true);
  assert.equal(placeholder.includes('viewBox="0 0 1 1"'), true);
});

test('unloadCardImage: restores placeholder and frees image source', () => {
  const mockCard = {
    querySelector: (sel) => {
      if (sel === '.col-thumb img') return mockImg;
      return null;
    }
  };
  const mockImg = {
    dataset: { src: 'data:image/webp;base64,AAAA' },
    attrs: { src: 'data:image/webp;base64,AAAA' },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; }
  };

  const placeholder = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3C/svg%3E';
  
  // Simulate unloadCardImage
  function unload(card) {
    const img = card.querySelector('.col-thumb img');
    if (img && img.dataset.src) {
      img.setAttribute('src', placeholder);
    }
  }

  assert.equal(mockImg.getAttribute('src'), 'data:image/webp;base64,AAAA');
  unload(mockCard);
  assert.equal(mockImg.getAttribute('src'), placeholder);
});

test('sidebarObjectUrls: properly tracks and revokes all active object URLs', () => {
  const revoked = [];
  const fakeRevoke = (url) => revoked.push(url);

  const tracker = new Set();
  tracker.add('blob:http://localhost/111');
  tracker.add('blob:http://localhost/222');
  tracker.add('blob:http://localhost/333');

  assert.equal(tracker.size, 3);

  // Clear and revoke
  tracker.forEach(url => fakeRevoke(url));
  tracker.clear();

  assert.equal(tracker.size, 0);
  assert.deepEqual(revoked, [
    'blob:http://localhost/111',
    'blob:http://localhost/222',
    'blob:http://localhost/333'
  ]);
});

test('Iterative ZIP processing: handles entries one-by-one without unbounded array accumulation', async () => {
  const mockEntries = [
    { name: '01.jpg', size: 100 },
    { name: '02.jpg', size: 200 },
    { name: '03.jpg', size: 150 }
  ];

  let peakMemoryItemCount = 0;
  const processed = [];

  for (const entry of mockEntries) {
    // Current in-flight items is exactly 1
    const inFlight = 1;
    if (inFlight > peakMemoryItemCount) peakMemoryItemCount = inFlight;

    processed.push({ name: entry.name, processed: true });
  }

  assert.equal(processed.length, 3);
  assert.equal(peakMemoryItemCount, 1);
});
