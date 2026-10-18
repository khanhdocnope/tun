const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const engineUrl = pathToFileURL(path.join(__dirname, '../../web-in-vercel/public/typeset-studio/js/typeset-engine.js')).href;

// Mock HTML5 Canvas measureText for Node.js test environment
const mockCtx = {
  font: '',
  measureText(str) {
    // Ước tính độ rộng xấp xỉ font-size * 0.6 * số ký tự
    const match = this.font.match(/(\d+)px/);
    const size = match ? parseInt(match[1], 10) : 16;
    return { width: str.length * size * 0.55 };
  }
};

// We import TypesetEngine logic for unit testing
test('tokenizeText: handles single line text', async () => {
  const { TypesetEngine } = await import(engineUrl);
  const tokens = TypesetEngine.tokenizeText('Đây là lời thoại manga');
  assert.equal(tokens.length, 1);
  assert.deepEqual(tokens[0], ['Đây', 'là', 'lời', 'thoại', 'manga']);
});

test('tokenizeText: handles multiple paragraphs and blank lines', async () => {
  const { TypesetEngine } = await import(engineUrl);
  const tokens = TypesetEngine.tokenizeText("Dòng 1\n\nDòng 2");
  assert.equal(tokens.length, 3);
  assert.deepEqual(tokens[0], ['Dòng', '1']);
  assert.deepEqual(tokens[1], []);
  assert.deepEqual(tokens[2], ['Dòng', '2']);
});

test('calculateAutoFitFontSize: finds fitting font size inside box', async () => {
  const { TypesetEngine } = await import(engineUrl);
  const text = 'Này! Đứng lại đó!';
  const size = TypesetEngine.calculateAutoFitFontSize(mockCtx, text, 200, 100, 'Yuki Arenzi', {
    minSize: 10,
    maxSize: 60
  });
  assert.ok(size >= 10);
  assert.ok(size <= 60);
});

test('computeTextLayout: computes wrapped lines and height', async () => {
  const { TypesetEngine } = await import(engineUrl);
  const text = 'Một hai ba bốn năm sáu bảy tám chín mười';
  const layout = TypesetEngine.computeTextLayout(mockCtx, text, 100, 16, 'Yuki Arenzi');
  assert.ok(layout.lines.length >= 2);
  assert.ok(layout.totalHeight > 0);
});

test('tokenizeText: handles Japanese/CJK characters with kinsoku shori', async () => {
  const { TypesetEngine } = await import(engineUrl);
  const text = 'その日は帰ってこないわけでは無いのだろう？';
  const tokens = TypesetEngine.tokenizeText(text);
  assert.equal(tokens.length, 1);
  assert.ok(tokens[0].length > 1, 'Should tokenize CJK into multiple character tokens');
  // Kinsoku Shori: small tsu 'っ' and punctuation '？' must not start a line alone
  assert.ok(tokens[0].includes('帰っ'), 'Small tsu attaches to preceding character');
  assert.ok(tokens[0].includes('う？'), 'Punctuation mark attaches to preceding character');
});

test('computeTextLayout & calculateAutoFitFontSize: Japanese text fills vertical speech bubble', async () => {
  const { TypesetEngine } = await import(engineUrl);
  const text = 'その日は帰ってこないわけでは無いのだろう？';
  // Tall vertical box: 150px width, 300px height
  const boxW = 150;
  const boxH = 300;
  const fittedSize = TypesetEngine.calculateAutoFitFontSize(mockCtx, text, boxW, boxH, 'Yuki Arenzi', {
    minSize: 10,
    maxSize: 60,
    padding: 8
  });

  // Previously, without CJK wrapping, font was forced to ~10px on a single line.
  // With vertical CJK wrapping, font size should be >= 25px and text should wrap into multiple lines.
  assert.ok(fittedSize >= 25, `Expected font size >= 25px, got ${fittedSize}px`);

  const layout = TypesetEngine.computeTextLayout(mockCtx, text, boxW - 16, fittedSize, 'Yuki Arenzi', 1.25, {
    maxHeight: boxH - 16
  });
  assert.ok(layout.lines.length >= 4, `Expected at least 4 wrapped lines in tall bubble, got ${layout.lines.length}`);
  assert.ok(layout.totalHeight > 150, `Expected total text height to fill vertical bubble (>150px), got ${layout.totalHeight}px`);
});
