/**
 * Self-check for the Jellyfin client and the library matching it feeds,
 * against a fake Jellyfin server. Run with:
 *   npx ts-node -r tsconfig-paths/register --project server/tsconfig.json server/scripts/checkJellyfinApi.ts
 */
import type PlexAPI from '@server/api/plexapi';
import assert from 'assert';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

// Keep settings/log writes out of the real config directory
process.env.CONFIG_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'agregarr-jellyfin-check-')
);
fs.mkdirSync(path.join(process.env.CONFIG_DIRECTORY, 'logs'));

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
  headers: http.IncomingHttpHeaders;
}

const collectionItems = new Set(['a', 'b']);
const calls: Call[] = [];

const routes: Partial<Record<string, (call: Call) => unknown>> = {
  'GET /Library/VirtualFolders': () => [
    { Name: 'Movies', ItemId: 'lib-movies', CollectionType: 'movies' },
    { Name: 'Shows', ItemId: 'lib-tv', CollectionType: 'tvshows' },
    { Name: 'Music', ItemId: 'lib-music', CollectionType: 'music' },
  ],
  'GET /Items': ({ query }) => {
    if (query.get('SearchTerm') === 'matrix') {
      return {
        Items: [
          {
            Id: 'jf-matrix',
            Name: 'The Matrix',
            Type: 'Movie',
            ImageTags: { Primary: 'p1' },
          },
        ],
        TotalRecordCount: 1,
      };
    }
    if (query.get('ParentId') === 'col-1') {
      return {
        Items: [...collectionItems].map((Id) => ({ Id, Name: Id })),
        TotalRecordCount: collectionItems.size,
      };
    }
    if (query.get('ParentId') === 'lib-movies') {
      return {
        Items: [
          {
            Id: 'jf-matrix',
            Name: 'The Matrix',
            Type: 'Movie',
            ProductionYear: 1999,
            DateCreated: '2024-01-02T00:00:00.0000000Z',
            PremiereDate: '1999-03-31T00:00:00.0000000Z',
            ProviderIds: { Tmdb: '603', Imdb: 'tt0133093', Custom: 'x' },
          },
        ],
        TotalRecordCount: 1,
      };
    }
    if (query.get('ParentId') === 'show-1') {
      return {
        Items: [
          {
            Id: 'season-1',
            Name: 'Season 1',
            Type: 'Season',
            IndexNumber: 1,
            SeriesId: 'show-1',
          },
        ],
        TotalRecordCount: 1,
      };
    }
    return { Items: [], TotalRecordCount: 0 };
  },
  'GET /Items/Filters': () => ({ Tags: ['Overlay'] }),
  'GET /Items/jf-matrix/Images/Primary': () => 'image-bytes',
  'DELETE /Items/col-2': () => '',
  'GET /Items/col-1': () => ({
    Id: 'col-1',
    Name: 'Old Name',
    Type: 'BoxSet',
    Tags: ['keep'],
    Overview: 'existing',
  }),
  'POST /Items/col-1': () => '',
  'POST /Collections/col-1/Items': ({ query }) => {
    query
      .get('Ids')
      ?.split(',')
      .forEach((id) => collectionItems.add(id));
    return '';
  },
  'DELETE /Collections/col-1/Items': ({ query }) => {
    query
      .get('Ids')
      ?.split(',')
      .forEach((id) => collectionItems.delete(id));
    return '';
  },
  'POST /Items/col-1/Images/Primary': () => '',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const call: Call = {
      method: req.method ?? '',
      path: url.pathname,
      query: url.searchParams,
      body,
      headers: req.headers,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    res.statusCode = handler ? 200 : 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(handler ? handler(call) : { error: 'not found' }));
  });
});

