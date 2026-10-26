/**
 * Frontend API Service for Comic Translation Studio.
 * Connects to the FastAPI backend (local or Hugging Face Space).
 */

export interface BoundingBoxAPI {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRRegionAPI {
  id: string;
  polygon: [number, number][];
  bounding_box: BoundingBoxAPI;
  text: string;
  confidence: number;
  orientation: 'horizontal' | 'vertical';
  reading_order: number;
}

export interface OCRDetectResponseAPI {
  regions: OCRRegionAPI[];
  engine: string;
  detected_languages: string[];
  reading_order: string;
  image_width: number;
  image_height: number;
  processing_time_ms: number;
}

export interface InpaintRegionInput {
  x: number;
  y: number;
  width: number;
  height: number;
  polygon?: [number, number][];
}

export interface CapabilitiesAPI {
  ocr: {
    available_engines: string[];
    default_engine: string;
    languages: string[];
  };
  inpainting: {
    available_engines: string[];
    default_engine: string;
  };
  translation: {
    available_providers: string[];
    default_provider: string;
  };
  limits: {
    max_upload_size_mb: number;
    supported_image_types: string[];
  };
}

const STORAGE_KEY_BACKEND_URL = 'comic_backend_url';
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

/**
 * Get configured backend URL with fallback
 */
export function getBackendUrl(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_BACKEND_URL);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }
  } catch {
    // ignore
  }
  return DEFAULT_BACKEND_URL;
}

/**
 * Set and persist backend URL
 */
export function setBackendUrl(url: string): void {
  const cleaned = (url || '').trim().replace(/\/+$/, '');
  try {
    if (cleaned) {
      localStorage.setItem(STORAGE_KEY_BACKEND_URL, cleaned);
    } else {
      localStorage.removeItem(STORAGE_KEY_BACKEND_URL);
    }
  } catch {
    // ignore
  }
}

/**
 * Test connectivity to the backend
 */
