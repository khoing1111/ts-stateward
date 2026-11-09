export type Pending<T, Running extends T = Extract<T, true>> = T & {
  readonly "__guarantee:pending"?: Running;
};
