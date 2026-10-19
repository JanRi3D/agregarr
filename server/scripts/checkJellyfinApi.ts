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
let serverVersion = '10.10.7';
const calls: Call[] = [];

const routes: Partial<Record<string, (call: Call) => unknown>> = {
  'GET /Library/VirtualFolders': () => [
    { Name: 'Movies', ItemId: 'lib-movies', CollectionType: 'movies' },
    { Name: 'Shows', ItemId: 'lib-tv', CollectionType: 'tvshows' },
    { Name: 'Music', ItemId: 'lib-music', CollectionType: 'music' },
  ],
  'GET /Items': ({ query }) => {
    if (query.get('IncludeItemTypes') === 'Episode' && query.get('SortBy')) {
      return {
        Items: [
          { Id: 'e1', Name: 'New', SeriesId: 's1' },
          { Id: 'e2', Name: 'Older', SeriesId: 's1' },
          { Id: 'e3', Name: 'Oldest', SeriesId: 's2' },
          { Id: 'e4', Name: 'Trailer (Placeholder)', SeriesId: 's3' },
        ],
      };
    }
    if (query.get('Ids') === 's1,s2') {
      return {
        Items: [
          { Id: 's2', Name: 'Second', Type: 'Series' },
          { Id: 's1', Name: 'First', Type: 'Series' },
        ],
      };
    }
    if (query.get('SortBy') === 'DateCreated' && !query.get('Person')) {
      return {
        Items: [
          {
            Id: 'soon',
            Name: 'Soon',
            Type: 'Movie',
            Path: '/m/Soon {tmdb-9} {edition-Trailer}.mp4',
          },
          { Id: 'newest', Name: 'Newest', Type: 'Movie' },
          { Id: 'older', Name: 'Older', Type: 'Movie' },
        ],
      };
    }
    if (query.get('Ids')?.startsWith('ep1')) {
      return {
        Items: [
          { Id: 'ep1', Name: 'Pilot', Type: 'Episode', SeriesId: 'show-a' },
          { Id: 'ep2', Name: 'Two', Type: 'Episode', SeriesId: 'show-a' },
          { Id: 'ep3', Name: 'One', Type: 'Episode', SeriesId: 'show-b' },
        ],
      };
    }
    if (query.get('Ids')?.includes('show-a')) {
      return {
        Items: [
          {
            Id: 'show-a',
            Name: 'Show A',
            Type: 'Series',
            ProviderIds: { Tmdb: '11' },
          },
          { Id: 'show-b', Name: 'Show B', Type: 'Series' },
        ],
      };
    }
    if (query.get('Fields') === 'People,Path,Tags') {
      const directed = { Name: 'Lana Wachowski', Type: 'Director' };
      return {
        Items: [
          { Id: 'm1', Name: 'The Matrix', Type: 'Movie', People: [directed] },
          { Id: 'm2', Name: 'Speed Racer', Type: 'Movie', People: [directed] },
          {
            Id: 'm3',
            Name: 'Soon',
            Type: 'Movie',
            People: [directed],
            Path: '/m/Soon {tmdb-9} {edition-Trailer}.mp4',
          },
        ],
        TotalRecordCount: 3,
      };
    }
    if (query.get('Person') === 'Bryan Cranston') {
      return {
        Items: [
          { Id: 'bb', Name: 'Breaking Bad', Type: 'Series' },
          { Id: 'soon-show', Name: 'Soon Show', Type: 'Series' },
        ],
        TotalRecordCount: 2,
      };
    }
    if (query.get('NameStartsWith') === 'Trailer (Placeholder)') {
      return {
        Items: [
          {
            Id: 'ep',
            Name: 'Trailer (Placeholder)',
            Type: 'Episode',
            SeriesId: 'soon-show',
          },
        ],
        TotalRecordCount: 1,
      };
    }
    if (query.get('Ids') === 'movie-ph') {
      const played = query.get('userId') === 'u1';
      return {
        Items: [{ Id: 'movie-ph', UserData: { Played: played } }],
        TotalRecordCount: 1,
      };
    }
    if (query.get('SortBy') === 'DateLastContentAdded') {
      return {
        Items: [
          {
            Id: 'show-1',
            Name: 'Old Show',
            Type: 'Series',
            DateCreated: '2020-01-01T00:00:00Z',
            DateLastMediaAdded: new Date().toISOString(),
          },
          {
            Id: 'show-2',
            Name: 'Stale Show',
            Type: 'Series',
            DateCreated: '2020-01-01T00:00:00Z',
          },
        ],
        TotalRecordCount: 2,
      };
    }
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
    if (query.get('ParentId') === 'col-stats') {
      return {
        Items: [{ Id: 'show-a' }, { Id: 'movie-x' }],
        TotalRecordCount: 2,
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
    if (query.get('ParentId') === 'col-pre') {
      return { Items: [{ Id: 'jf-matrix', Name: 'The Matrix' }] };
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
  'GET /System/Info': () => ({ Version: serverVersion }),
  'GET /Items/show-1': () => ({ Id: 'show-1', Name: 'Show', Type: 'Series' }),
  'GET /Items/movie-ph': () => ({
    Id: 'movie-ph',
    Name: 'Soon',
    Type: 'Movie',
    Tags: ['keep'],
    LockData: false,
    Path: '/movies/Soon (2030) [tmdbid-9]/Soon (2030) [tmdbid-9] {tmdb-9} {edition-Trailer}.mp4',
  }),
  'POST /Items/movie-ph': () => '',
  'POST /Items/movie-ph/RemoteImages/Download': () => '',
  'POST /Items/lib-movies/Refresh': () => '',
  'GET /Users': () => [
    { Id: 'u1', Policy: { IsAdministrator: true } },
    { Id: 'u2' },
  ],
  'GET /Items/movie-4k': ({ query }) => ({
    Id: 'movie-4k',
    Name: 'Dune',
    Type: 'Movie',
    UserData:
      query.get('userId') === 'u1'
        ? { PlayCount: 2, LastPlayedDate: '2024-01-02T00:00:00Z' }
        : undefined,
    MediaSources: [
      {
        Path: '/movies/Dune.mkv',
        Container: 'mkv',
        Bitrate: 60000000,
        MediaStreams: [
          {
            Type: 'Video',
            Codec: 'hevc',
            Width: 3840,
            Height: 1608,
            BitDepth: 10,
            ColorTransfer: 'smpte2084',
            VideoRangeType: 'DOVIWithHDR10',
            DvProfile: 8,
          },
          { Type: 'Audio', Codec: 'dts', Channels: 8, Language: 'eng' },
        ],
      },
    ],
  }),
  'POST /Items/movie-4k/Images/Primary': () => '',
  'DELETE /UserPlayedItems/movie-ph': () => '',
  'POST /Users/u2/Policy': () => '',
  'POST /user_usage_stats/submit_custom_query': ({ body }) =>
    body.includes('ItemType, UserId')
      ? {
          // Dashboard query: ItemId, ItemType, UserId, plays, duration
          results: [
            ['ep1', 'Episode', 'u1', '2', '100'],
            ['ep3', 'Episode', 'u2', '1', '50'],
            ['movie-x', 'Movie', 'u1', '3', '30'],
            ['gone', 'Movie', 'u2', '4', '40'],
          ],
        }
      : {
          colums: ['ItemId', 'UserId', 'plays', 'duration', 'last'],
          results: [
            ['ep1', 'u1', '2', '100', '2026-10-01 10:00:00'],
            ['ep2', 'u2', '1', '50', '2026-10-02 10:00:00'],
            ['ep3', 'u1', '5', '10', '2026-10-03 10:00:00'],
            ['deleted-episode', 'u1', '9', '9', '2026-10-03 10:00:00'],
          ],
        },
  'GET /Items/col-stats': () => ({ Id: 'col-stats', Name: 'Stats' }),
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

  // Custom order: DisplayOrder "Default" keeps insertion order, so items
  // are re-added in the desired order
  await jellyfin.arrangeCollectionItemsInOrder('col-1', [
    { ratingKey: 'c' },
    { ratingKey: 'b' },
  ]);
  assert.deepStrictEqual([...collectionItems], ['c', 'b']);
  const displayOrder = calls.find(
    (c) => c.method === 'POST' && c.path === '/Items/col-1'
  ) as Call;
  assert.strictEqual(JSON.parse(displayOrder.body).DisplayOrder, 'Default');

  // ...but not on servers that ignore it, where it would churn every sync
  for (serverVersion of ['10.9.11', '10.11.2']) {
    const before = calls.length;
    await new JellyfinAPI({
      url: `http://localhost:${port}`,
      apiKey: 'secret',
    }).arrangeCollectionItemsInOrder('col-1', [
      { ratingKey: 'b' },
      { ratingKey: 'c' },
    ]);
    assert.deepStrictEqual(
      calls.slice(before).map((c) => c.path),
      ['/System/Info']
    );
  }

  // Labels become tags, merged into the full item
  await jellyfin.addLabelToCollection('col-1', 'AgregarrTrakt10001');
  const update = calls.filter((c) => c.method === 'POST').pop() as Call;
  assert.strictEqual(update.path, '/Items/col-1');
  const posted = JSON.parse(update.body);
  assert.deepStrictEqual(posted.Tags, ['keep', 'AgregarrTrakt10001']);
  assert.strictEqual(posted.Overview, 'existing');
  // Only the changed field is locked: a BoxSet's LockData would be copied
  // to every movie in it
  assert.strictEqual(posted.LockData, false);
  assert.deepStrictEqual(posted.LockedFields, ['Tags']);

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

  // Placeholder movies expose the file's {edition-X} as Plex's editionTitle
  const placeholder = await jellyfin.getMetadata('movie-ph');
  assert.strictEqual(
    (placeholder as { editionTitle?: string }).editionTitle,
    'Trailer'
  );
  assert.match(
    placeholder.Media[0].Part?.[0].file ?? '',
    /\{edition-Trailer\}\.mp4$/
  );

  // Shows come with their seasons when asked, for Season 00 detection
  const show = await jellyfin.getMetadata('show-1', { includeChildren: true });
  assert.deepStrictEqual(
    show.Children?.Metadata?.map((child) => child.index),
    [1]
  );

  // Shows count as recently added when an episode was added
  const recentShows = await jellyfin.getRecentlyAdded(
    'lib-tv',
    { addedAt: Date.now() - 60000 },
    'show'
  );
  assert.deepStrictEqual(
    recentShows.map((item) => item.ratingKey),
    ['show-1']
  );

  // Item labels are tags; the item's own metadata lock is left alone
  await jellyfin.addLabelToItem('movie-ph', 'trailer-placeholder');
  const tagged = JSON.parse(calls[calls.length - 1].body);
  assert.deepStrictEqual(tagged.Tags, ['keep', 'trailer-placeholder']);
  assert.strictEqual(tagged.LockData, false);
  assert.deepStrictEqual(tagged.LockedFields, []);

  // Title fixes lock the name so Jellyfin doesn't rename it back
  await jellyfin.updateItemTitle('movie-ph', 'Trailer (Placeholder)');
  const retitled = JSON.parse(calls[calls.length - 1].body);
  assert.deepStrictEqual(
    { name: retitled.Name, locked: retitled.LockedFields },
    { name: 'Trailer (Placeholder)', locked: ['Name'] }
  );

  // Posters from URLs are downloaded by Jellyfin itself
  await jellyfin.uploadPosterFromUrl('movie-ph', 'https://img/x.jpg');
  const remote = calls[calls.length - 1];
  assert.strictEqual(remote.path, '/Items/movie-ph/RemoteImages/Download');
  assert.strictEqual(remote.query.get('ImageUrl'), 'https://img/x.jpg');

  // Library scans run like the UI's "Scan library", so new files get metadata
  await jellyfin.scanLibrary('lib-movies');
  assert.strictEqual(
    calls[calls.length - 1].query.get('MetadataRefreshMode'),
    'Default'
  );

  // Played placeholders are reset only for users who played them
  assert.strictEqual(await jellyfin.resetPlayedState(['movie-ph']), 1);
  const unplayed = calls.filter((c) => c.method === 'DELETE').pop() as Call;
  assert.strictEqual(unplayed.path, '/UserPlayedItems/movie-ph');
  assert.strictEqual(unplayed.query.get('userId'), 'u1');

  // Jellyfin placeholders carry provider ids in the folder name, and the TV
  // file isn't named like a trailer extra
  const { getSettings } = await import('@server/lib/settings');
  getSettings().main.mediaServerType = 'jellyfin';
  const { createPlaceholder } = await import(
    '@server/lib/placeholders/placeholderManager'
  );
  const libraryRoot = path.join(process.env.CONFIG_DIRECTORY ?? '', 'lib');
  const trailer = () => {
    const file = path.join(libraryRoot, `trailer-${Math.random()}.mp4`);
    fs.mkdirSync(libraryRoot, { recursive: true });
    fs.writeFileSync(file, '');
    return file;
  };
  const movieResult = await createPlaceholder({
    tmdbId: 9,
    title: 'Soon',
    year: 2030,
    mediaType: 'movie',
    libraryPath: libraryRoot,
    trailerPath: trailer(),
  });
  assert.match(
    movieResult.placeholderPath,
    /Soon \(2030\) \[tmdbid-9\][/\\]Soon \(2030\) \[tmdbid-9\] \{tmdb-9\} \{edition-Trailer\}\.mp4$/
  );
  const tvResult = await createPlaceholder({
    tmdbId: 7,
    tvdbId: 70,
    title: 'Later',
    year: 2031,
    mediaType: 'tv',
    libraryPath: libraryRoot,
    trailerPath: trailer(),
  });
  assert.match(
    tvResult.placeholderPath,
    /Later \(2031\) \[tvdbid-70\][/\\]Season 00[/\\]S00E00 - Trailer \(Placeholder\)\.mp4$/
  );
  getSettings().main.mediaServerType = 'plex';

  // Person collections: people counted per library, placeholders left out
  assert.deepStrictEqual(await jellyfin.getLibraryDirectors('lib-movies'), [
    { name: 'Lana Wachowski', count: 2 },
  ]);
  const personItems = await jellyfin.getItemsByActor(
    'lib-tv',
    'Bryan Cranston',
    'tv'
  );
  assert.deepStrictEqual(
    personItems.map((item) => item.ratingKey),
    ['bb']
  );

  // Overlays: media streams come back in Plex's shape and vocabulary, with
  // an admin's play stats
  const dune = await jellyfin.getMetadata('movie-4k');
  const [media] = dune.Media;
  const [videoStream, audioStream] = media.Part?.[0].Stream ?? [];
  assert.deepStrictEqual(
    {
      resolution: media.videoResolution,
      audioCodec: media.audioCodec,
      bitrate: media.bitrate,
      dolbyVision: videoStream.DOVIPresent,
      dvProfile: videoStream.DOVIProfile,
      colorTrc: videoStream.colorTrc,
      audioStream: audioStream.streamType,
      language: audioStream.languageCode,
      viewCount: dune.viewCount,
    },
    {
      resolution: '4k',
      audioCodec: 'dca',
      bitrate: 60000,
      dolbyVision: true,
      dvProfile: 8,
      colorTrc: 'smpte2084',
      audioStream: 2,
      language: 'eng',
      viewCount: 2,
    }
  );

  // Overlaid posters are uploaded to the item's primary image
  await jellyfin.uploadPosterFromFile('movie-4k', poster);
  assert.strictEqual(
    calls[calls.length - 1].path,
    '/Items/movie-4k/Images/Primary'
  );

  // Library listings carry poster paths for base poster downloads
  assert.strictEqual(
    calls
      .find((c) => c.query.get('ParentId') === 'lib-movies')
      ?.query.get('EnableImageTypes'),
    'Primary'
  );

  // Pre-existing collections are shown under the library of their items;
  // collections the caller excludes are left alone
  const [preExisting, managed] = await jellyfin.assignLibraries(
    [{ ratingKey: 'col-pre' }, { ratingKey: 'col-1' }],
    (collection) => collection.ratingKey === 'col-pre'
  );
  assert.deepStrictEqual(preExisting, {
    ratingKey: 'col-pre',
    libraryKey: 'lib-movies',
    libraryName: 'Movies',
  });
  assert.deepStrictEqual(managed, { ratingKey: 'col-1' });

  // Per-user visibility: Agregarr's blocked tags are replaced, the user's own
  // and the rest of the policy kept; unchanged policies aren't posted
  const viewer = {
    Id: 'u2',
    Name: 'viewer',
    Policy: {
      EnableAllFolders: true,
      BlockedTags: ['kids-hidden', 'AgregarrOverseerrUser5'],
    },
  };
  assert.ok(
    await jellyfin.setBlockedTags(viewer, 'AgregarrOverseerr', [
      'AgregarrOverseerrUser7',
    ])
  );
  const policy = JSON.parse(calls[calls.length - 1].body);
  assert.deepStrictEqual(policy, {
    EnableAllFolders: true,
    BlockedTags: ['kids-hidden', 'AgregarrOverseerrUser7'],
  });
  const policyCalls = calls.length;
  assert.ok(
    !(await jellyfin.setBlockedTags(viewer, 'AgregarrOverseerr', [
      'AgregarrOverseerrUser5',
    ]))
  );
  assert.strictEqual(calls.length, policyCalls);

  // Playback statistics (Playback Reporting plugin): episodes count towards
  // their show; most popular ranks by viewers, most watched by plays
  const popular = await jellyfin.getPlaybackStats(
    'tv',
    30,
    'plays',
    'most_popular'
  );
  assert.deepStrictEqual(
    popular.map((row) => [row.rating_key, row.users_watched, row.total_plays]),
    [
      ['show-a', 2, 3],
      ['show-b', 1, 5],
    ]
  );
  assert.deepStrictEqual(
    { type: popular[0].media_type, tmdb: popular[0].tmdb_id },
    { type: 'show', tmdb: 11 }
  );
  const watched = await jellyfin.getPlaybackStats(
    'tv',
    30,
    'plays',
    'most_watched'
  );
  assert.deepStrictEqual(
    watched.map((row) => row.rating_key),
    ['show-b', 'show-a']
  );

  // Dashboard: collection plays include episodes of member series
  const dashboard = await jellyfin.getDashboardStats(['col-stats'], 7);
  assert.deepStrictEqual(
    { movies: dashboard.moviePlays, tv: dashboard.tvPlays },
    { movies: 7, tv: 3 }
  );
  assert.deepStrictEqual(dashboard.collections, [
    {
      rating_key: 'col-stats',
      title: 'Stats',
      media_type: 'collection',
      item_count: 2,
      total_plays: 5,
      total_duration: 130,
      user_stats: [{ user_id: 'u1' }],
    },
  ]);

  // Filtered hubs become snapshots: newest first, placeholders left out
  const recentMovies = await jellyfin.getFilteredHubItems(
    'lib-movies',
    'movie',
    'recently_added',
    1
  );
  assert.deepStrictEqual(
    recentMovies.map((item) => item.ratingKey),
    ['newest']
  );
  const airedShows = await jellyfin.getFilteredHubItems(
    'lib-tv',
    'tv',
    'recently_released',
    5
  );
  assert.deepStrictEqual(
    airedShows.map((item) => item.ratingKey),
    ['s1', 's2']
  );

  // Missing collections resolve to null instead of throwing
  assert.strictEqual(await jellyfin.getCollectionMetadata('gone'), null);

  // Item reads always carry a user (Jellyfin 12 needs one with an API key)
  const itemReads = calls.filter(
    (c) => c.method === 'GET' && /^\/(Items|Shows)\b/.test(c.path)
  );
  assert.ok(itemReads.length > 0);
  assert.ok(itemReads.every((c) => c.query.get('userId')));

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