export async function testBackendConnection(url?: string): Promise<{
  ok: boolean;
  status: number;
  message: string;
  latencyMs: number;
  isHfSpace?: boolean;
}> {
  const targetUrl = (url || getBackendUrl()).replace(/\/+$/, '');
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(`${targetUrl}/api/v1/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (resp.ok) {
      return {
        ok: true,
        status: resp.status,
        message: 'Backend operational',
        latencyMs,
        isHfSpace: targetUrl.includes('.hf.space'),
      };
    }

    // Space might be sleeping or returning 503
    if (resp.status === 503 || resp.status === 502) {
      return {
        ok: false,
        status: resp.status,
        message: 'Hugging Face Space is sleeping or booting up. Please wait 15-30s.',
        latencyMs,
        isHfSpace: true,
      };
    }

    return {
      ok: false,
      status: resp.status,
      message: `Backend returned status ${resp.status}`,
      latencyMs,
      isHfSpace: targetUrl.includes('.hf.space'),
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    if (err.name === 'AbortError') {
      return {
        ok: false,
        status: 408,
        message: 'Connection timed out. If using a free Hugging Face Space, it may be cold-starting.',
        latencyMs,
        isHfSpace: targetUrl.includes('.hf.space'),
      };
    }
    return {
      ok: false,
      status: 0,
      message: err.message || 'Cannot reach backend server. Check URL and CORS.',
      latencyMs,
      isHfSpace: targetUrl.includes('.hf.space'),
    };
  }
}

/**
 * Fetch capabilities supported by the backend
 */
export async function fetchCapabilities(baseUrl?: string): Promise<CapabilitiesAPI> {
  const url = `${baseUrl || getBackendUrl()}/api/v1/capabilities`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch capabilities: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Detect text regions and OCR using the backend
 */
export async function detectOCR(
  imageBlob: Blob,
  options?: {
    engine?: string;
    languages?: string[];
    reading_order?: 'rtl' | 'ltr';
    baseUrl?: string;
  }
): Promise<OCRDetectResponseAPI> {
  const baseUrl = options?.baseUrl || getBackendUrl();
  const formData = new FormData();

  const filename = (imageBlob as File).name || 'comic_page.png';
  formData.append('file', imageBlob, filename);

  if (options?.engine) {
    formData.append('engine', options.engine);
  }
  if (options?.languages && options.languages.length > 0) {
    formData.append('languages', JSON.stringify(options.languages));
  }
  if (options?.reading_order) {
    formData.append('reading_order', options.reading_order);
  }

  const res = await fetch(`${baseUrl}/api/v1/ocr/detect`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) {
        errorDetail = errJson.error.message;
      } else if (errJson?.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // ignore
    }
    throw new Error(`OCR detection failed: ${errorDetail}`);
  }

  return res.json();
}

/**
 * Inpaint/clean regions or mask from an image using the backend
 */
export async function processInpaint(
  imageBlob: Blob,
  options: {
    regions?: InpaintRegionInput[];
    maskBlob?: Blob;
    dilation?: number;
    engine?: 'opencv_telea' | 'opencv_ns';
    baseUrl?: string;
  }
): Promise<{
  cleanedBlob: Blob;
  engine: string;
  durationMs: number;
}> {
  const baseUrl = options.baseUrl || getBackendUrl();
  const formData = new FormData();

  const filename = (imageBlob as File).name || 'comic_page.png';
  formData.append('file', imageBlob, filename);

  if (options.regions && options.regions.length > 0) {
    formData.append('regions', JSON.stringify(options.regions));
  }
  if (options.maskBlob) {
    formData.append('mask', options.maskBlob, 'mask.png');
  }
  if (options.dilation !== undefined) {
    formData.append('dilation', options.dilation.toString());
  }
  if (options.engine) {
    formData.append('engine', options.engine);
  }

  const res = await fetch(`${baseUrl}/api/v1/inpaint/process`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) {
        errorDetail = errJson.error.message;
      } else if (errJson?.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // ignore
    }
    throw new Error(`Inpainting failed: ${errorDetail}`);
  }

  const engine = res.headers.get('X-Inpaint-Engine') || options.engine || 'opencv_telea';
  const durationMs = Number(res.headers.get('X-Inpaint-Duration-Ms')) || 0;
  const cleanedBlob = await res.blob();

  return {
    cleanedBlob,
    engine,
    durationMs,
  };
}

/**
 * Smart erase: detect text inside a user-selected region and erase only text pixels.
 * Uses backend /api/v1/erase-text-in-region (LaMa/OpenCV + contour-preserving mask).
 */
export async function eraseTextInRegion(
  imageBlob: Blob,
  options: {
    regions: [number, number, number, number][]; // list of [x, y, w, h]
    dilation?: number;
    engine?:
      | 'auto'
      | 'flat'
      | 'texture'
      | 'flatten'
      | 'lama'
      | 'opencv_telea'
      | 'opencv_ns';
    outputFormat?: 'png' | 'webp' | 'jpeg';
    baseUrl?: string;
  }
): Promise<{
  cleanedBlob: Blob;
  engine: string;
  textBoxes: number;
  maskCoverage: number;
  elapsedMs: number;
  status: string;
}> {
  const baseUrl = options.baseUrl || getBackendUrl();
  const formData = new FormData();
  const filename = (imageBlob as File).name || 'comic_page.png';
  formData.append('file', imageBlob, filename);
  formData.append('regions', JSON.stringify(options.regions));
  // Default to lossless PNG so the cleaned artwork keeps every pixel.  Clients
  // can explicitly request 'webp' (lossless) or 'jpeg' (q98, lossy) to save
  // bandwidth when quality is less critical.
  formData.append('output_format', options.outputFormat || 'png');
  if (options.dilation !== undefined) {
    formData.append('dilation', options.dilation.toString());
  }
  if (options.engine) {
    formData.append('engine', options.engine);
  }

  const res = await fetch(`${baseUrl}/api/v1/erase-text-in-region`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) {
        errorDetail = errJson.error.message;
      } else if (errJson?.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // ignore
    }
    throw new Error(`Smart erase failed: ${errorDetail}`);
  }

  const cleanedBlob = await res.blob();
  return {
    cleanedBlob,
    engine: res.headers.get('X-SmartErase-Engine') || options.engine || 'auto',
    textBoxes: Number(res.headers.get('X-SmartErase-Text-Boxes') || 0),
    maskCoverage: Number(res.headers.get('X-SmartErase-Mask-Coverage') || 0),
    elapsedMs: Number(res.headers.get('X-SmartErase-Elapsed-Ms') || 0),
    status: res.headers.get('X-SmartErase-Status') || 'ok',
  };
}
export async function generateMask(
  width: number,
  height: number,
  regions: InpaintRegionInput[],
  dilation: number = 2,
  baseUrl?: string
): Promise<Blob> {
  const targetUrl = `${baseUrl || getBackendUrl()}/api/v1/mask/generate`;
  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      width,
      height,
      regions,
      dilation,
    }),
  });

  if (!res.ok) {
    throw new Error(`Mask generation failed: HTTP ${res.status}`);
  }

  return res.blob();
}
