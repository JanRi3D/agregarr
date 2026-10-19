import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const authRoutes = Router();

authRoutes.get('/me', isAuthenticated(), async (req, res) => {
  const userRepository = getRepository(User);
  if (!req.user) {
    return res.status(500).json({
      status: 500,
      error: 'Please sign in.',
    });
  }
  const user = await userRepository.findOneOrFail({
    where: { id: req.user.id },
  });

  return res.status(200).json(user);
});

authRoutes.post('/plex', async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const body = req.body as { authToken?: string };

  if (!body.authToken) {
    return next({
      status: 500,
      message: 'Authentication token required.',
    });
  }
  try {
    // First we need to use this auth token to get the user's email from plex.tv
    const plextv = new PlexTvAPI(body.authToken);
    const account = await plextv.getUser();

    // Next let's see if the user already exists
    let user = await userRepository
      .createQueryBuilder('user')
      .where('user.plexId = :id', { id: account.id })
      .orWhere('user.email = :email', {
        email: account.email.toLowerCase(),
      })
      .getOne();

    if (!user && !(await userRepository.count())) {
      user = new User({
        email: account.email,
        plexUsername: account.username,
        plexId: account.id,
        plexToken: account.authToken,
        permissions: Permission.ADMIN,
        avatar: account.thumb,
        plexTitle: account.title,
        hasPlexPass: account.roles?.roles?.includes('plexpass') || false,
        userType: UserType.PLEX,
      });

      await userRepository.save(user);

      // Store admin Plex info in settings for template variables
      const settings = getSettings();
      settings.updateAdminPlexInfo(account.username, account.title);
    } else {
      const mainUser = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true, plexId: true, email: true },
        where: { id: 1 },
      });
      const mainPlexTv = new PlexTvAPI(mainUser.plexToken ?? '');

      if (!account.id) {
        logger.error('Plex ID was missing from Plex.tv response', {
          label: 'API',
          ip: req.ip,
          email: account.email,
          plexUsername: account.username,
        });

        return next({
          status: 500,
          message: 'Something went wrong. Try again.',
        });
      }

      if (
        account.id === mainUser.plexId ||
        (account.email === mainUser.email && !mainUser.plexId) ||
        (await mainPlexTv.checkUserAccess(account.id))
      ) {
        if (user) {
          if (!user.plexId) {
            logger.info(
              'Found matching Plex user; updating user with Plex data',
              {
                label: 'API',
                ip: req.ip,
                email: user.email,
                userId: user.id,
                plexId: account.id,
                plexUsername: account.username,
              }
            );
          }

          user.plexToken = body.authToken;
          user.plexId = account.id;
          user.avatar = account.thumb;
          user.email = account.email;
          user.plexUsername = account.username;
          user.plexTitle = account.title;
          user.hasPlexPass =
            account.roles?.roles?.includes('plexpass') || false;
          user.userType = UserType.PLEX;

          await userRepository.save(user);

          // If this is the admin user, update settings for template variables
          if (user.id === 1) {
            const settings = getSettings();
            settings.updateAdminPlexInfo(account.username, account.title);
          }
        } else if (!settings.main.newPlexLogin) {
          logger.warn(
            'Failed sign-in attempt by unimported Plex user with access to the media server',
            {
              label: 'API',
              ip: req.ip,
              email: account.email,
              plexId: account.id,
              plexUsername: account.username,
            }
          );
          return next({
            status: 403,
            message: 'Access denied.',
          });
        } else {
          logger.info(
            'Sign-in attempt from Plex user with access to the media server; creating new Overseerr user',
            {
              label: 'API',
              ip: req.ip,
              email: account.email,
              plexId: account.id,
              plexUsername: account.username,
            }
          );
          user = new User({
            email: account.email,
            plexUsername: account.username,
            plexId: account.id,
            plexToken: account.authToken,
            avatar: account.thumb,
            plexTitle: account.title,
            hasPlexPass: account.roles?.roles?.includes('plexpass') || false,
            userType: UserType.PLEX,
          });

          await userRepository.save(user);
        }
      } else {
        logger.warn(
          'Failed sign-in attempt by Plex user without access to the media server',
          {
            label: 'API',
            ip: req.ip,
            email: account.email,
            plexId: account.id,
            plexUsername: account.username,
          }
        );
        return next({
          status: 403,
          message: 'Access denied.',
        });
      }
    }

    // Set logged in session
    if (req.session) {
      req.session.userId = user.id;
    }

    return res.status(200).json(user?.filter() ?? {});
  } catch (e) {
    logger.error('Something went wrong authenticating with Plex account', {
      label: 'API',
      errorMessage: e.message,
      ip: req.ip,
    });
    return next({
      status: 500,
      message: 'Unable to authenticate.',
    });
  }
});

/**
 * Sign in with a Jellyfin administrator account. The first sign-in (setup)
 * also supplies the server URL and switches Agregarr to Jellyfin mode.
 */
authRoutes.post('/jellyfin', async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const body = req.body as {
    username?: string;
    password?: string;
    url?: string;
  };
  const isSetup = !(await userRepository.count());
  const url = isSetup ? body.url : settings.jellyfin.url;

  if (!body.username || !url) {
    return next({ status: 400, message: 'Username and server URL required.' });
  }

  let account;
  try {
    account = await JellyfinAPI.authenticateByName(
      url,
      body.username,
      body.password ?? ''
    );
  } catch (e) {
    logger.warn('Failed Jellyfin sign-in attempt', {
      label: 'API',
      ip: req.ip,
      username: body.username,
      errorMessage: e.message,
    });
    return next({ status: 403, message: 'Invalid Jellyfin credentials.' });
  }

  // Every signed-in Agregarr user has full control, so only admins get in
  if (!account.User.Policy?.IsAdministrator) {
    return next({ status: 403, message: 'Access denied.' });
  }

  try {
    let user = await userRepository.findOne({
      where: { jellyfinUserId: account.User.Id },
    });

    if (!user) {
      if (!isSetup && settings.main.mediaServerType !== 'jellyfin') {
        return next({ status: 403, message: 'Access denied.' });
      }
      user = new User({
        // email is required and unique; Jellyfin users don't have one
        email: `${account.User.Id}@jellyfin.local`,
        username: account.User.Name,
        jellyfinUserId: account.User.Id,
        permissions: Permission.ADMIN,
        avatar: '',
        userType: UserType.JELLYFIN,
      });
    }
    user.username = account.User.Name;
    await userRepository.save(user);

    if (isSetup) {
      settings.main.mediaServerType = 'jellyfin';
      settings.jellyfin.url = url;
      settings.updateAdminPlexInfo(account.User.Name, account.User.Name);
      settings.save();
    }

    if (req.session) {
      req.session.userId = user.id;
    }

    return res.status(200).json(user.filter());
  } catch (e) {
    logger.error('Something went wrong signing in with Jellyfin', {
      label: 'API',
      errorMessage: e.message,
      ip: req.ip,
    });
    return next({ status: 500, message: 'Unable to authenticate.' });
  }
});

authRoutes.post('/logout', (req, res, next) => {
  req.session?.destroy((err) => {
    if (err) {
      return next({
        status: 500,
        message: 'Something went wrong.',
      });
    }

    return res.status(200).json({ status: 'ok' });
  });
});

// Password reset routes removed - Agregarr uses Plex-only authentication

export default authRoutes;
