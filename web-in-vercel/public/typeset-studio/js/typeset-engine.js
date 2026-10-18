/**
 * Manga Studio Typeset Engine
 * Thuật toán Auto-fit text, Word-wrap tiếng Việt & Canvas Rendering
 */

export const TypesetEngine = (function () {
  /**
   * Ngắt từ và xử lý dấu câu cho tiếng Việt
   */
  function tokenizeText(text) {
    if (!text) return [];
    // Tách theo dòng trước
    const rawLines = String(text).replace(/\r\n/g, '\n').split('\n');
    const paragraphs = [];

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        paragraphs.push([]);
        continue;
      }
      // Tách từ theo khoảng trắng
      const words = trimmed.split(/\s+/).filter(Boolean);
      paragraphs.push(words);
    }
    return paragraphs;
  }

  /**
   * Cắt dòng vừa vặn chiều ngang (Word-wrapping) với thuật toán cân bằng dòng
   * Tránh chữ mồ côi (orphan words) và tạo khối chữ đối xứng hình thoi/oval chuẩn manga
   */
  function wrapParagraph(ctx, words, maxWidth) {
    if (!words.length) return [''];
    if (words.length === 1) return [words[0]];

    const spaceWidth = ctx.measureText(' ').width;
    const wordWidths = words.map(w => ctx.measureText(w).width);
    const totalSingleWidth = wordWidths.reduce((a, b) => a + b, 0) + (words.length - 1) * spaceWidth;
    if (totalSingleWidth <= maxWidth) {
      return [words.join(' ')];
    }

    const n = words.length;
    const targetLines = Math.max(2, Math.ceil(totalSingleWidth / (maxWidth * 0.92)));
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
        currentLen += (j === i + 1 ? wLen : spaceWidth + wLen);

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

        // Phạt dòng chỉ có 1 từ nếu toàn đoạn có nhiều từ
        if (wordsInLine === 1 && n > 2) {
          penalty += 30000;
        }
        // Phạt cực nặng nếu dòng cuối cùng bị mồ côi 1 từ đơn độc
        if (isLastLine && wordsInLine === 1 && n > 2) {
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
      lines.unshift(words.slice(prev, curr).join(' '));
      curr = prev;
    }

    return lines;
  }

  function wrapParagraphGreedy(ctx, words, maxWidth) {
    const lines = [];
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + ' ' + word;
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
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
      const wrapped = wrapParagraph(ctx, para, maxWidth);
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

    for (let iter = 0; iter < 10; iter++) {
      const mid = Math.floor((low + high) / 2);
      const layout = computeTextLayout(ctx, text, availableWidth, mid, fontFamily, lineHeightRatio, options);

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
    const layout = computeTextLayout(ctx, displayText, availableWidth, actualFontSize, font, lineHeightRatio, { isBold, isItalic });

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

  return {
    tokenizeText,
    computeTextLayout,
    calculateAutoFitFontSize,
    renderBubble
  };
})();
