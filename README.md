# async-task-kit

A small, zero-dependency toolkit for controlling asynchronous work in JavaScript.
Useful in backend services, CLI tools, scripts, scrapers and front-end apps where you
need concurrency control, retries, rate limiting, timeouts or caching — without
pulling in a dependency.

Works in Node.js >= 18 and modern browsers (ES modules).

## Why

Most projects re-implement the same handful of async patterns: limit parallel
requests, retry a flaky call with backoff, keep under an API quota, time out a
hanging promise, and de-duplicate in-flight loads. This library packages those
patterns into single-purpose, composable functions with TypeScript types and a
full test suite.

## Install

```bash
npm install async-task-kit
```

Or just copy `src/index.js` — it has no dependencies.

## API

### `sleep(ms)`

Resolve after `ms` milliseconds.

### `pLimit(concurrency)`

Returns a function that runs at most `concurrency` async functions at once.

```js
import { pLimit } from 'async-task-kit';

const limit = pLimit(3);
const results = await Promise.all(
  urls.map((url) => limit(() => fetch(url)))
);

limit.activeCount;   // currently running
limit.pendingCount;  // waiting in queue
limit.clear();       // reject all queued tasks
```

### `retry(fn, options)`

Retry `fn` with exponential backoff. `fn` receives a zero-based attempt number.

| Option | Default | Meaning |
| --- | --- | --- |
| `retries` | `3` | Retries after the first attempt |
| `factor` | `2` | Backoff growth factor |
| `minTimeout` | `1000` | Initial delay (ms) |
| `maxTimeout` | `Infinity` | Cap for a single delay |
| `randomize` | `false` | Full jitter to avoid thundering herd |
| `shouldRetry` | `() => true` | `(error, attempt) => boolean` |
| `onRetry` | – | `(error, attempt, delay) => void` |

```js
const data = await retry(
  (attempt) => fetchJson(url),
  { retries: 5, minTimeout: 500, randomize: true }
);
```

### `pMap(items, mapper, options)`

Map with bounded concurrency and optional per-item retry. **Results keep input order.**

```js
const rows = await pMap(ids, (id) => fetchUser(id), {
  concurrency: 4,
  retries: 2,
  retryOptions: { minTimeout: 200 },
});
```

### `withTimeout(promise, ms, message?)`

Reject with an `Error` if `promise` does not settle within `ms`.

```js
const html = await withTimeout(fetch(url).then((r) => r.text()), 5000);
```

### `createRateLimiter({ limit, windowMs })`

Sliding-window limiter: at most `limit` calls per `windowMs`. Excess calls are queued.

```js
const callApi = createRateLimiter({ limit: 5, windowMs: 1000 });
await Promise.all(items.map((x) => callApi(() => api.put(x))));
```

### `memoize(fn, options)`

Cache async results with a TTL and de-duplicate concurrent calls sharing a key.
Rejected entries are evicted so a later call can retry.

| Option | Default | Meaning |
| --- | --- | --- |
| `ttl` | `0` | Lifetime in ms; `0` means never expire |
| `key` | `JSON.stringify(args)` | Build the cache key |
| `cache` | `new Map()` | Custom cache (`Map`-compatible) |

```js
const getUser = memoize((id) => db.query(id), { ttl: 30_000 });
await Promise.all([getUser(1), getUser(1)]); // only one query
getUser.cache.clear();
```

## Testing

```bash
npm test        # 18 tests via node:test, no test framework dependency
npm run example # runnable usage examples
```

## License

MIT
