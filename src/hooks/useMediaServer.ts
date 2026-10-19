import useSettings from '@app/hooks/useSettings';

/** Which media server Agregarr manages, for server-specific UI and wording. */
const useMediaServer = () => {
  const { currentSettings } = useSettings();
  const isJellyfin = currentSettings.mediaServerType === 'jellyfin';

  return { isJellyfin, serverName: isJellyfin ? 'Jellyfin' : 'Plex' };
};

export default useMediaServer;
