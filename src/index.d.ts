export type Awaitable<T> = T | Promise<T>;

export declare function sleep(ms: number): Promise<void>;

export interface Limiter {
  <T>(fn: () => Awaitable<T>): Promise<T>;
  <T, A extends readonly unknown[]>(fn: (...args: A) => Awaitable<T>, ...args: A): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
  clear(): void;
}
export declare function pLimit(concurrency: number): Limiter;

export interface RetryOptions {
  retries?: number;
  factor?: number;
  minTimeout?: number;
  maxTimeout?: number;
  randomize?: boolean;
  shouldRetry?: (error: unknown, attempt: number) => Awaitable<boolean>;
  onRetry?: (error: unknown, attempt: number, delay: number) => Awaitable<void>;
}
export declare function retry<T>(
  fn: (attempt: number) => Awaitable<T>,
  options?: RetryOptions
): Promise<T>;

export interface MapOptions {
  concurrency?: number;
  retries?: number;
  retryOptions?: RetryOptions;
}
export declare function pMap<T, R>(
  items: Iterable<T>,
  mapper: (item: T, index: number) => Awaitable<R>,
  options?: MapOptions
): Promise<R[]>;

export declare function withTimeout<T>(
  promise: Awaitable<T>,
  ms: number,
  message?: string
): Promise<T>;

export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
}
export interface RateLimiter {
  <T>(fn: () => Awaitable<T>): Promise<T>;
  <T, A extends readonly unknown[]>(fn: (...args: A) => Awaitable<T>, ...args: A): Promise<T>;
  readonly pendingCount: number;
  clear(): void;
}
export declare function createRateLimiter(options?: RateLimiterOptions): RateLimiter;

export interface CacheEntry<T> {
  value: Promise<T>;
  at: number;
}
export interface MemoizeOptions<T> {
  /** Time to live in ms. 0 means never expire. */
  ttl?: number;
  key?: (...args: any[]) => string;
  cache?: Map<string, CacheEntry<T>>;
}
export interface Memoized<TArgs extends any[], TResult> {
  (...args: TArgs): Promise<TResult>;
  readonly cache: Map<string, CacheEntry<TResult>>;
  clear(): void;
}
export declare function memoize<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Awaitable<TResult>,
  options?: MemoizeOptions<TResult>
): Memoized<TArgs, TResult>;

declare const kit: {
  sleep: typeof sleep;
  pLimit: typeof pLimit;
  retry: typeof retry;
  pMap: typeof pMap;
  withTimeout: typeof withTimeout;
  createRateLimiter: typeof createRateLimiter;
  memoize: typeof memoize;
};
export default kit;
