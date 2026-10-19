import useSettings from '@app/hooks/useSettings';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

/**
 * Sends Jellyfin users away from a page that only manages Plex features.
 * Returns true while redirecting, so the page can skip rendering.
 */
const usePlexOnlyRoute = (fallback: string): boolean => {
  const router = useRouter();
  const { currentSettings } = useSettings();
  const isJellyfin = currentSettings.mediaServerType === 'jellyfin';

  useEffect(() => {
    if (isJellyfin) {
      router.replace(fallback);
    }
  }, [isJellyfin, fallback, router]);

  return isJellyfin;
};

export default usePlexOnlyRoute;
