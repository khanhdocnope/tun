export type ReaderMode = 'studio' | 'vertical_reader' | 'page_reader';

export type ReadingDirection = 'ltr' | 'rtl' | 'vertical';

export type SpreadMode = 'single' | 'double';

export interface ReaderSettings {
  mode: ReaderMode;
  direction: ReadingDirection;
  spread: SpreadMode;
  fitToWidth: boolean;
}
