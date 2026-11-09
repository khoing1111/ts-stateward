// The parts of RxJS 7's types the fixture uses, declared as RxJS declares them.
export declare class Subscription {
  unsubscribe(): void;
}
export declare class Observable<T> {
  subscribe(next?: (value: T) => void): Subscription;
}
export declare function interval(period: number): Observable<number>;
