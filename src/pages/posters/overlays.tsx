import OverlaysPageView from '@app/components/Posters/OverlaysPageView';
import PostersLayout from '@app/components/Posters/PostersLayout';
import usePlexOnlyRoute from '@app/hooks/usePlexOnlyRoute';
import Head from 'next/head';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  posterOverlays: 'Poster Overlays',
});

const PostersOverlaysPage: React.FC = () => {
  const intl = useIntl();
  const isJellyfin = usePlexOnlyRoute('/posters/collections');
  const pageTitle = `${intl.formatMessage(messages.posterOverlays)} - Agregarr`;

  if (isJellyfin) {
    return null;
  }

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <PostersLayout>
        <OverlaysPageView />
      </PostersLayout>
    </>
  );
};

export default PostersOverlaysPage;
