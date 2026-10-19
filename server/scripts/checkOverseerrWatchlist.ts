/**
 * Self-check that getUserWatchlist reads every page of a user's watchlist,
 * against a fake Overseerr server. Run with:
 *   npx ts-node -r tsconfig-paths/register --project server/tsconfig.json server/scripts/checkOverseerrWatchlist.ts
 */
import assert from 'assert';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

// Keep log writes out of the real config directory
process.env.CONFIG_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'agregarr-overseerr-check-')
);
fs.mkdirSync(path.join(process.env.CONFIG_DIRECTORY, 'logs'));

// 45 items paged at 20, like Overseerr's /user/:id/watchlist
const items = Array.from({ length: 45 }, (_, i) => ({
  ratingKey: `rk-${i}`,
  title: `Title ${i}`,
  mediaType: i % 2 ? 'tv' : 'movie',
  tmdbId: i + 1,
}));
const requestedPages: number[] = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/v1/user/7/watchlist') {
    const page = Number(url.searchParams.get('page'));
    requestedPages.push(page);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        page,
        totalPages: Math.ceil(items.length / 20),
        totalResults: items.length,
        results: items.slice((page - 1) * 20, page * 20),
      })
    );
    return;
  }
  res.statusCode = 404;
  res.end();
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const { default: OverseerrAPI } = await import('@server/api/overseerr');
  const api = new OverseerrAPI({
    hostname: '127.0.0.1',
    port,
    useSsl: false,
    apiKey: 'test',
  });

  const { results, total } = await api.getUserWatchlist(7);
  assert.deepStrictEqual(requestedPages, [1, 2, 3]);
  assert.strictEqual(total, 45);
  assert.deepStrictEqual(
    results.map((r) => r.tmdbId),
    items.map((i) => i.tmdbId)
  );

  // Errors still yield an empty watchlist
  assert.deepStrictEqual(await api.getUserWatchlist(8), {
    results: [],
    total: 0,
  });

  server.close();
  // eslint-disable-next-line no-console
  console.log('Overseerr watchlist checks passed');
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
