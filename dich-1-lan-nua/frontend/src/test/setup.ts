import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// Polyfill Blob.prototype.arrayBuffer if missing in jsdom
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
      reader.readAsArrayBuffer(this);
    });
  };
}

// Polyfill URL.createObjectURL and URL.revokeObjectURL for jsdom environment
if (typeof window !== 'undefined') {
  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = (blob: Blob) => `blob:mock-uuid-${blob.size}-${Math.random()}`;
  }
  if (!window.URL.revokeObjectURL) {
    window.URL.revokeObjectURL = () => {};
  }
}

// Polyfill createImageBitmap for jsdom if needed
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async (image: any) => {
    return {
      width: image?.width || 800,
      height: image?.height || 1200,
      close: () => {},
    } as ImageBitmap;
  };
}

// Polyfill ResizeObserver for jsdom environment
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof window !== 'undefined' && !(window as any).ResizeObserver) {
  (window as any).ResizeObserver = globalThis.ResizeObserver;
}

if (typeof Element !== 'undefined') {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
}

// Polyfill PointerEvent for jsdom
if (typeof window !== 'undefined' && !(window as any).PointerEvent) {
  (window as any).PointerEvent = class PointerEvent extends window.MouseEvent {
    readonly pointerId: number;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;
    readonly pointerType: string;

    constructor(type: string, params: any = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  };
}
