import type PlexAPI from '@server/api/plexapi';
import type {
  PlexLibrary,
  PlexLibraryItem,
  PlexMetadata,
} from '@server/api/plexapi';
import type { JellyfinSettings, Library } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string; // 'Movie' | 'Series' | 'Episode' | 'BoxSet' | ...
  ProductionYear?: number;
  PremiereDate?: string;
  DateCreated?: string;
  ProviderIds?: Record<string, string>;
  Tags?: string[];
  Overview?: string;
  ChildCount?: number;
  ParentId?: string;
  SeriesId?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
}

interface JellyfinLibrary {
  Name: string;
  ItemId: string;
  CollectionType?: string; // 'movies' | 'tvshows' | ...
}

interface JellyfinItemsResponse {
  Items: JellyfinItem[];
  TotalRecordCount: number;
}

interface JellyfinAuthResult {
  AccessToken: string;
  User: {
    Id: string;
    Name: string;
    Policy?: { IsAdministrator?: boolean };
  };
}

/**
 * The PlexAPI methods the collection sync pipeline calls. JellyfinAPI implements
 * them with the same meaning, so the pipeline runs unchanged against Jellyfin.
 * Plex-only concepts (hubs, visibility, custom item order, item labels, themes)
 * are no-ops; smart collections are rejected.
 */
type PlexCompatible = Pick<
  PlexAPI,
  | 'getStatus'
  | 'getLibraries'
  | 'syncLibraries'
  | 'getLibraryContents'
  | 'getRecentlyAdded'
  | 'scanLibrary'
  | 'emptyTrash'
  | 'getMetadata'
  | 'getAllEpisodesFromShow'
  | 'getAllCollections'
  | 'getCollectionMetadata'
  | 'getCollectionMetadataSafe'
  | 'createEmptyCollection'
  | 'addItemsToCollection'
  | 'getCollectionItems'
  | 'updateCollectionContents'
  | 'updateCollectionContentSort'
  | 'arrangeCollectionItemsInOrder'
  | 'updateCollectionMode'
  | 'addLabelToCollection'
  | 'updateCollectionTitle'
  | 'updateCollectionSortTitle'
  | 'updateCollectionVisibility'
  | 'updateSummary'
  | 'deleteCollection'
  | 'deleteHubItem'
  | 'getCurrentPosterUrl'
  | 'updateCollectionPoster'
  | 'getCurrentArtUrl'
  | 'uploadArtFromFile'
  | 'lockArt'
  | 'getCurrentThemeUrl'
  | 'uploadThemeFromFile'
  | 'lockTheme'
  | 'addLabelToItem'
  | 'removeLabelFromItem'
  | 'getItemsWithLabel'
  | 'createLabelBasedSmartCollection'
  | 'updateLabelBasedSmartCollectionUri'
  | 'getPlexUserTitle'
>;

const PAGE_SIZE = 500;

const authHeader = (token?: string): string =>
  `MediaBrowser Client="Agregarr", Device="Agregarr", DeviceId="${
    getSettings().clientId
  }", Version="1.0"${token ? `, Token="${token}"` : ''}`;

const toPlexGuids = (providerIds: Record<string, string> = {}) =>
  Object.entries(providerIds)
    .filter(([provider, id]) => id && /^(tmdb|imdb|tvdb)$/i.test(provider))
    .map(([provider, id]) => ({ id: `${provider.toLowerCase()}://${id}` }));

const toUnixSeconds = (date?: string) =>
  date ? Math.floor(new Date(date).getTime() / 1000) : 0;

const toPlexItem = (item: JellyfinItem): PlexLibraryItem => ({
  ratingKey: item.Id,
  parentRatingKey: item.SeriesId,
  title: item.Name,
  guid: '',
  Guid: toPlexGuids(item.ProviderIds),
  addedAt: toUnixSeconds(item.DateCreated),
  updatedAt: toUnixSeconds(item.DateCreated),
  year: item.ProductionYear,
  originallyAvailableAt: item.PremiereDate?.slice(0, 10),
  index: item.IndexNumber,
  parentIndex: item.ParentIndexNumber,
  type:
    item.Type === 'Series'
      ? 'show'
      : item.Type === 'Episode'
      ? 'episode'
      : 'movie',
  Media: [],
});

