import SettingsJellyfin from '@app/components/Settings/SettingsJellyfin';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsPlex from '@app/components/Settings/SettingsPlex';
import useRouteGuard from '@app/hooks/useRouteGuard';
import useSettings from '@app/hooks/useSettings';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const PlexSettingsPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  const { currentSettings } = useSettings();
  return (
    <SettingsLayout>
      {currentSettings.mediaServerType === 'jellyfin' ? (
        <SettingsJellyfin />
      ) : (
        <SettingsPlex />
      )}
    </SettingsLayout>
  );
};

export default PlexSettingsPage;
