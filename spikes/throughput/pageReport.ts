import type { AdapterReport } from '../scene/benchApp';

export interface PageReport {
  readonly adapter: AdapterReport;
  readonly userAgent: string;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio: number;
  readonly visibility: DocumentVisibilityState;
  readonly crossOriginIsolated: boolean;
}

/** Conditions the page can see, recorded with every benchmark (D0-1). */
export function pageReport(adapter: AdapterReport): PageReport {
  return {
    adapter,
    userAgent: navigator.userAgent,
    innerWidth,
    innerHeight,
    devicePixelRatio,
    visibility: document.visibilityState,
    crossOriginIsolated,
  };
}