const imageContentType = (file: string) =>
  ({ '.png': 'image/png', '.webp': 'image/webp' }[
    path.extname(file).toLowerCase()
  ] ?? 'image/jpeg');

/** Jellyfin REST client (Jellyfin 10.9+). Collections are Jellyfin BoxSets. */
class JellyfinAPI implements PlexCompatible {
  private axios: AxiosInstance;

  constructor(settings: Pick<JellyfinSettings, 'url' | 'apiKey'>) {
    this.axios = axios.create({
      baseURL: settings.url.replace(/\/+$/, ''),
      timeout: 30000,
      headers: { Authorization: authHeader(settings.apiKey) },
    });
  }

  /** Sign in a Jellyfin user by username/password (no API key needed). */
  public static async authenticateByName(
    url: string,
    username: string,
    password: string
  ): Promise<JellyfinAuthResult> {
    const response = await axios.post<JellyfinAuthResult>(
      `${url.replace(/\/+$/, '')}/Users/AuthenticateByName`,
      { Username: username, Pw: password },
      { headers: { Authorization: authHeader() }, timeout: 15000 }
    );
    return response.data;
  }

  public async getStatus(): Promise<{
    ServerName: string;
    Id: string;
    Version: string;
  }> {
    return (await this.axios.get('/System/Info')).data;
  }

  public async getLibraries(): Promise<PlexLibrary[]> {
    const { data } = await this.axios.get<JellyfinLibrary[]>(
      '/Library/VirtualFolders'
    );
    return data
      .filter(
        (lib) =>
          lib.CollectionType === 'movies' || lib.CollectionType === 'tvshows'
      )
      .map((lib) => ({
        key: lib.ItemId,
        title: lib.Name,
        type: lib.CollectionType === 'movies' ? 'movie' : 'show',
        agent: 'jellyfin',
      }));
  }

  public async syncLibraries(): Promise<void> {
    const settings = getSettings();
    const libraries = await this.getLibraries();
    settings.plex.libraries = libraries.map(
      (library): Library => ({
        key: library.key,
        name: library.title,
        type: library.type,
        lastScan: settings.plex.libraries.find((l) => l.key === library.key)
          ?.lastScan,
      })
    );
    settings.save();
  }

  public async getLibraryContents(
    id: string,
    {
      offset = 0,
      size = 50,
      sortByDateAdded = false,
    }: { offset?: number; size?: number; sortByDateAdded?: boolean } = {}
  ): Promise<{ totalSize: number; items: PlexLibraryItem[] }> {
    const { data } = await this.axios.get<JellyfinItemsResponse>('/Items', {
      params: {
        ...(sortByDateAdded && {
          SortBy: 'DateCreated',
          SortOrder: 'Descending',
        }),
        ParentId: id,
        Recursive: true,
        IncludeItemTypes: 'Movie,Series',
        Fields: 'ProviderIds,DateCreated',
        StartIndex: offset,
        Limit: size,
        EnableImages: false,
      },
    });
    return {
      totalSize: data.TotalRecordCount,
      items: data.Items.map(toPlexItem),
    };
  }

  public async getRecentlyAdded(
    id: string,
    options: { addedAt: number } = { addedAt: Date.now() - 1000 * 60 * 60 }
  ): Promise<PlexLibraryItem[]> {
    const { items } = await this.getLibraryContents(id, {
      size: 500,
      sortByDateAdded: true,
    });
    return items.filter((item) => item.addedAt * 1000 >= options.addedAt);
  }

  public async scanLibrary(libraryId: string): Promise<void> {
    await this.axios.post(`/Items/${libraryId}/Refresh`, null, {
      params: { Recursive: true },
    });
  }

  // Jellyfin removes missing items during the library scan itself
  public async emptyTrash(): Promise<void> {
    return;
  }

  public async getMetadata(key: string): Promise<PlexMetadata> {
    const item = toPlexItem(await this.getItem(key));
    return {
      ...item,
      Guid: item.Guid ?? [],
      index: item.index ?? 0,
      leafCount: 0,
      viewedLeafCount: 0,
    };
  }

