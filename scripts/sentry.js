const SentryCli = require('@sentry/cli');
const dotenv = require('dotenv');
dotenv.config();

async function createReleaseAndUpload() {
  const release = import.meta.env.VITE_SENTRY_RELEASE;
  const environment = import.meta.env.VITE_SENTRY_ENV;

  if (!release || !environment) {
    console.warn('VITE_SENTRY_RELEASE or VITE_SENTRY_ENV is not set');
    return;
  }

  const cli = new SentryCli();

  try {
    console.log('Creating sentry release ' + release);
    await cli.releases.new(release);

    console.log('Uploading source maps');
    await cli.releases.uploadSourceMaps(release, {
      include: ['build/static/js'],
      rewrite: true,
      validate: true,
    });

    console.log('Finalizing release');
    // await cli.releases.setCommits(release, {auto: true})
    await cli.releases.newDeploy(release, { env: environment });

    await cli.releases.finalize(release);
  } catch (e) {
    console.error('Creating a release on Sentry failed.', e);
  }
}

createReleaseAndUpload();
