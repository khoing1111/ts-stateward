import { useEffect, useRef, useState } from "react";

export function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    window.addEventListener("resize", () => setWidth(window.innerWidth));
  }, []);
  return width;
}

export function useWindowHeight() {
  const [height, setHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
  }, []);
  return height;
}

export function useWindowWidthFixed() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export function useEscape(onClose: () => void) {
  useEffect(() => {
    const controller = new AbortController();
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") onClose();
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [onClose]);
}

export function Panel() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize(entry?.contentRect.width ?? 0));
    if (ref.current !== null) observer.observe(ref.current);
  }, []);
  return <div ref={ref}>{size}</div>;
}

export function PanelFixed() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize(entry?.contentRect.width ?? 0));
    if (ref.current !== null) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref}>{size}</div>;
}

/** real-world corpus (mattermost's formatting bar): the observer is kept nullable and disconnected with `!`. */
export function PanelNullable() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    if (ref.current === null) return () => {};
    let observer: ResizeObserver | null = new ResizeObserver(([entry]) =>
      setSize(entry?.contentRect.width ?? 0),
    );
    observer.observe(ref.current);
    return () => {
      observer!.disconnect();
      observer = null;
    };
  }, []);
  return <div ref={ref}>{size}</div>;
}
