import { createHash } from 'node:crypto';
import { routes, validateRoutes } from './routes.mjs';

function localOrigin(address) {
  return `http://${address}`;
}

export function renderPreview(manifest) {
  validateRoutes(routes);
  const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const api = manifest.public.apiOrigin;
  const go = localOrigin(manifest.internal.identity);
  const team = manifest.internal.team.split(':').at(-1);
  const lite = manifest.internal.litellmProxy.split(':').at(-1);
  const consolePort = manifest.internal.litellmConsole.split(':').at(-1);
  return {
    schemaVersion: 'od0-preview-v1',
    manifestSha256: digest,
    environment: manifest.environment,
    deploymentReady: false,
    pending: ['OD.1 real-domain installed acceptance', 'OD.2 real DNS/TLS and public network acceptance', 'OD.3 real private-host and research acceptance', 'OD.4 Linux model deployment acceptance', 'OD.5 signed merchant and live payment acceptance', 'OD.6 off-host restore and three-platform acceptance', 'OD.7 staged production receipts and human release approval'],
    public: { ...manifest.public, wechatNotifyUrl: api + '/v1/payments/wechat/notify' },
    partialEnvironment: {
      identityGo: {
        MATERIALSX_ENV: manifest.environment === 'development' ? 'development' : 'production',
        MATERIALSX_IDENTITY_ADDR: manifest.internal.identity,
        MATERIALSX_TRUSTED_PROXY_CIDRS: manifest.environment === 'development' ? '' : '127.0.0.1/32,::1/128',
        MATERIALSX_IDENTITY_PUBLIC_URL: api,
        MATERIALSX_BILLING_ADMIN_PUBLIC_URL: manifest.public.adminOrigin,
        MATERIALSX_LITELLM_URL: localOrigin(manifest.internal.litellmProxy),
        MATERIALSX_PUBLIC_HOST: new URL(api).hostname,
        MATERIALSX_PAYMENT_MODE: manifest.payment.mode,
        MATERIALSX_CLOUD_MODE: manifest.cloud?.mode ?? (manifest.payment.mode === 'wechat-native' ? 'mx-production' : 'disabled'),
        MATERIALSX_MX03_GATEWAY_MODE: manifest.payment.mode === 'wechat-native' ? 'wallet-production' : '',
        MATERIALSX_MX03_PAYMENT_MODE: manifest.payment.mode === 'wechat-native' ? 'wechat-production' : '',
        MATERIALSX_MX03_PRICE_VERSION: manifest.payment.releaseId ?? '',
        MATERIALSX_DEV_MODE: manifest.development.enableDevRoutes ? '1' : '0',
        MATERIALSX_LOCAL_DISABLE_ADMIN_TOTP: manifest.development.disableAdminTotp ? '1' : '0',
      },
      billingWeb: {
        NODE_ENV: manifest.environment === 'development' ? 'development' : 'production',
        MATERIALSX_BILLING_ADMIN_PUBLIC_URL: manifest.public.adminOrigin,
        MATERIALSX_BILLING_GO_ORIGIN: go,
        MATERIALSX_BILLING_WEB_ADDRESS: manifest.internal.billingWeb,
      },
      teamResearch: {
        MATERIALSX_TEAM_PUBLIC_ORIGIN: api,
        MATERIALSX_IDENTITY_URL: api,
        MATERIALSX_TEAM_PORT: team,
        MATERIALSX_TEAM_DEVELOPMENT: manifest.environment === 'development' ? '1' : '0',
        MATERIALSX_TEAM_TRUSTED_LOOPBACK_PROXY: manifest.environment === 'development' ? '0' : '1',
        MATERIALSX_MOOS_ORIGIN: localOrigin(manifest.internal.moosApi),
      },
      ...(manifest.researchData?.mode === 'private-mtls' ? {
        moosLinkClient: {
          MATERIALSX_MOOS_LINK_LOCAL: manifest.internal.moosApi,
          MATERIALSX_MOOS_LINK_REMOTE: manifest.researchData.linkAddress,
          MATERIALSX_MOOS_LINK_SERVER_NAME: manifest.researchData.serverName,
        },
        moosLinkServer: {
          MATERIALSX_MOOS_LINK_LISTEN: manifest.researchData.linkAddress,
          MATERIALSX_MOOS_LINK_UPSTREAM: manifest.researchData.moosHostApi,
        },
      } : {}),
      liteLLM: { MX_LITELLM_PORT: lite, MX_CONSOLE_PORT: consolePort },
      // The static builder only accepts HTTPS for sitemap/canonical URLs.
      website: manifest.environment === 'development' ? {} : { SITE_ORIGIN: manifest.public.siteOrigin },
      desktopClient: { schemaVersion: 1, apiOrigin: api, releaseChannel: manifest.releaseChannel, websiteOrigin: manifest.public.siteOrigin },
    },
    routes: routes.map(route => ({ ...route })),
    missingPrivateConfiguration: [
      'PostgreSQL DSNs and restricted roles', 'identity master key', 'LiteLLM gateway/master keys',
      'supplier credentials', 'billing proxy token', 'MOOS MCP directory and private link certificates',
      ...(manifest.environment === 'staging' && manifest.cloud?.mode === 'alpha' ? ['staging alpha route verification and isolated test account grant'] : []),
      'TLS certificates and trusted proxy CIDRs', 'SMTP credentials', 'WeChat merchant credentials',
      'MX production approval file and six private evidence files',
    ],
  };
}
