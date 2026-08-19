export type AMapMarker = {
  on(event: "click", handler: () => void): void;
};

export type AMapMap = {
  add(overlays: AMapMarker[]): void;
  setFitView(overlays?: AMapMarker[], immediately?: boolean, avoid?: number[]): void;
  destroy(): void;
};

export type AMapNamespace = {
  Map: new (container: HTMLElement, options: { zoom: number; center: [number, number]; resizeEnable: boolean; viewMode: "2D" }) => AMapMap;
  Marker: new (options: { position: [number, number]; title: string; content: string; anchor: "bottom-center" }) => AMapMarker;
};

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

let amapPromise: Promise<AMapNamespace> | null = null;

export function loadAMap(apiKey: string, securityCode: string) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapPromise) return amapPromise;

  amapPromise = new Promise<AMapNamespace>((resolve, reject) => {
    window._AMapSecurityConfig = { securityJsCode: securityCode };
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error("AMap loaded without its map API"));
    script.onerror = () => reject(new Error("Unable to load AMap"));
    document.head.appendChild(script);
  });

  return amapPromise;
}
