// Twelve functions that all call each other and never throw: read once, not once per path.
export function s1(n: number): number {
  if (n > 0) {
    s2(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s2(n: number): number {
  if (n > 0) {
    s1(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s3(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s4(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s5(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s4(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s6(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s7(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s8(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s9(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s9(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s10(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s10(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s11(n - 1); s12(n - 1);
  }
  return n;
}

export function s11(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s12(n - 1);
  }
  return n;
}

export function s12(n: number): number {
  if (n > 0) {
    s1(n - 1); s2(n - 1); s3(n - 1); s4(n - 1); s5(n - 1); s6(n - 1); s7(n - 1); s8(n - 1); s9(n - 1); s10(n - 1); s11(n - 1);
  }
  return n;
}


async function run(): Promise<void> {
  s1(3);
}

export function Button() {
  return <button onClick={async () => { await run(); }}>go</button>;
}
