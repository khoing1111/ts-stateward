export class Connection implements Disposable {
  query(): void {}
  on(event: string): this {
    void event;
    return this;
  }
  [Symbol.dispose](): void {}
}

export function open(): Connection {
  return new Connection();
}
