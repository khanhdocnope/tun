/**
 * MoeJect Manga Sniffer & Auto-Scroll Engine
 * Injected / run within WebViews and frames to detect comic chapters and lazy-loaded pages.
 */

export interface SnifferResult {
  title: string;
  pages: string[];
  containerSelector?: string;
  sourceType: 'standard_img' | 'canvas' | 'blob' | 'unknown';
}

const COMMON_MANGA_CONTAINERS = [
  '#reader',
  '#chapter-container',
  '#reading-content',
  '.reading-content',
  '.reader-container',
  '.reader-area',
  '.chapter-content',
  '.page-break',
  '.reader-page',
  '.entry-content',
  '#viewer',
  '.viewer-container',
  '#image-container',
  'div[class*="reading"]',
  'div[class*="chapter"]',
  'div[id*="chapter"]',
  'div[class*="comic-page"]',
];

const AD_KEYWORDS = [
  'banner',
  'advert',
  'sponsor',
  'popup',
  'avatar',
  'icon',
  'badge',
  'pixel',
  'analytics',
  'tracker',
  'logo',
  'footer',
  'button',
  'thumb',
];

/**
 * Extract clean, high-res image source from an HTML element
 */
export function extractImageSrc(el: Element): string | null {
  if (el instanceof HTMLImageElement) {
    // Check common lazy-loading attributes in order of priority
    const candidates = [
      el.getAttribute('data-src'),
      el.getAttribute('data-lazy-src'),
      el.getAttribute('data-original'),
      el.getAttribute('data-url'),
      el.getAttribute('data-actualsrc'),
      el.getAttribute('data-srcset'),
      el.currentSrc,
      el.src,
    ];

    for (const c of candidates) {
      if (c && c.trim() && !c.startsWith('data:image/svg') && !c.includes('transparent.png')) {
        return c.trim();
      }
    }
  } else if (el.tagName.toLowerCase() === 'canvas') {
    try {
      const canvas = el as HTMLCanvasElement;
      if (canvas.width > 200 && canvas.height > 200) {
        return canvas.toDataURL('image/webp');
      }
    } catch {}
  }
  return null;
}

/**
 * Filter out advertisements, icons, and non-manga graphics
 */
function isValidMangaImage(src: string, el?: Element): boolean {
  if (!src) return false;
  const s = src.toLowerCase();

  // Keyword check
  for (const kw of AD_KEYWORDS) {
    if (s.includes(kw)) return false;
  }

  // Dimension check if element is available
  if (el instanceof HTMLImageElement) {
    const w = el.naturalWidth || el.width || el.clientWidth;
    const h = el.naturalHeight || el.height || el.clientHeight;
    // Real manga page usually has significant dimensions
    if (w > 0 && h > 0) {
      if (w < 180 || h < 250) return false;
    }
  }

  return true;
}

/**
 * Scan the current Document / DOM for manga pages
 */
export function scanDocumentForMangaPages(doc: Document = document): SnifferResult {
  const resultPages: string[] = [];
  const seen = new Set<string>();

  // 1. Check known manga reader containers first for highest accuracy
  for (const selector of COMMON_MANGA_CONTAINERS) {
    const container = doc.querySelector(selector);
    if (container) {
      const imgs = container.querySelectorAll('img, picture img, canvas');
      if (imgs.length >= 3) {
        imgs.forEach((el) => {
          const src = extractImageSrc(el);
          if (src && !seen.has(src) && isValidMangaImage(src, el)) {
            seen.add(src);
            resultPages.push(src);
          }
        });

        if (resultPages.length >= 3) {
          return {
            title: doc.title || 'Manga Chapter',
            pages: resultPages,
            containerSelector: selector,
            sourceType: 'standard_img',
          };
        }
      }
    }
  }

  // 2. Fallback: Scan all image and canvas elements across document
  const allImgs = doc.querySelectorAll('img, canvas');
  allImgs.forEach((el) => {
    const src = extractImageSrc(el);
    if (src && !seen.has(src) && isValidMangaImage(src, el)) {
      seen.add(src);
      resultPages.push(src);
    }
  });

  return {
    title: doc.title || 'Manga Chapter',
    pages: resultPages,
    sourceType: 'standard_img',
  };
}

/**
 * Auto-scroll page to trigger lazy loading of long webtoon/manga chapters
 */
export function autoScrollAndCollect(
  win: Window = window,
  onProgress?: (scrolledPct: number, count: number) => void,
  onComplete?: (result: SnifferResult) => void
): () => void {
  let isCancelled = false;
  const initialScrollY = win.scrollY;

  const cancel = () => {
    isCancelled = true;
  };

  const step = 450;
  const delay = 130;

  const scrollNext = () => {
    if (isCancelled) return;

    const maxScroll = Math.max(
      win.document.body.scrollHeight,
      win.document.documentElement.scrollHeight
    ) - win.innerHeight;

    const currentScroll = win.scrollY;

    if (currentScroll < maxScroll - 50) {
      win.scrollBy({ top: step, behavior: 'smooth' });
      const pct = Math.min(100, Math.round((currentScroll / (maxScroll || 1)) * 100));
      const currentScan = scanDocumentForMangaPages(win.document);
      onProgress?.(pct, currentScan.pages.length);
      setTimeout(scrollNext, delay);
    } else {
      // Reached bottom: wait a moment for final images to render
      setTimeout(() => {
        if (isCancelled) return;
        win.scrollTo({ top: initialScrollY, behavior: 'smooth' });
        const finalScan = scanDocumentForMangaPages(win.document);
        onProgress?.(100, finalScan.pages.length);
        onComplete?.(finalScan);
      }, 400);
    }
  };

  setTimeout(scrollNext, 100);
  return cancel;
}
