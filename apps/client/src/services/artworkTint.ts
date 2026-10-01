import { useEffect, useState } from "react";

const cache = new Map<string, Promise<string | undefined>>();

function sampleArtwork(src: string): Promise<string | undefined> {
  const existing = cache.get(src);
  if (existing) return existing;
  const request = new Promise<string | undefined>((resolve) => {
    const image = new Image();
    const finish = (color?: string) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(color);
    };
    const timeout = setTimeout(() => finish(), 5000);
    image.crossOrigin = "anonymous";
    image.onerror = () => finish();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 24;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return finish();
        context.drawImage(image, 0, 0, 24, 24);
        const pixels = context.getImageData(0, 0, 24, 24).data;
        const hues = new Map<number, number>();
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i]! / 255;
          const g = pixels[i + 1]! / 255;
          const b = pixels[i + 2]! / 255;
          const high = Math.max(r, g, b);
          const low = Math.min(r, g, b);
          const delta = high - low;
          // Ignore transparent, neutral and near-black/white pixels.
          if (pixels[i + 3]! < 128 || delta < 0.08 || high < 0.15 || low > 0.9)
            continue;
          const hue =
            ((high === r
              ? (g - b) / delta
              : high === g
                ? (b - r) / delta + 2
                : (r - g) / delta + 4) *
              60 +
              360) %
            360;
          const bucket = Math.round(hue / 20) * 20;
          hues.set(bucket, (hues.get(bucket) ?? 0) + delta);
        }
        const dominant = [...hues].sort((a, b) => b[1] - a[1])[0];
        // Fixed saturation/lightness keeps every artwork tint quiet and readable.
        finish(dominant ? `hsl(${dominant[0]} 32% 45%)` : undefined);
      } catch {
        // Artwork without CORS permission still displays; the card stays neutral.
        finish();
      }
    };
    image.src = src;
  });
  if (cache.size >= 80) cache.delete(cache.keys().next().value!);
  cache.set(src, request);
  return request;
}

export function useArtworkTint(src?: string) {
  const [result, setResult] = useState<{ src: string; color?: string }>();
  useEffect(() => {
    if (!src) return;
    let active = true;
    void sampleArtwork(src).then((color) => {
      if (active) setResult({ src, color });
    });
    return () => {
      active = false;
    };
  }, [src]);
  return result?.src === src ? result?.color : undefined;
}