const main = async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  const { default: JellyfinAPI } = await import('@server/api/jellyfin');
  const { findPlexItemsByTmdbIds, prefetchAllLibraryItems } = await import(
    '@server/lib/collections/core/CollectionUtilities'
  );

  const jellyfin = new JellyfinAPI({
    url: `http://localhost:${port}/`,
    apiKey: 'secret',
  });

  // Libraries: only movie/tv libraries, Plex-shaped
  assert.deepStrictEqual(await jellyfin.getLibraries(), [
    { key: 'lib-movies', title: 'Movies', type: 'movie', agent: 'jellyfin' },
    { key: 'lib-tv', title: 'Shows', type: 'show', agent: 'jellyfin' },
  ]);
  assert.match(
    String(calls[0].headers.authorization),
    /^MediaBrowser .*Token="secret"$/
  );

  // Library items carry Plex-style provider guids
  const { items } = await jellyfin.getLibraryContents('lib-movies');
  assert.deepStrictEqual(items[0].Guid, [
    { id: 'tmdb://603' },
    { id: 'imdb://tt0133093' },
  ]);
  assert.strictEqual(items[0].addedAt, 1704153600);
  assert.strictEqual(items[0].originallyAvailableAt, '1999-03-31');

  // The shared cache + TMDB matcher find Jellyfin items
  const client = jellyfin as unknown as PlexAPI;
  const cache = await prefetchAllLibraryItems(client);
  const matches = await findPlexItemsByTmdbIds(
    client,
    [
      { tmdbId: 603, mediaType: 'movie', title: 'The Matrix' },
      { tmdbId: 604, mediaType: 'movie', title: 'Missing' },
    ],
    'lib-movies',
    cache
  );
  assert.strictEqual(matches.get('603-movie')?.ratingKey, 'jf-matrix');
  assert.strictEqual(matches.has('604-movie'), false);

  // Collection contents are diffed: add c, remove a
  const result = await jellyfin.updateCollectionContents('col-1', [
    { ratingKey: 'b' },
    { ratingKey: 'c' },
  ]);
  assert.deepStrictEqual(
    { added: result.added, removed: result.removed, keys: result.removedKeys },
    { added: 1, removed: 1, keys: ['a'] }
  );
  assert.deepStrictEqual([...collectionItems].sort(), ['b', 'c']);

  // Labels become tags, merged into the full item, data locked
  await jellyfin.addLabelToCollection('col-1', 'AgregarrTrakt10001');
  const update = calls.filter((c) => c.method === 'POST').pop() as Call;
  assert.strictEqual(update.path, '/Items/col-1');
  const posted = JSON.parse(update.body);
  assert.deepStrictEqual(posted.Tags, ['keep', 'AgregarrTrakt10001']);
  assert.strictEqual(posted.Overview, 'existing');
  assert.strictEqual(posted.LockData, true);

  // Posters are uploaded base64-encoded with the image content type
  const poster = path.join(process.env.CONFIG_DIRECTORY ?? '', 'poster.png');
  fs.writeFileSync(poster, Buffer.from([1, 2, 3]));
  await jellyfin.updateCollectionPoster('col-1', poster);
  const upload = calls[calls.length - 1];
  assert.strictEqual(upload.path, '/Items/col-1/Images/Primary');
  assert.strictEqual(upload.headers['content-type'], 'image/png');
  assert.strictEqual(upload.body, 'AQID');

  // Poster change detection understands Jellyfin image URLs
  const { posterUrlsMatch } = await import('@server/utils/posterUrlHelpers');
  assert.ok(
    posterUrlsMatch(
      '/Items/col-1/Images/Primary?tag=abc',
      '/Items/col-1/Images/Primary?tag=abc'
    )
  );
  assert.ok(
    !posterUrlsMatch(
      '/Items/col-1/Images/Primary?tag=abc',
      '/Items/col-1/Images/Primary?tag=def'
    )
  );

  // Collection items and show children come back Plex-shaped
  const collectionMetadata = await jellyfin.getCollectionItemsWithMetadata(
    'col-1'
  );
  assert.deepStrictEqual(
    collectionMetadata.map((item) => item.ratingKey).sort(),
    ['b', 'c']
  );
  const [season] = await jellyfin.getChildrenMetadata('show-1');
  assert.deepStrictEqual(
    { type: season.type, index: season.index, parent: season.parentRatingKey },
    { type: 'season', index: 1, parent: 'show-1' }
  );

  // Smart collection deletes are plain BoxSet deletes
  await jellyfin.deleteSmartCollection('col-2');
  assert.strictEqual(calls[calls.length - 1].method, 'DELETE');

  // Item labels are Jellyfin tags
  assert.deepStrictEqual(await jellyfin.getLibraryLabels('lib-movies'), [
    'Overlay',
  ]);

  // Search returns library items with a proxiable poster path
  const [hit] = await jellyfin.searchLibrary('lib-movies', 'matrix', 5);
  assert.strictEqual(hit.thumb, '/Items/jf-matrix/Images/Primary?tag=p1');

  // Images are fetched only from image endpoints
  const image = await jellyfin.getImage(hit.thumb ?? '');
  assert.ok(image.data.length > 0);
  await assert.rejects(
    jellyfin.getImage('/Items/x/Images/../../System/Configuration'),
    /Not a Jellyfin image path/
  );

  // Missing collections resolve to null instead of throwing
  assert.strictEqual(await jellyfin.getCollectionMetadata('gone'), null);

  server.close();
  // eslint-disable-next-line no-console
  console.log('Jellyfin API checks passed');
  process.exit(0);
};

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
