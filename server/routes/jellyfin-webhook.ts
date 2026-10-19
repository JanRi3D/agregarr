import JellyfinAPI from '@server/api/jellyfin';
import { getMediaServerClient } from '@server/lib/mediaServer';
import { TV_PLACEHOLDER_FILENAMES } from '@server/lib/placeholders/placeholderManager';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();

const JELLYFIN_ID = /^([0-9a-f]{32}|[0-9a-f-]{36})$/i;

/**
 * Receives Jellyfin Webhook plugin events so played placeholders are marked
 * unplayed right away (quick sync also resets them). Plugin setup: a Generic
 * destination pointing here, with Playback Start and Playback Stop enabled and
 * the template
 *   {"NotificationType":"{{NotificationType}}","ItemId":"{{ItemId}}","UserId":"{{UserId}}"}
 */
router.post('/', async (req, res) => {
  // Respond immediately; Jellyfin doesn't wait for our processing
  res.sendStatus(200);

  const { NotificationType, ItemId, UserId } = (req.body ?? {}) as Record<
    string,
    string | undefined
  >;
  if (
    (NotificationType !== 'PlaybackStart' &&
      NotificationType !== 'PlaybackStop') ||
    !JELLYFIN_ID.test(ItemId ?? '') ||
    !JELLYFIN_ID.test(UserId ?? '')
  ) {
    return;
  }

  try {
    const client = await getMediaServerClient();
    if (!(client instanceof JellyfinAPI) || !ItemId || !UserId) return;

    // Only placeholders are touched: the request itself is unauthenticated
    const file = (
      (await client.getMetadata(ItemId)).Media?.[0]?.Part?.[0]?.file ?? ''
    )
      .split(/[/\\]/)
      .pop();
    if (
      !file ||
      (!/\{edition-(Trailer|Placeholder|Coming Soon)\}/.test(file) &&
        !TV_PLACEHOLDER_FILENAMES.includes(file))
    ) {
      return;
    }

    await client.markItemAsUnplayed(ItemId, UserId);
    logger.info('Marked placeholder unplayed', {
      label: 'JellyfinWebhook',
      event: NotificationType,
      itemId: ItemId,
    });
  } catch (error) {
    logger.error('Failed to handle Jellyfin webhook', {
      label: 'JellyfinWebhook',
      itemId: ItemId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
