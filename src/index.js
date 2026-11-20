/**
 * async-task-kit
 * Zero-dependency asynchronous control utilities for JavaScript.
 *
 * All functions are framework-agnostic and work in Node.js >= 18 and modern browsers.
 */

/** Resolve after `ms` milliseconds. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Limit the number of concurrently running async functions.
 *
 * @param {number} concurrency - Maximum number of functions running at once.
 * @returns {Function & {activeCount: number, pendingCount: number, clear: () => void}}
 */
export function pLimit(concurrency) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('concurrency must be a positive integer');
  }

  const queue = [];
  let active = 0;

  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      const task = queue.shift();
      active += 1;
      Promise.resolve()
        .then(() => task.fn(...task.args))
        .then(task.resolve, task.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  const limiter = (fn, ...args) =>
    new Promise((resolve, reject) => {
      if (typeof fn !== 'function') {
        reject(new TypeError('pLimit expects a function'));
        return;
      }
      queue.push({ fn, args, resolve, reject });
      drain();
    });

  Object.defineProperties(limiter, {
    activeCount: { get: () => active, enumerable: true },
    pendingCount: { get: () => queue.length, enumerable: true },
    clear: {
      value: () => {
        for (const task of queue.splice(0)) {
          task.reject(new Error('pLimit queue cleared'));
        }
      },
      enumerable: true,
    },
  });

  return limiter;
}

/**
 * Retry an async function with exponential backoff and optional jitter.
 *
 * @param {(attempt: number) => any} fn - Called with a zero-based attempt number.
 * @param {object} [options]
 * @param {number} [options.retries=3] - Number of retries after the first attempt.
 * @param {number} [options.factor=2] - Exponential growth factor.
 * @param {number} [options.minTimeout=1000] - Initial delay in milliseconds.
 * @param {number} [options.maxTimeout=Infinity] - Upper bound for a single delay.
 * @param {boolean} [options.randomize=false] - Apply full jitter (0..delay).
 * @param {Function} [options.shouldRetry] - (error, attempt) => boolean | Promise<boolean>.
 * @param {Function} [options.onRetry] - (error, attempt, delay) => void | Promise<void>.
 */
export async function retry(fn, options = {}) {
  const {
    retries = 3,
    factor = 2,
    minTimeout = 1000,
    maxTimeout = Infinity,
    randomize = false,
    shouldRetry = () => true,
    onRetry,
  } = options;

  if (typeof fn !== 'function') throw new TypeError('retry expects a function');

  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !(await shouldRetry(error, attempt))) throw error;

      const raw = Math.min(minTimeout * Math.pow(factor, attempt), maxTimeout);
      const delay = randomize ? Math.floor(Math.random() * raw) : raw;

      if (onRetry) await onRetry(error, attempt, delay);
      await sleep(delay);
      attempt += 1;
    }
  }
}

/**
 * Map over items with bounded concurrency and optional per-item retry.
 * Results preserve the input order.
 */
export function pMap(items, mapper, options = {}) {
  const { concurrency = Infinity, retries = 0, retryOptions = {} } = options;
  if (typeof mapper !== 'function') throw new TypeError('pMap expects a mapper function');

  const useLimit = Number.isFinite(concurrency) && concurrency > 0;
  const limit = useLimit ? pLimit(Math.floor(concurrency)) : (fn) => fn();

  return Promise.all(
    Array.from(items, (item, index) =>
      limit(() =>
        retries > 0
          ? retry(() => mapper(item, index), { retries, ...retryOptions })
          : mapper(item, index)
      )
    )
  );
}

/**
 * Reject if a promise does not settle within `ms` milliseconds.
 */
export function withTimeout(promise, ms, message = `Operation timed out after ${ms}ms`) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Sliding-window rate limiter: at most `limit` calls per `windowMs`.
 * Calls beyond the budget are queued and released as the window slides.
 */
export function createRateLimiter({ limit = 1, windowMs = 1000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('limit must be a positive integer');
  }
  if (!Number.isFinite(windowMs) || windowMs < 1) {
    throw new TypeError('windowMs must be a positive number');
  }

  const startedAt = [];
  const queue = [];
  let timer = null;

  const flush = () => {
    const now = Date.now();
    while (startedAt.length > 0 && now - startedAt[0] >= windowMs) startedAt.shift();

    while (queue.length > 0 && startedAt.length < limit) {
      startedAt.push(Date.now());
      const task = queue.shift();
      Promise.resolve()
        .then(() => task.fn())
        .then(task.resolve, task.reject);
    }

    if (queue.length > 0) {
      const wait = Math.max(1, windowMs - (Date.now() - startedAt[0]));
      clearTimeout(timer);
      timer = setTimeout(flush, wait);
    }
  };

  const rateLimited = (fn, ...args) =>
    new Promise((resolve, reject) => {
      if (typeof fn !== 'function') {
        reject(new TypeError('rate limiter expects a function'));
        return;
      }
      queue.push({ fn: () => fn(...args), resolve, reject });
      flush();
    });

  Object.defineProperties(rateLimited, {
    pendingCount: { get: () => queue.length, enumerable: true },
    clear: {
      value: () => {
        for (const task of queue.splice(0)) {
          task.reject(new Error('Rate limiter queue cleared'));
        }
        clearTimeout(timer);
        timer = null;
      },
      enumerable: true,
    },
  });

  return rateLimited;
}

/**
 * Memoize an async function with TTL and in-flight deduplication.
 * Concurrent calls with the same key share one promise.
 * A rejected result is evicted so the next call can retry.
 */
export function memoize(fn, options = {}) {
  const { ttl = 0, key = (...args) => JSON.stringify(args), cache = new Map() } = options;
  if (typeof fn !== 'function') throw new TypeError('memoize expects a function');

  const wrapped = (...args) => {
    const cacheKey = key(...args);
    const hit = cache.get(cacheKey);
    if (hit && (ttl === 0 || Date.now() - hit.at < ttl)) return hit.value;

    const value = Promise.resolve().then(() => fn(...args));
    cache.set(cacheKey, { value, at: Date.now() });
    value.catch(() => {
      const current = cache.get(cacheKey);
      if (current && current.value === value) cache.delete(cacheKey);
    });
    return value;
  };

  Object.defineProperties(wrapped, {
    cache: { value: cache, enumerable: true },
    clear: { value: () => cache.clear(), enumerable: true },
  });

  return wrapped;
}

export default {
  sleep,
  pLimit,
  retry,
  pMap,
  withTimeout,
  createRateLimiter,
  memoize,
};