  public async getAllEpisodesFromShow(
    showRatingKey: string
  ): Promise<PlexLibraryItem[]> {
    const { data } = await this.axios.get<JellyfinItemsResponse>(
      `/Shows/${showRatingKey}/Episodes`,
      { params: { Fields: 'ProviderIds,DateCreated' } }
    );
    return data.Items.map(toPlexItem);
  }

  public async getAllCollections() {
    const collections = await this.getAllItems({
      IncludeItemTypes: 'BoxSet',
      Recursive: true,
      Fields: 'Tags',
    });
    return collections.map((collection) => ({
      ratingKey: collection.Id,
      title: collection.Name,
      type: 'collection',
      labels: collection.Tags ?? [],
    }));
  }

  public async getCollectionMetadata(ratingKey: string) {
    try {
      const item = await this.getItem(ratingKey);
      return {
        ratingKey: item.Id,
        title: item.Name,
        type: 'collection',
        labels: item.Tags ?? [],
        summary: item.Overview,
        childCount: item.ChildCount,
      };
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        return null;
      }
      throw e;
    }
  }

  public async getCollectionMetadataSafe(ratingKey: string) {
    return this.getCollectionMetadata(ratingKey).catch(() => null);
  }

  public async createEmptyCollection(title: string): Promise<string | null> {
    const { data } = await this.axios.post<{ Id: string }>(
      '/Collections',
      null,
      { params: { Name: title } }
    );
    return data.Id ?? null;
  }

  public async addItemsToCollection(
    collectionRatingKey: string,
    items: { ratingKey: string }[]
  ): Promise<void> {
    for (const ids of chunks(items.map((item) => item.ratingKey))) {
      await this.axios.post(`/Collections/${collectionRatingKey}/Items`, null, {
        params: { Ids: ids.join(',') },
      });
    }
  }

  public async getCollectionItems(
    collectionRatingKey: string
  ): Promise<string[]> {
    const items = await this.getAllItems({ ParentId: collectionRatingKey });
    return items.map((item) => item.Id);
  }

  public async updateCollectionContents(
    collectionRatingKey: string,
    desiredItems: { ratingKey: string }[]
  ) {
    const current = new Set(await this.getCollectionItems(collectionRatingKey));
    const desired = new Set(desiredItems.map((item) => item.ratingKey));
    const toAdd = [...desired].filter((key) => !current.has(key));
    const toRemove = [...current].filter((key) => !desired.has(key));

    await this.addItemsToCollection(
      collectionRatingKey,
      toAdd.map((ratingKey) => ({ ratingKey }))
    );
    for (const ids of chunks(toRemove)) {
      await this.axios.delete(`/Collections/${collectionRatingKey}/Items`, {
        params: { Ids: ids.join(',') },
      });
    }

    return {
      added: toAdd.length,
      removed: toRemove.length,
      removedKeys: toRemove,
      reordered: false,
      errors: [] as string[],
    };
  }

  // Jellyfin has no manual item order or collection display modes
  public async updateCollectionContentSort(): Promise<void> {
    return;
  }

  public async arrangeCollectionItemsInOrder(): Promise<void> {
    return;
  }

  public async updateCollectionMode(): Promise<void> {
    return;
  }

  /** Agregarr's identity labels are stored as Jellyfin tags. */
  public async addLabelToCollection(
    collectionRatingKey: string,
    label: string
  ): Promise<boolean> {
    const item = await this.getItem(collectionRatingKey);
    if (!item.Tags?.includes(label)) {
      await this.updateItem(item, { Tags: [...(item.Tags ?? []), label] });
    }
    return true;
  }

  public async updateCollectionTitle(
    collectionRatingKey: string,
    title: string
  ): Promise<void> {
    const item = await this.getItem(collectionRatingKey);
    if (item.Name !== title) {
      await this.updateItem(item, { Name: title });
    }
  }

  public async updateCollectionSortTitle(
    collectionRatingKey: string,
    sortTitle: string
  ): Promise<void> {
    await this.updateItem(await this.getItem(collectionRatingKey), {
      ForcedSortName: sortTitle,
    });
  }

  public async updateSummary(ratingKey: string, summary: string) {
    await this.updateItem(await this.getItem(ratingKey), { Overview: summary });
  }

  // Home screen / recommended visibility is a Plex hub concept
  public async updateCollectionVisibility(): Promise<void> {
    return;
  }

  public async deleteHubItem(): Promise<void> {
    return;
  }

  public async deleteCollection(collectionRatingKey: string): Promise<void> {
    await this.axios.delete(`/Items/${collectionRatingKey}`);
  }

  public async getCurrentPosterUrl(ratingKey: string): Promise<string | null> {
    const tag = (await this.getItem(ratingKey)).ImageTags?.Primary;
    return tag ? `/Items/${ratingKey}/Images/Primary?tag=${tag}` : null;
  }

  public async updateCollectionPoster(
    collectionRatingKey: string,
    posterPath: string
  ): Promise<void> {
    await this.uploadImage(collectionRatingKey, posterPath, 'Primary');
  }

  public async getCurrentArtUrl(ratingKey: string): Promise<string | null> {
    const tag = (await this.getItem(ratingKey)).BackdropImageTags?.[0];
    return tag ? `/Items/${ratingKey}/Images/Backdrop?tag=${tag}` : null;
  }

  public async uploadArtFromFile(
    ratingKey: string,
    filepath: string
  ): Promise<void> {
    await this.uploadImage(ratingKey, filepath, 'Backdrop');
  }

  // Uploaded images aren't replaced by Jellyfin metadata refreshes
  public async lockArt(): Promise<void> {
    return;
  }

  // Jellyfin theme songs are files next to the media; not supported here
  public async getCurrentThemeUrl(): Promise<string | null> {
    return null;
  }

  public async uploadThemeFromFile(ratingKey: string): Promise<void> {
    logger.debug('Collection themes are not supported on Jellyfin', {
      label: 'Jellyfin API',
      ratingKey,
    });
  }

  public async lockTheme(): Promise<void> {
    return;
  }

  // Item labels only drive Plex smart collections and filters
  public async addLabelToItem(): Promise<void> {
    return;
  }

  public async removeLabelFromItem(): Promise<void> {
    return;
  }

  public async getItemsWithLabel(): Promise<string[]> {
    return [];
  }

  public async createLabelBasedSmartCollection(): Promise<string> {
    throw new Error(
      '"Show unwatched only" (smart) collections are not supported on Jellyfin'
    );
  }

  public async updateLabelBasedSmartCollectionUri(): Promise<void> {
    throw new Error(
      '"Show unwatched only" (smart) collections are not supported on Jellyfin'
    );
  }

  public async getPlexUserTitle(): Promise<string | null> {
    return null;
  }

  private async getItem(itemId: string): Promise<JellyfinItem> {
    return (await this.axios.get<JellyfinItem>(`/Items/${itemId}`)).data;
  }

  /**
   * Jellyfin's update endpoint replaces the whole item, so post back the
   * full item we fetched with the changes merged in.
   */
  private async updateItem(
    item: JellyfinItem,
    changes: Partial<JellyfinItem> & { ForcedSortName?: string }
  ): Promise<void> {
    await this.axios.post(`/Items/${item.Id}`, {
      ...item,
      ...changes,
      // Keep Jellyfin metadata refreshes from reverting our changes
      LockData: true,
    });
  }

  private async uploadImage(
    itemId: string,
    file: string,
    imageType: 'Primary' | 'Backdrop'
  ): Promise<void> {
    const image = await fs.promises.readFile(file);
    await this.axios.post(
      `/Items/${itemId}/Images/${imageType}`,
      image.toString('base64'),
      { headers: { 'Content-Type': imageContentType(file) } }
    );
  }

  private async getAllItems(
    params: Record<string, unknown>
  ): Promise<JellyfinItem[]> {
    const items: JellyfinItem[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const { data } = await this.axios.get<JellyfinItemsResponse>('/Items', {
        params: {
          ...params,
          StartIndex: start,
          Limit: PAGE_SIZE,
          EnableImages: false,
        },
      });
      items.push(...data.Items);
      if (data.Items.length < PAGE_SIZE) {
        return items;
      }
    }
  }
}

// Keep query strings well under URL length limits
function chunks(ids: string[], size = 100): string[][] {
  const result: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    result.push(ids.slice(i, i + size));
  }
  return result;
}

export default JellyfinAPI;
