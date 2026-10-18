/**
 * Manga Studio Typeset Engine
 * Thuật toán Auto-fit text, Word-wrap tiếng Việt & Canvas Rendering
 */

export const TypesetEngine = (function () {
  const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
  const NO_LINE_START = /^[)\]}〉〕≫＞］｝｣、。，．・：；？！‼⁇⁈⁉ヽヾゝゞ々‐゠–〜～ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶﾟﾞº°%?!,.:;)]/;

  /**
   * Ngắt từ và xử lý dấu câu cho tiếng Việt & tiếng Nhật/CJK
   */
  function tokenizeText(text) {
    if (!text) return [];
    const rawLines = String(text).replace(/\r\n/g, '\n').split('\n');
    const paragraphs = [];

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        paragraphs.push([]);
        continue;
      }
      const words = [];
      const rawTokens = trimmed.split(/\s+/).filter(Boolean);
      for (const rawToken of rawTokens) {
        if (CJK_REGEX.test(rawToken)) {
          // Với tiếng Nhật/CJK: Tách từng ký tự nhưng giữ ký tự dấu dính liền ký tự trước (Kinsoku Shori)
          const chars = Array.from(rawToken);
          let cur = '';
          for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (cur && NO_LINE_START.test(ch)) {
              cur += ch;
              words.push(cur);
              cur = '';
              continue;
            }
            if (CJK_REGEX.test(ch)) {
              if (cur) words.push(cur);
              cur = ch;
            } else {
              cur += ch;
            }
          }
          if (cur) words.push(cur);
        } else {
          words.push(rawToken);
        }
      }
      paragraphs.push(words);
    }
    return paragraphs;
  }

  function joinTokens(tokens) {
    if (!tokens || !tokens.length) return '';
    let res = tokens[0];
    for (let i = 1; i < tokens.length; i++) {
      const prev = tokens[i - 1];
      const curr = tokens[i];
      const isPrevCjk = CJK_REGEX.test(prev.slice(-1));
      const isCurrCjk = CJK_REGEX.test(curr.charAt(0));
      if (isPrevCjk || isCurrCjk) {
        res += curr;
      } else {
        res += ' ' + curr;
      }
    }
    return res;
  }

  function getConnectorWidth(ctx, prevWord, currWord) {
    const isPrevCjk = CJK_REGEX.test(prevWord.slice(-1));
    const isCurrCjk = CJK_REGEX.test(currWord.charAt(0));
    if (isPrevCjk || isCurrCjk) return 0;
    return ctx.measureText(' ').width;
  }

  /**
   * Cắt dòng vừa vặn chiều ngang và cân đối chiều dọc (Word-wrapping)
   * Tối ưu cho cả văn bản Latin (tiếng Việt/Anh) và chữ tượng hình CJK (tiếng Nhật/Trung)
   * Tận dụng tối đa không gian chiều dọc của bóng thoại manga thay vì dồn thành 1 dòng ngang chữ nhỏ
   */
  function wrapParagraph(ctx, words, maxWidth, maxHeight = null) {
    if (!words.length) return [''];
    if (words.length === 1) return [words[0]];

    const wordWidths = words.map(w => ctx.measureText(w).width);
    let totalSingleWidth = wordWidths[0];
    for (let i = 1; i < words.length; i++) {
      totalSingleWidth += getConnectorWidth(ctx, words[i - 1], words[i]) + wordWidths[i];
    }

    const isTallBox = maxHeight && (maxHeight > maxWidth * 1.3);
    if (totalSingleWidth <= maxWidth && (!isTallBox || words.length <= 2)) {
      return [joinTokens(words)];
    }

    const n = words.length;
    let targetLines = Math.max(2, Math.ceil(totalSingleWidth / (maxWidth * 0.92)));
    if (isTallBox && words.length >= 4) {
      targetLines = Math.max(targetLines, Math.min(words.length, Math.round((maxHeight / maxWidth) * 1.4)));
    }
    const targetLineWidth = Math.min(maxWidth, totalSingleWidth / targetLines);

    const dp = new Array(n + 1).fill(Infinity);
    const parent = new Array(n + 1).fill(-1);
    dp[0] = 0;

    for (let i = 0; i < n; i++) {
      if (dp[i] === Infinity) continue;
      let currentLen = 0;

      for (let j = i + 1; j <= n; j++) {
        const wIdx = j - 1;
        const wLen = wordWidths[wIdx];
        const conn = j === i + 1 ? 0 : getConnectorWidth(ctx, words[wIdx - 1], words[wIdx]);
        currentLen += conn + wLen;

        if (currentLen > maxWidth) {
          if (j === i + 1) {
            dp[j] = dp[i] + 100000;
            parent[j] = i;
          }
          break;
        }

        const isLastLine = (j === n);
        const wordsInLine = j - i;
        const diff = targetLineWidth - currentLen;
        let penalty = diff * diff;

        const isCjk = CJK_REGEX.test(words[wIdx]);
        // Phạt dòng chỉ có 1 từ nếu toàn đoạn có nhiều từ (cho chữ Latin)
        if (!isCjk && wordsInLine === 1 && n > 2) {
          penalty += 30000;
        }
        // Phạt cực nặng nếu dòng cuối cùng bị mồ côi 1 từ đơn độc
        if (!isCjk && isLastLine && wordsInLine === 1 && n > 2) {
          penalty += 150000;
        }

        if (dp[i] + penalty < dp[j]) {
          dp[j] = dp[i] + penalty;
          parent[j] = i;
        }
      }
    }

    const lines = [];
    let curr = n;
    while (curr > 0) {
      const prev = parent[curr];
      if (prev === -1) {
        return wrapParagraphGreedy(ctx, words, maxWidth);
      }
      lines.unshift(joinTokens(words.slice(prev, curr)));
      curr = prev;
    }

    return lines;
  }

  function wrapParagraphGreedy(ctx, words, maxWidth) {
    const lines = [];
    let currentWords = [words[0]];
    let currentLen = ctx.measureText(words[0]).width;

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const conn = getConnectorWidth(ctx, words[i - 1], word);
      const wLen = ctx.measureText(word).width;

      if (currentLen + conn + wLen <= maxWidth) {
        currentWords.push(word);
        currentLen += conn + wLen;
      } else {
        lines.push(joinTokens(currentWords));
        currentWords = [word];
        currentLen = wLen;
      }
    }
    if (currentWords.length) {
      lines.push(joinTokens(currentWords));
    }
    return lines;
  }

  /**
   * Tính toán các dòng và chiều cao tổng của toàn bộ đoạn văn bản
   */
  function computeTextLayout(ctx, text, maxWidth, fontSize, fontFamily, lineHeightRatio = 1.25, options = {}) {
    const fontPrefix = (options.isItalic ? 'italic ' : '') + (options.isBold ? 'bold ' : '');
    ctx.font = `${fontPrefix}${fontSize}px "${fontFamily}", "Comic Neue", "Plus Jakarta Sans", sans-serif`;
    const paragraphs = tokenizeText(text);
    const allLines = [];

    for (const para of paragraphs) {
      if (!para.length) {
        allLines.push('');
        continue;
      }
      const wrapped = wrapParagraph(ctx, para, maxWidth, options.maxHeight);
      allLines.push(...wrapped);
    }

    const lineHeight = fontSize * lineHeightRatio;
    const totalHeight = allLines.length * lineHeight;

    return {
      lines: allLines,
      lineHeight,
      totalHeight
    };
  }

  /**
   * Thuật toán tìm kiếm nhị phân cỡ chữ Auto-fit tối ưu
   */
  function calculateAutoFitFontSize(ctx, text, boxWidth, boxHeight, fontFamily, options = {}) {
    const minSize = options.minSize || 10;
    const maxSize = options.maxSize || 90;
    const padding = options.padding != null ? options.padding : 8;
    const lineHeightRatio = options.lineHeightRatio || 1.25;

    const availableWidth = Math.max(20, boxWidth - padding * 2);
    const availableHeight = Math.max(20, boxHeight - padding * 2);

    let low = minSize;
    let high = maxSize;
    let bestSize = minSize;

    const fontPrefix = (options.isItalic ? 'italic ' : '') + (options.isBold ? 'bold ' : '');
    const layoutOptions = { ...options, maxHeight: availableHeight };

    for (let iter = 0; iter < 10; iter++) {
      const mid = Math.floor((low + high) / 2);
      const layout = computeTextLayout(ctx, text, availableWidth, mid, fontFamily, lineHeightRatio, layoutOptions);

      let widthOverflow = false;
      ctx.font = `${fontPrefix}${mid}px "${fontFamily}", "Comic Neue", "Plus Jakarta Sans", sans-serif`;
      for (const line of layout.lines) {
        if (ctx.measureText(line).width > availableWidth) {
          widthOverflow = true;
          break;
        }
      }

      if (!widthOverflow && layout.totalHeight <= availableHeight) {
        bestSize = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return bestSize;
  }

  /**
   * Vẽ chữ của một bóng thoại lên Canvas
   */
  function renderBubble(ctx, bubble, renderOptions = {}) {
    const {
      x, y, width, height,
      font = 'Yuki Arenzi',
      fontSize = 20,
      autoFit = true,
      color = '#000000',
      strokeColor = '#ffffff',
      strokeWidth = 3,
      align = 'center',
      verticalAlign = 'middle',
      lineHeightRatio = 1.25,
      padding = 8,
      bgFill = 'transparent',
      isBold = false,
      isItalic = false,
      isUppercase = false
    } = bubble;

    const displayLang = renderOptions.displayLang || 'vi';
    let displayText = displayLang === 'jp'
      ? (bubble.srcText || bubble.text)
      : (bubble.text || bubble.srcText);

    if (!displayText || width <= 0 || height <= 0) return;
    if (isUppercase) {
      displayText = String(displayText).toUpperCase();
    }

    ctx.save();

    // 1. Vẽ nền bóng thoại nếu có (che phủ các vết lem hoặc làm sạch bóng thoại)
    if (bgFill && bgFill !== 'transparent') {
      ctx.fillStyle = bgFill;
      ctx.beginPath();
      const r = Math.min(18, width / 3, height / 3);
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, r);
      } else {
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // 2. Tính kích thước chữ
    const actualFontSize = autoFit
      ? calculateAutoFitFontSize(ctx, displayText, width, height, font, { padding, lineHeightRatio, isBold, isItalic })
      : fontSize;

    const availableWidth = Math.max(10, width - padding * 2);
    const availableHeight = Math.max(10, height - padding * 2);
    const layout = computeTextLayout(ctx, displayText, availableWidth, actualFontSize, font, lineHeightRatio, { isBold, isItalic, maxHeight: availableHeight });

    const fontPrefix = (isItalic ? 'italic ' : '') + (isBold ? 'bold ' : '');
    ctx.font = `${fontPrefix}${actualFontSize}px "${font}", "Comic Neue", "Plus Jakarta Sans", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    // 3. Tính tọa độ Y bắt đầu theo verticalAlign
    let startY;
    if (verticalAlign === 'top') {
      startY = y + padding + (layout.lineHeight / 2);
    } else if (verticalAlign === 'bottom') {
      startY = y + height - padding - layout.totalHeight + (layout.lineHeight / 2);
    } else {
      startY = y + (height - layout.totalHeight) / 2 + (layout.lineHeight / 2);
    }

    // 4. Vẽ từng dòng chữ
    layout.lines.forEach((line, index) => {
      if (!line) return;
      const currentY = startY + index * layout.lineHeight;

      let currentX = x + width / 2;
      if (align === 'left') {
        currentX = x + padding;
        ctx.textAlign = 'left';
      } else if (align === 'right') {
        currentX = x + width - padding;
        ctx.textAlign = 'right';
      } else {
        ctx.textAlign = 'center';
      }

      // Vẽ stroke viền ngoài chống chìm chữ nếu có
      if (strokeWidth > 0 && strokeColor && strokeColor !== 'transparent') {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth * 2;
        ctx.strokeText(line, currentX, currentY);
      }

      // Vẽ fill chữ
      ctx.fillStyle = color;
      ctx.fillText(line, currentX, currentY);
    });

    ctx.restore();

    return {
      fontSize: actualFontSize,
      lines: layout.lines,
      totalHeight: layout.totalHeight
    };
  }

  /**
   * Tính toán bounding box tối ưu vừa vặn với kích thước chữ thực tế
   */
  function computeFittedBox(bubble, ctx, options = {}) {
    if (!bubble) return null;
    const {
      x = 0,
      y = 0,
      width = 200,
      height = 100,
      text = '',
      srcText = '',
      font = 'Yuki Arenzi',
      fontSize = 22,
      padding = 8,
      lineHeightRatio = 1.25,
      isBold = false,
      isItalic = false,
      autoFit = true,
      verticalAlign = 'middle'
    } = bubble;

    const displayText = (options.displayLang === 'jp' ? (srcText || text) : (text || srcText)) || '';
    if (!displayText.trim()) {
      return { x, y, width, height };
    }

    const testCtx = ctx || (typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null);
    if (!testCtx) return { x, y, width, height };

    const actualFontSize = autoFit
      ? calculateAutoFitFontSize(testCtx, displayText, width, height, font, { padding, lineHeightRatio, isBold, isItalic })
      : fontSize;

    const availableWidth = Math.max(10, width - padding * 2);
    const availableHeight = Math.max(10, height - padding * 2);
    const layout = computeTextLayout(testCtx, displayText, availableWidth, actualFontSize, font, lineHeightRatio, { isBold, isItalic, maxHeight: availableHeight });

    let maxLineWidth = 0;
    layout.lines.forEach(line => {
      if (line) {
        const w = testCtx.measureText(line).width;
        if (w > maxLineWidth) maxLineWidth = w;
      }
    });

    const fittedWidth = Math.max(40, Math.ceil(maxLineWidth + padding * 2));
    const fittedHeight = Math.max(30, Math.ceil(layout.totalHeight + padding * 2));

    const newX = Math.round(x + (width - fittedWidth) / 2);
    let newY = y;
    if (verticalAlign === 'top') {
      newY = y;
    } else if (verticalAlign === 'bottom') {
      newY = Math.round(y + height - fittedHeight);
    } else {
      newY = Math.round(y + (height - fittedHeight) / 2);
    }

    return {
      x: Math.max(0, newX),
      y: Math.max(0, newY),
      width: fittedWidth,
      height: fittedHeight
    };
  }

  return {
    tokenizeText,
    computeTextLayout,
    calculateAutoFitFontSize,
    computeFittedBox,
    renderBubble
  };
})();
