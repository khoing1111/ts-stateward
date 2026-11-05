import { useEffect, useRef, useState } from "react";
import { stopTimer } from "./timers.js";

export function Stopwatch() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setInterval(() => setSeconds((current) => current + 1), 1000);
  }, []);
  return <p>{seconds}</p>;
}

export function StopwatchFixed() {
  const [seconds, setSeconds] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    timer.current = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer.current);
  }, []);
  return <p>{seconds}</p>;
}

export function Toast({ text }: { text: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setTimeout(() => setVisible(false), 3000);
  }, [text]);
  return visible ? <p>{text}</p> : null;
}

export function ToastFixed({ text }: { text: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(id);
  }, [text]);
  return visible ? <p>{text}</p> : null;
}

/** Runs once and sets no state: nothing to clean up. */
export function Greeting() {
  useEffect(() => {
    setTimeout(() => console.log("hello"), 500);
  }, []);
  return <p>hello</p>;
}

export function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(count + 1);
  }, [count]);
  return <p>{count}</p>;
}

export function RenderCounter() {
  const [renders, setRenders] = useState(0);
  useEffect(() => {
    setRenders((current) => current + 1);
  });
  return <p>{renders}</p>;
}

/** Guarded: once `count` is back under `max`, the effect stops setting it. */
export function CounterFixed({ max }: { max: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count > max) setCount(count - 1);
  }, [count, max]);
  return <p>{count}</p>;
}

/** The cleanup hands the id to a function in another module: stateward cannot see what it does. */
export function Clock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => stopTimer(id);
  }, []);
  return <p>{now}</p>;
}
