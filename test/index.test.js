import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sleep,
  pLimit,
  retry,
  pMap,
  withTimeout,
  createRateLimiter,
  memoize,
} from '../src/index.js';

test('sleep resolves after the given delay', async () => {
  const start = Date.now();
  await sleep(20);
  assert.ok(Date.now() - start >= 15, 'should wait at least ~20ms');
});

test('pLimit caps concurrent executions', async () => {
  const limit = pLimit(2);
  let active = 0;
  let peak = 0;

  const tasks = Array.from({ length: 6 }, () =>
    limit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(10);
      active -= 1;
      return 1;
    })
  );

  const results = await Promise.all(tasks);
  assert.equal(peak, 2, 'never more than 2 at once');
  assert.equal(results.length, 6);
  assert.equal(limit.activeCount, 0);
  assert.equal(limit.pendingCount, 0);
});

test('pLimit tracks pending count', async () => {
  const limit = pLimit(1);
  const release = [];
  const first = limit(() => new Promise((r) => release.push(r)));
  const second = limit(() => 2);
  await Promise.resolve();
  assert.equal(limit.activeCount, 1);
  assert.equal(limit.pendingCount, 1);
  release[0]();
  assert.equal(await first, undefined);
  assert.equal(await second, 2);
});

test('pLimit clear rejects queued tasks', async () => {
  const limit = pLimit(1);
  const first = limit(() => sleep(30));
  const second = limit(() => 2);
  limit.clear();
  await assert.rejects(second, /queue cleared/);
  await first;
});

test('retry returns on a later success', async () => {
  let calls = 0;
  const value = await retry(
    () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    },
    { retries: 5, minTimeout: 1, factor: 1 }
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('retry throws after exhausting attempts', async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      () => {
        calls += 1;
        throw new Error('always fails');
      },
      { retries: 2, minTimeout: 1 }
    ),
    /always fails/
  );
  assert.equal(calls, 3, 'first attempt + 2 retries');
});

test('retry respects shouldRetry and fires onRetry', async () => {
  const seen = [];
  await assert.rejects(
    retry(
      async () => {
        throw new Error('fatal');
      },
      {
        retries: 10,
        minTimeout: 1,
        shouldRetry: (error) => error.message !== 'fatal',
        onRetry: (error, attempt, delay) => seen.push([attempt, delay]),
      }
    ),
    /fatal/
  );
  assert.equal(seen.length, 0, 'onRetry not called when shouldRetry is false');
});

test('retry applies exponential backoff and maxTimeout', async () => {
  const delays = [];
  await assert.rejects(
    retry(
      () => {
        throw new Error('x');
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 100,
        maxTimeout: 150,
        onRetry: (_e, _a, delay) => delays.push(delay),
      }
    )
  );
  assert.deepEqual(delays, [100, 150, 150]);
});

test('pMap preserves order and bounds concurrency', async () => {
  let active = 0;
  let peak = 0;
  const result = await pMap(
    [10, 5, 1, 8],
    async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(n);
      active -= 1;
      return n * 2;
    },
    { concurrency: 2 }
  );
  assert.deepEqual(result, [20, 10, 2, 16]);
  assert.equal(peak, 2);
});

test('pMap retries individual items', async () => {
  const attempts = new Map();
  const result = await pMap(
    [1, 2, 3],
    async (n) => {
      attempts.set(n, (attempts.get(n) ?? 0) + 1);
      if (n === 2 && attempts.get(n) < 2) throw new Error('flaky');
      return n;
    },
    { concurrency: 3, retries: 2, retryOptions: { minTimeout: 1 } }
  );
  assert.deepEqual(result, [1, 2, 3]);
  assert.equal(attempts.get(2), 2);
});

test('withTimeout rejects on slow promises', async () => {
  await assert.rejects(
    withTimeout(sleep(100), 10, 'too slow'),
    /too slow/
  );
});

test('withTimeout passes through fast results and errors', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 100), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 100), /boom/);
});

test('createRateLimiter enforces sliding window budget', async () => {
  const limit = createRateLimiter({ limit: 2, windowMs: 60 });
  const stamps = [];
  const tasks = Array.from({ length: 4 }, (_, i) => limit(() => {
    stamps.push(Date.now());
    return i;
  }));
  const result = await Promise.all(tasks);
  assert.deepEqual(result, [0, 1, 2, 3]);
  assert.ok(stamps[2] - stamps[0] >= 50, 'third call waits for the window to slide');
});

test('createRateLimiter rejects invalid config', () => {
  assert.throws(() => createRateLimiter({ limit: 0 }), /positive integer/);
  assert.throws(() => createRateLimiter({ windowMs: 0 }), /positive number/);
});

test('memoize deduplicates concurrent calls', async () => {
  let calls = 0;
  const load = memoize(async (id) => {
    calls += 1;
    await sleep(10);
    return `user-${id}`;
  });
  const [a, b] = await Promise.all([load(1), load(1)]);
  assert.equal(a, 'user-1');
  assert.equal(b, 'user-1');
  assert.equal(calls, 1, 'in-flight promise shared');
  assert.equal(await load(1), 'user-1');
  assert.equal(calls, 1, 'cached result reused');
});

test('memoize expires stale entries with ttl', async () => {
  let calls = 0;
  const load = memoize(async () => ++calls, { ttl: 15 });
  assert.equal(await load(), 1);
  await sleep(25);
  assert.equal(await load(), 2);
});

test('memoize evicts rejected entries so they can retry', async () => {
  let calls = 0;
  const load = memoize(async () => {
    calls += 1;
    if (calls === 1) throw new Error('fail once');
    return 'ok';
  });
  await assert.rejects(load(), /fail once/);
  assert.equal(await load(), 'ok');
  assert.equal(calls, 2);
});

test('memoize supports a custom key function', async () => {
  let calls = 0;
  const load = memoize(async (user) => {
    calls += 1;
    return user.id;
  }, { key: (user) => user.id });
  assert.equal(await load({ id: 'a', name: 'A' }), 'a');
  assert.equal(await load({ id: 'a', name: 'B' }), 'a');
  assert.equal(calls, 1);
});
