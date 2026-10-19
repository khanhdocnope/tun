const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  parseCombinedOutput,
  buildCombinedPrompt
} = require(path.join(__dirname, '../../web-in-vercel/api/batch-helper.js'));

test('parseCombinedOutput: parses clean JSON array', () => {
  const raw = JSON.stringify([
    { n: 1, src: 'こんにちは', tgt: 'Xin chào' },
    { n: 2, src: 'ありがとう', tgt: 'Cảm ơn' }
  ]);
  const res = parseCombinedOutput(raw);
  assert.notEqual(res, null);
  assert.equal(res.lines.length, 2);
  assert.deepEqual(res.lines[0], { src: 'こんにちは', tgt: 'Xin chào', box: null });
  assert.deepEqual(res.lines[1], { src: 'ありがとう', tgt: 'Cảm ơn', box: null });
  assert.deepEqual(res.missing, []);
});

test('parseCombinedOutput: parses box_2d coordinates correctly', () => {
  const raw = JSON.stringify([
    { n: 1, box_2d: [150, 200, 350, 400], src: 'テスト', tgt: 'Thử nghiệm' }
  ]);
  const res = parseCombinedOutput(raw);
  assert.notEqual(res, null);
  assert.equal(res.lines.length, 1);
  assert.deepEqual(res.lines[0], { src: 'テスト', tgt: 'Thử nghiệm', box: [150, 200, 350, 400] });
});

test('parseCombinedOutput: handles markdown fences and think tags', () => {
  const raw = `<think>DeepSeek thinking process...</think>\n\`\`\`json\n[
    {"src": "誰だ？", "tgt": "Ai thế?"}
  ]\n\`\`\``;
  const res = parseCombinedOutput(raw);
  assert.notEqual(res, null);
  assert.equal(res.lines.length, 1);
  assert.deepEqual(res.lines[0], { src: '誰だ？', tgt: 'Ai thế?', box: null });
});

test('parseCombinedOutput: flags missing translations and falls back to src', () => {
  const raw = JSON.stringify([
    { src: ' line 1 ', tgt: '' },
    { src: ' line 2 ', tgt: '(blank)' },
    { src: ' line 3 ', tgt: 'dòng 3' }
  ]);
  const res = parseCombinedOutput(raw);
  assert.notEqual(res, null);
  assert.equal(res.lines.length, 3);
  assert.equal(res.lines[0].tgt, 'line 1');
  assert.equal(res.lines[1].tgt, 'line 2');
  assert.equal(res.lines[2].tgt, 'dòng 3');
  assert.deepEqual(res.missing, [1, 2]);
});

test('parseCombinedOutput: ignores empty/blank src bubbles', () => {
  const raw = JSON.stringify([
    { src: '', tgt: '' },
    { src: '(empty)', tgt: 'ignored' },
    { src: 'valid', tgt: 'hợp lệ' }
  ]);
  const res = parseCombinedOutput(raw);
  assert.notEqual(res, null);
  assert.equal(res.lines.length, 1);
  assert.deepEqual(res.lines[0], { src: 'valid', tgt: 'hợp lệ', box: null });
});

test('parseCombinedOutput: returns null on unparseable input', () => {
  assert.equal(parseCombinedOutput(''), null);
  assert.equal(parseCombinedOutput('Not a JSON string at all'), null);
  assert.equal(parseCombinedOutput('{"error": "something went wrong"}'), null);
});

test('buildCombinedPrompt: includes manga vs webtoon reading orders', () => {
  const mangaPrompt = buildCombinedPrompt({ readingOrder: 'manga', skipSfx: true });
  assert.match(mangaPrompt, /manga/i);
  assert.match(mangaPrompt, /right to left/i);

  const webtoonPrompt = buildCombinedPrompt({ readingOrder: 'webtoon', skipSfx: true });
  assert.match(webtoonPrompt, /webtoon/i);
  assert.match(webtoonPrompt, /top to bottom/i);
});

test('buildCombinedPrompt: handles skipSfx toggle', () => {
  const skipPrompt = buildCombinedPrompt({ skipSfx: true });
  assert.match(skipPrompt, /SFX RULE \(exclude completely\)/i);

  const includePrompt = buildCombinedPrompt({ skipSfx: false });
  assert.match(includePrompt, /SFX RULE \(include, keep in true reading position\)/i);
});

test('buildCombinedPrompt: includes previous context if provided', () => {
  const withContext = buildCombinedPrompt({ prevContext: ['Anh đã tới rồi.', 'Thật không thể tin được!'] });
  assert.match(withContext, /Anh đã tới rồi/);
  assert.match(withContext, /Thật không thể tin được/);
});

test('process-batch handler: exports valid handler and handles parsed variable in outer scope', async () => {
  const handler = require(path.join(__dirname, '../../web-in-vercel/api/process-batch.js'));
  assert.equal(typeof handler, 'function');

  // Verify that calling with missing image returns status 400 without ReferenceError
  let statusCode = 200;
  let responseData = null;
  const mockReq = {
    method: 'POST',
    body: {},
    headers: {}
  };
  const mockRes = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };

  await handler(mockReq, mockRes);
  assert.equal(statusCode, 400);
  assert.match(responseData.error, /imageBase64/i);
});
