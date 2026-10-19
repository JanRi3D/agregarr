import type JellyfinAPI from '@server/api/jellyfin';
import TautulliAPI from '@server/api/tautulli';
import { getMediaServerClient, isJellyfinMode } from '@server/lib/mediaServer';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const dashboardRoutes = Router();

const getCollectionKeys = (): string[] =>
  [
    ...(getSettings().plex.collectionConfigs ?? []),
    ...(getSettings().plex.preExistingCollectionConfigs ?? []),
  ]
    .map((config) => config.collectionRatingKey)
    .filter((key): key is string => !!key);

// On Jellyfin, play statistics come from the Playback Reporting plugin
const getJellyfinStats = async (days: number) =>
  ((await getMediaServerClient()) as unknown as JellyfinAPI).getDashboardStats(
    getCollectionKeys(),
    days
  );

/**
 * GET /api/v1/dashboard/stats
 * Get dashboard statistics including collection stats, user activity, etc.
 */
dashboardRoutes.get('/stats', isAuthenticated(), async (req, res) => {
  try {
    const settings = getSettings();

    let tautulliStats = null;
    let collectionStatsData = null;
    let weeklyStats = null;

    // Get Tautulli stats if configured
    if (isJellyfinMode()) {
      try {
        const stats = await getJellyfinStats(7);
        const collectionPlays = stats.collections.reduce(
          (total, collection) => total + collection.total_plays,
          0
        );
        collectionStatsData = {
          topCollections: [...stats.collections]
            .sort((a, b) => b.total_plays - a.total_plays)
            .slice(0, 5),
          totalCollections: stats.collections.length,
          collectionPlays: { total: collectionPlays, movies: 0, tv: 0 },
        };
        weeklyStats = {
          totalPlays: stats.moviePlays + stats.tvPlays,
          moviePlays: stats.moviePlays,
          tvPlays: stats.tvPlays,
          collectionPlays,
        };
        tautulliStats = { isConnected: true, weeklyActivity: weeklyStats };
      } catch (error) {
        // Without the plugin the dashboard shows its setup message
        logger.debug('Jellyfin playback statistics unavailable', {
          label: 'Dashboard API',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (settings.tautulli.hostname && settings.tautulli.apiKey) {
      try {
        const tautulli = new TautulliAPI(settings.tautulli);

        // Get rating keys from our configured collections
        const collectionRatingKeys: string[] = [];
        const agregarrCollectionKeys: string[] = [];
        const preExistingCollectionKeys: string[] = [];

        // Include user-created Agregarr collections
        if (settings.plex.collectionConfigs) {
          for (const config of settings.plex.collectionConfigs) {
            if (config.collectionRatingKey) {
              collectionRatingKeys.push(config.collectionRatingKey);
              agregarrCollectionKeys.push(config.collectionRatingKey);
            }
          }
        }

        // Include pre-existing collections
        if (settings.plex.preExistingCollectionConfigs) {
          for (const config of settings.plex.preExistingCollectionConfigs) {
            if (config.collectionRatingKey) {
              collectionRatingKeys.push(config.collectionRatingKey);
              preExistingCollectionKeys.push(config.collectionRatingKey);
            }
          }
        }

        // Get collection stats and weekly activity stats
        const [collectionStats, weeklyMovies, weeklyTV] = await Promise.all([
          tautulli
            .getTopCollections(50, 'plays', 7, collectionRatingKeys)
            .catch((err) => {
              logger.warn('Failed to get collection stats from Tautulli', {
                label: 'Dashboard API',
                error: err.message,
              });
              return [];
            }),
          tautulli.getHomeStats(7, 'plays', 'top_movies', 10).catch(() => []),
          tautulli.getHomeStats(7, 'plays', 'top_tv', 10).catch(() => []),
        ]);

        // Calculate weekly plays from server totals
        let moviePlaysCount = 0;
        let tvPlaysCount = 0;

        weeklyMovies.forEach((item) => {
          moviePlaysCount += item.total_plays || 0;
        });

        weeklyTV.forEach((item) => {
          tvPlaysCount += item.total_plays || 0;
        });

        const totalWeeklyPlays = moviePlaysCount + tvPlaysCount;

        // Calculate collection-specific plays
        let collectionTotalPlays = 0;
        let collectionMoviePlays = 0;
        let collectionTvPlays = 0;

        collectionStats.forEach((collection) => {
          collectionTotalPlays += collection.total_plays;

          // Determine if it's a movie or TV collection based on media_type or title
          // This is a simple heuristic - could be improved with better metadata
          if (
            collection.media_type === 'movie' ||
            collection.title.toLowerCase().includes('movie') ||
            collection.title.toLowerCase().includes('film')
          ) {
            collectionMoviePlays += collection.total_plays;
          } else if (
            collection.media_type === 'show' ||
            collection.title.toLowerCase().includes('tv') ||
            collection.title.toLowerCase().includes('show') ||
            collection.title.toLowerCase().includes('series')
          ) {
            collectionTvPlays += collection.total_plays;
          } else {
            // If uncertain, split evenly or assign to TV (most collections are mixed)
            collectionTvPlays += collection.total_plays;
          }
        });

        collectionStatsData = {
          topCollections: collectionStats.slice(0, 5),
          totalCollections: collectionStats.length,
          collectionPlays: {
            total: collectionTotalPlays,
            movies: collectionMoviePlays,
            tv: collectionTvPlays,
          },
        };

        weeklyStats = {
          totalPlays: totalWeeklyPlays,
          moviePlays: moviePlaysCount,
          tvPlays: tvPlaysCount,
          collectionPlays: collectionTotalPlays,
        };

        tautulliStats = {
          isConnected: true,
          weeklyActivity: weeklyStats,
        };
      } catch (error) {
        logger.error('Failed to fetch Tautulli stats for dashboard', {
          label: 'Dashboard API',
          error: error.message,
        });
        tautulliStats = {
          isConnected: false,
          error: error.message,
        };
      }
    }

    // Get collection configs count
    const agregarrCollectionCount =
      settings.plex.collectionConfigs?.length || 0;
    const preExistingCollectionCount =
      settings.plex.preExistingCollectionConfigs?.length || 0;

    const dashboardData = {
      collections: {
        agregarr: agregarrCollectionCount,
        preExisting: preExistingCollectionCount,
        total: agregarrCollectionCount + preExistingCollectionCount,
        stats: collectionStatsData,
      },
      activity: weeklyStats,
      tautulli: tautulliStats,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    logger.error('Failed to get dashboard stats', {
      label: 'Dashboard API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get dashboard stats',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/dashboard/collections
 * Get detailed collection statistics from Tautulli
 */
dashboardRoutes.get('/collections', isAuthenticated(), async (req, res) => {
  try {
    const settings = getSettings();
    const { limit = 10, statType = 'plays', days = 30 } = req.query;

    if (isJellyfinMode()) {
      let stats;
      try {
        stats = await getJellyfinStats(Number(days));
      } catch (error) {
        return res.status(400).json({
          error: 'Playback Reporting not installed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const key = statType === 'duration' ? 'total_duration' : 'total_plays';
      return res.status(200).json({
        collections: stats.collections
          .sort((a, b) => b[key] - a[key])
          .slice(0, Number(limit)),
        metadata: {
          limit: Number(limit),
          statType,
          days: Number(days),
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (!settings.tautulli.hostname || !settings.tautulli.apiKey) {
      return res.status(400).json({
        error: 'Tautulli not configured',
        message:
          'Tautulli settings are required to fetch collection statistics',
      });
    }

    // Get rating keys from our configured collections
    const collectionRatingKeys: string[] = [];

    // Extract rating keys from user-created Agregarr collections
    if (settings.plex.collectionConfigs) {
      for (const config of settings.plex.collectionConfigs) {
        if (config.collectionRatingKey) {
          collectionRatingKeys.push(config.collectionRatingKey);
        }
      }
    }

    // Extract rating keys from pre-existing collections
    if (settings.plex.preExistingCollectionConfigs) {
      for (const config of settings.plex.preExistingCollectionConfigs) {
        if (config.collectionRatingKey) {
          collectionRatingKeys.push(config.collectionRatingKey);
        }
      }
    }

    logger.info('Getting collection statistics', {
      label: 'Dashboard API',
      agregarrCollections: settings.plex.collectionConfigs?.length || 0,
      preExistingCollections:
        settings.plex.preExistingCollectionConfigs?.length || 0,
      ratingKeysFound: collectionRatingKeys.length,
      ratingKeys: collectionRatingKeys,
    });

    if (collectionRatingKeys.length === 0) {
      logger.warn('No collections with rating keys found', {
        label: 'Dashboard API',
      });
      return res.status(200).json({
        collections: [],
        metadata: {
          limit: Number(limit),
          statType,
          days: Number(days),
          timestamp: new Date().toISOString(),
        },
      });
    }

    const tautulli = new TautulliAPI(settings.tautulli);
    const collections = await tautulli.getTopCollections(
      Number(limit),
      statType as 'plays' | 'duration',
      Number(days),
      collectionRatingKeys
    );

    res.status(200).json({
      collections,
      metadata: {
        limit: Number(limit),
        statType,
        days: Number(days),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Failed to get collection statistics', {
      label: 'Dashboard API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get collection statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/dashboard/collections/:ratingKey
 * Get detailed statistics for a specific collection
 */
dashboardRoutes.get(
  '/collections/:ratingKey',
  isAuthenticated(),
  async (req, res) => {
    try {
      const settings = getSettings();
      const { ratingKey } = req.params;
      const { days = '1,7,30,0' } = req.query;

      if (!settings.tautulli.hostname || !settings.tautulli.apiKey) {
        return res.status(400).json({
          error: 'Tautulli not configured',
          message:
            'Tautulli settings are required to fetch collection statistics',
        });
      }

      const tautulli = new TautulliAPI(settings.tautulli);
      const collectionStats = await tautulli.getCollectionStats(
        ratingKey,
        String(days)
      );

      res.status(200).json({
        collection: collectionStats,
        metadata: {
          ratingKey,
          queryDays: String(days),
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Failed to get collection statistics', {
        label: 'Dashboard API',
        error: error instanceof Error ? error.message : String(error),
        ratingKey: req.params.ratingKey,
      });

      res.status(500).json({
        error: 'Failed to get collection statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * GET /api/v1/dashboard/activity
 * Get recent activity and general statistics
 */
dashboardRoutes.get('/activity', isAuthenticated(), async (req, res) => {
  try {
    const settings = getSettings();
    const { days = 7, limit = 10 } = req.query;

    if (!settings.tautulli.hostname || !settings.tautulli.apiKey) {
      return res.status(400).json({
        error: 'Tautulli not configured',
        message: 'Tautulli settings are required to fetch activity statistics',
      });
    }

    const tautulli = new TautulliAPI(settings.tautulli);

    // Get various activity stats
    const [topMovies, topTV, info] = await Promise.all([
      tautulli.getHomeStats(Number(days), 'plays', 'top_movies', Number(limit)),
      tautulli.getHomeStats(Number(days), 'plays', 'top_tv', Number(limit)),
      tautulli.getInfo().catch(() => null),
    ]);

    res.status(200).json({
      activity: {
        topMovies,
        topTV,
      },
      tautulliInfo: info,
      metadata: {
        days: Number(days),
        limit: Number(limit),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Failed to get activity statistics', {
      label: 'Dashboard API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get activity statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default dashboardRoutes;
