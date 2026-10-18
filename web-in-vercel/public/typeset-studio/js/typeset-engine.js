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
   * Cắt dòng vừa vặn chiều ngang (Word-wrapping)
   */
  function wrapParagraph(ctx, words, maxWidth) {
    if (!words.length) return [''];
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + ' ' + word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width <= maxWidth) {
        currentLine = testLine;
      } else {
        // Nếu một từ đơn độc đã dài hơn maxWidth, cố gắng cắt đôi từ
        if (ctx.measureText(currentLine).width > maxWidth && currentLine.length > 5) {
          const mid = Math.floor(currentLine.length / 2);
          lines.push(currentLine.slice(0, mid) + '-');
          currentLine = currentLine.slice(mid) + ' ' + word;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
    }
    lines.push(currentLine);
    return lines;
  }

  /**
   * Tính toán các dòng và chiều cao tổng của toàn bộ đoạn văn bản
   */
  function computeTextLayout(ctx, text, maxWidth, fontSize, fontFamily, lineHeightRatio = 1.25) {
    ctx.font = `${fontSize}px "${fontFamily}", "Comic Neue", "Plus Jakarta Sans", sans-serif`;
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

    // Tìm kiếm nhị phân trong 8 vòng lặp (~1px độ chính xác)
    for (let iter = 0; iter < 10; iter++) {
      const mid = Math.floor((low + high) / 2);
      const layout = computeTextLayout(ctx, text, availableWidth, mid, fontFamily, lineHeightRatio);

      // Kiểm tra có dòng nào bị tràn ngang không
      let widthOverflow = false;
      ctx.font = `${mid}px "${fontFamily}", "Comic Neue", "Plus Jakarta Sans", sans-serif`;
      for (const line of layout.lines) {
        if (ctx.measureText(line).width > availableWidth) {
          widthOverflow = true;
          break;
        }
      }

      if (!widthOverflow && layout.totalHeight <= availableHeight) {
        bestSize = mid;
        low = mid + 1; // Thử kích cỡ to hơn
      } else {
        high = mid - 1; // Thử kích cỡ nhỏ hơn
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
      text,
      font = 'Yuki Arenzi',
      fontSize = 20,
      autoFit = true,
      color = '#000000',
      strokeColor = '#ffffff',
      strokeWidth = 3,
      align = 'center',
      lineHeightRatio = 1.25,
      padding = 8,
      bgFill = 'transparent'
    } = bubble;

    if (!text || width <= 0 || height <= 0) return;

    ctx.save();

    // 1. Vẽ nền bóng thoại nếu có
    if (bgFill && bgFill !== 'transparent') {
      ctx.fillStyle = bgFill;
      ctx.beginPath();
      // Vẽ hình elip hoặc hình chữ nhật bo góc
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Tính kích thước chữ
    const actualFontSize = autoFit
      ? calculateAutoFitFontSize(ctx, text, width, height, font, { padding, lineHeightRatio })
      : fontSize;

    const availableWidth = Math.max(10, width - padding * 2);
    const availableHeight = Math.max(10, height - padding * 2);

    const layout = computeTextLayout(ctx, text, availableWidth, actualFontSize, font, lineHeightRatio);

    ctx.font = `${actualFontSize}px "${font}", "Comic Neue", "Plus Jakarta Sans", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    // 3. Tính tọa độ Y bắt đầu để toàn bộ khối chữ căn giữa theo chiều dọc
    const startY = y + (height - layout.totalHeight) / 2 + (layout.lineHeight / 2);

    // 4. Vẽ từng dòng chữ
    layout.lines.forEach((line, index) => {
      if (!line) return;
      const currentY = startY + index * layout.lineHeight;

      let currentX = x + width / 2; // Mặc định center
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
