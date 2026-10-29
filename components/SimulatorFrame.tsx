"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fidelity-first compatibility layer.
 * The supplied Canvas/WebGL engine remains unchanged in public/ so the math,
 * click handlers, drag physics, and appearance are not accidentally rewritten.
 * Its iframe is SAME-ORIGIN and receives its natural document height.
 */
export default function SimulatorFrame() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1600);

  const syncHeight = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        setHeight(Math.max(600, doc.body.scrollHeight, doc.documentElement.scrollHeight));
      }
    } catch { /* Ignore transient or cross-origin transitions. */ }
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.kind !== "vernier-legacy-height") return;
      if (typeof event.data.height !== "number" || !Number.isFinite(event.data.height)) return;
      setHeight(Math.min(50000, Math.max(600, Math.ceil(event.data.height))));
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src="/tools/vernier-caliper/simulator.html"
      title="Vernier Caliper 2D and 3D simulator"
      width="100%"
      height={height}
      onLoad={syncHeight}
      allowFullScreen
      style={{ display: "block", width: "100%", height, border: 0, overflow: "hidden" }}
    />
  );
}
