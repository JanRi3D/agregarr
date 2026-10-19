import JellyfinAPI from '@server/api/jellyfin';
import PlexAPI from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';

export const isJellyfinMode = (): boolean =>
  getSettings().main.mediaServerType === 'jellyfin';

/**
 * Client for the configured media server. In Jellyfin mode this is a
 * JellyfinAPI, which implements the PlexAPI methods the collection sync
 * pipeline uses (see PlexCompatible in api/jellyfin.ts).
 */
export async function getMediaServerClient(): Promise<PlexAPI> {
  const settings = getSettings();
  if (isJellyfinMode()) {
    return new JellyfinAPI(settings.jellyfin) as unknown as PlexAPI;
  }

  const { getAdminUser } = await import(
    '@server/lib/collections/core/CollectionUtilities'
  );
  const admin = await getAdminUser();
  if (!admin?.plexToken) {
    throw new Error('No local admin Plex token found');
  }
  return new PlexAPI({
    plexToken: admin.plexToken,
    plexSettings: settings.plex,
  });
}
