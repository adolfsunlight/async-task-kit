import {
  pLimit,
  retry,
  pMap,
  withTimeout,
  createRateLimiter,
  memoize,
} from '../src/index.js';

// 1. Fetch many URLs but never more than 3 at a time.
const fetchLimited = pLimit(3);
const pages = await Promise.all(
  [1, 2, 3, 4, 5].map((id) =>
    fetchLimited(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return `page ${id}`;
    })
  )
);
console.log('pLimit:', pages.join(', '));

// 2. Retry a flaky network call with exponential backoff + jitter.
let tries = 0;
const data = await retry(
  async () => {
    tries += 1;
    if (tries < 3) throw new Error('503');
    return { ok: true };
  },
  { retries: 5, minTimeout: 50, randomize: true }
);
console.log('retry:', data, 'attempts =', tries);

// 3. Map with bounded concurrency, preserving input order.
const doubled = await pMap([1, 2, 3, 4], async (n) => n * 2, { concurrency: 2 });
console.log('pMap:', doubled);

// 4. Don't let a hanging operation block forever.
const value = await withTimeout(
  new Promise((resolve) => setTimeout(() => resolve('done'), 10)),
  1000
);
console.log('withTimeout:', value);

// 5. Stay under an API quota: at most 2 calls per 100ms.
const callApi = createRateLimiter({ limit: 2, windowMs: 100 });
const answers = await Promise.all([1, 2, 3, 4].map((n) => callApi(async () => n * 10)));
console.log('createRateLimiter:', answers);

// 6. Cache a slow lookup; identical concurrent calls share one promise.
let lookups = 0;
const getUser = memoize(async (id) => {
  lookups += 1;
  await new Promise((r) => setTimeout(r, 10));
  return { id, name: `User ${id}` };
});
await Promise.all([getUser(7), getUser(7)]);
console.log('memoize: lookups =', lookups);
