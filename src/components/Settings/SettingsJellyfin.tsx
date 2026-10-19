import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import globalMessages from '@app/i18n/globalMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type { JellyfinSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages({
  jellyfin: 'Jellyfin',
  jellyfinsettings: 'Jellyfin Settings',
  jellyfinsettingsDescription:
    'Configure the connection to your Jellyfin server. Agregarr creates and manages Collections on your Jellyfin server.',
  jellyfinUrl: 'Server URL',
  jellyfinApiKey: 'API Key',
  jellyfinApiKeyTip:
    'Create one in the Jellyfin Dashboard under Advanced → API Keys',
  validationJellyfinUrl: 'You must provide a valid URL',
  validationJellyfinApiKey: 'You must provide an API key',
  toastJellyfinConnecting: 'Attempting to connect to Jellyfin…',
  toastJellyfinConnectingSuccess:
    'Jellyfin connection established successfully!',
  toastJellyfinConnectingFailure: 'Failed to connect to Jellyfin.',
});

interface SettingsJellyfinProps {
  onComplete?: () => void;
}

const SettingsJellyfin = ({ onComplete }: SettingsJellyfinProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, error, mutate } = useSWR<JellyfinSettings>(
    '/api/v1/settings/jellyfin'
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  const JellyfinSettingsSchema = Yup.object().shape({
    url: Yup.string()
      .required(intl.formatMessage(messages.validationJellyfinUrl))
      .matches(
        /^https?:\/\/[^\s/]+/i,
        intl.formatMessage(messages.validationJellyfinUrl)
      ),
    apiKey: Yup.string().required(
      intl.formatMessage(messages.validationJellyfinApiKey)
    ),
  });

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.jellyfin),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.jellyfinsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.jellyfinsettingsDescription)}
        </p>
      </div>
      <Formik
        initialValues={{ url: data?.url ?? '', apiKey: data?.apiKey ?? '' }}
        validationSchema={JellyfinSettingsSchema}
        onSubmit={async (values) => {
          addToast(intl.formatMessage(messages.toastJellyfinConnecting), {
            autoDismiss: true,
            appearance: 'info',
          });
          try {
            await axios.post('/api/v1/settings/jellyfin', values);
            mutate();
            addToast(
              intl.formatMessage(messages.toastJellyfinConnectingSuccess),
              { autoDismiss: true, appearance: 'success' }
            );
            onComplete?.();
          } catch (e) {
            addToast(
              intl.formatMessage(messages.toastJellyfinConnectingFailure),
              { autoDismiss: true, appearance: 'error' }
            );
          }
        }}
      >
        {({ errors, touched, handleSubmit, isSubmitting, isValid }) => (
          <form className="section" onSubmit={handleSubmit}>
            <div className="form-row">
              <label htmlFor="url" className="text-label">
                {intl.formatMessage(messages.jellyfinUrl)}
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <Field
                    type="text"
                    inputMode="url"
                    id="url"
                    name="url"
                    placeholder="http://jellyfin:8096"
                  />
                </div>
                {errors.url && touched.url && (
                  <div className="error">{errors.url}</div>
                )}
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="apiKey" className="text-label">
                {intl.formatMessage(messages.jellyfinApiKey)}
                <span className="label-required">*</span>
                <span className="label-tip">
                  {intl.formatMessage(messages.jellyfinApiKeyTip)}
                </span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <Field
                    type="password"
                    id="apiKey"
                    name="apiKey"
                    autoComplete="off"
                  />
                </div>
                {errors.apiKey && touched.apiKey && (
                  <div className="error">{errors.apiKey}</div>
                )}
              </div>
            </div>
            <div className="actions">
              <div className="flex justify-end">
                <span className="ml-3 inline-flex rounded-md shadow-sm">
                  <Button
                    buttonType="primary"
                    type="submit"
                    disabled={isSubmitting || !isValid}
                  >
                    <ArrowDownOnSquareIcon />
                    <span>
                      {isSubmitting
                        ? intl.formatMessage(globalMessages.saving)
                        : intl.formatMessage(globalMessages.save)}
                    </span>
                  </Button>
                </span>
              </div>
            </div>
          </form>
        )}
      </Formik>
    </>
  );
};

export default SettingsJellyfin;
