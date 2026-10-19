import Button from '@app/components/Common/Button';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  jellyfinUrl: 'Jellyfin Server URL',
  username: 'Username',
  password: 'Password',
  signinwithjellyfin: 'Sign in with Jellyfin',
  signingin: 'Signing In…',
  loginerror: 'Sign-in failed. Only Jellyfin administrators can sign in.',
});

interface JellyfinLoginProps {
  // First-run setup: the server URL is not known yet
  showUrl?: boolean;
}

const JellyfinLogin = ({ showUrl = false }: JellyfinLoginProps) => {
  const intl = useIntl();
  const { revalidate } = useUser();

  return (
    <Formik
      initialValues={{ url: '', username: '', password: '' }}
      onSubmit={async (values, { setStatus }) => {
        setStatus(undefined);
        try {
          const response = await axios.post('/api/v1/auth/jellyfin', {
            username: values.username,
            password: values.password,
            ...(showUrl && { url: values.url }),
          });
          if (response.data?.id) {
            revalidate();
          }
        } catch (e) {
          setStatus(
            e.response?.data?.message ?? intl.formatMessage(messages.loginerror)
          );
        }
      }}
    >
      {({ handleSubmit, isSubmitting, status, values }) => (
        <form onSubmit={handleSubmit}>
          {status && (
            <div className="mb-4 rounded-md bg-red-600 p-3 text-sm text-red-100">
              {status}
            </div>
          )}
          {showUrl && (
            <div className="form-row">
              <label htmlFor="url" className="text-label">
                {intl.formatMessage(messages.jellyfinUrl)}
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <Field
                    id="url"
                    name="url"
                    type="text"
                    inputMode="url"
                    placeholder="http://jellyfin:8096"
                  />
                </div>
              </div>
            </div>
          )}
          <div className="form-row">
            <label htmlFor="username" className="text-label">
              {intl.formatMessage(messages.username)}
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <Field
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                />
              </div>
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="password" className="text-label">
              {intl.formatMessage(messages.password)}
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <Field
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <Button
              buttonType="primary"
              type="submit"
              disabled={
                isSubmitting || !values.username || (showUrl && !values.url)
              }
            >
              {isSubmitting
                ? intl.formatMessage(messages.signingin)
                : intl.formatMessage(messages.signinwithjellyfin)}
            </Button>
          </div>
        </form>
      )}
    </Formik>
  );
};

export default JellyfinLogin;
