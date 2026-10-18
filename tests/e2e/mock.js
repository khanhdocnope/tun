(() => {
  const realFetch = window.fetch.bind(window);
  window.__calls = [];
  window.__inflight = 0;
  window.__maxInflight = 0;
  window.__mock = { cleanFailW: [], transFailW: [], proxy413W: [], delay: 200, failFirst: 0 };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  async function dims(dataUrl) {
    const bmp = await createImageBitmap(await (await realFetch(dataUrl)).blob());
    return [bmp.width, bmp.height];
  }
  function png() {
    const c = document.createElement('canvas'); c.width = 60; c.height = 90;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 60, 90);
    return c.toDataURL('image/png');
  }
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const body = init && init.body ? JSON.parse(init.body) : null;
    if (url.endsWith('/api/config')) return json({ hasEnvKey: true, hasEnvKey2: false, envKeyCount: 1 });
    if (url.endsWith('/api/clean') || url.endsWith('/clean_page')) {
      const direct = url.endsWith('/clean_page');
      const [w, h] = await dims(body.imageBase64);
      window.__inflight++; window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
      await new Promise((r) => setTimeout(r, window.__mock.delay));
      window.__inflight--;
      window.__calls.push({ kind: 'clean', direct, w, h, model: body.inpaintModel, sfx: body.cleanSFX, dil: body.dilationPx, thr: body.detThreshold });
      if (window.__mock.failFirst > 0) { window.__mock.failFirst--; return json({ error: 'tạm thời' }, 503); }
      if (window.__mock.cleanFailW.includes(w)) return json({ error: 'hỏng giả lập' }, 400);
      if (!direct && window.__mock.proxy413W.includes(w)) return new Response('Request Entity Too Large', { status: 413 });
      return json({ cleanedImageBase64: png(), colorMaskBase64: png(), stats: { total_time_ms: 5 } });
    }
    if (url.endsWith('/api/process-batch')) {
      const [w, h] = await dims(body.imageBase64);
      window.__calls.push({ kind: 'ocr', mode: body.mode, w, h, prev: body.prevContext });
      await new Promise((r) => setTimeout(r, 100));
      if (window.__mock.transFailW.includes(w)) return json({ error: 'dịch hỏng giả lập' }, 500);
      return json({ success: true, ocrTextBlock: 'こんにちは ' + w, viTextBlock: 'Xin chào ' + w, missingTranslation: [] });
    }
    if (url.endsWith('/api/ocr')) {
      const [w, h] = await dims(body.imageBase64);
      return json({
        success: true,
        totalBoxes: 1,
        data: [
          { id: 1, box: [100, 150, 250, 400], original_text: 'こんにちは世界', translated_text: 'Xin chào thế giới' }
        ]
      });
    }
    if (url.endsWith('/api/translate-text')) {
      return json({ success: true, translatedText: 'Bản dịch mẫu tiếng Việt' });
    }
    return realFetch(input, init);
  };
})();
