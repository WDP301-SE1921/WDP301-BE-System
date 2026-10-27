export type NodeEnvironment = 'development' | 'test' | 'production';

export interface AppConfiguration {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  webOrigin: string;
  swaggerEnabled: boolean;
  throttleLimitPerMinute: number;
  academic: {
    aiUrl: string;
    aiKey: string;
    aiModel: string;
    storageEndpoint: string;
    storageRegion: string;
    storageBucket: string;
    storageKey: string;
    storageSecret: string;
    storagePublicEndpoint: string;
    smtpUrl: string;
    mailFrom: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
}

type Environment = Record<string, string | undefined>;

function required(environment: Environment, key: string): string {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parsePort(rawValue: string | undefined): number {
  const value = Number(rawValue ?? '3000');
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return value;
}

function parseNodeEnvironment(rawValue: string | undefined): NodeEnvironment {
  const value = rawValue ?? 'development';
  if (value !== 'development' && value !== 'test' && value !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  return value;
}

function parseBoolean(rawValue: string | undefined, defaultValue: boolean): boolean {
  if (rawValue === undefined) return defaultValue;
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  throw new Error('SWAGGER_ENABLED must be true or false');
}

function parsePositiveInteger(environment: Environment, key: string, defaultValue: number): number {
  const value = Number(environment[key] ?? defaultValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function requiredSecret(environment: Environment, key: string): string {
  const value = required(environment, key);
  if (value.length < 32) {
    throw new Error(`${key} must be at least 32 characters`);
  }
  return value;
}

export function validateEnvironment(environment: Environment): AppConfiguration {
  const nodeEnv = parseNodeEnvironment(environment.NODE_ENV);
  const corsOrigins = required(environment, 'CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (nodeEnv === 'production' && corsOrigins.some((origin) => origin === '*')) {
    throw new Error('CORS_ORIGINS cannot contain a wildcard in production');
  }
  const webOrigin = environment.WEB_ORIGIN?.trim() || corsOrigins[0];
  if (!webOrigin || !/^https?:$/.test(new URL(webOrigin).protocol)) {
    throw new Error('WEB_ORIGIN must be an HTTP(S) origin');
  }

  return {
    nodeEnv,
    port: parsePort(environment.PORT),
    databaseUrl: required(environment, 'DATABASE_URL'),
    corsOrigins,
    webOrigin: new URL(webOrigin).origin,
    swaggerEnabled: parseBoolean(environment.SWAGGER_ENABLED, nodeEnv !== 'production'),
    throttleLimitPerMinute: parsePositiveInteger(environment, 'THROTTLE_LIMIT_PER_MINUTE', 120),
    academic: {
      aiUrl: environment.AI_CHAT_URL?.trim() || '',
      aiKey: environment.AI_API_KEY?.trim() || '',
      aiModel: environment.AI_MODEL?.trim() || '',
      storageEndpoint: environment.STORAGE_ENDPOINT?.trim() || '',
      storageRegion: environment.STORAGE_REGION?.trim() || 'us-east-1',
      storageBucket: environment.STORAGE_BUCKET?.trim() || '',
      storageKey: environment.STORAGE_ACCESS_KEY?.trim() || '',
      storageSecret: environment.STORAGE_SECRET_KEY?.trim() || '',
      storagePublicEndpoint: environment.STORAGE_PUBLIC_ENDPOINT?.trim() || environment.STORAGE_ENDPOINT?.trim() || '',
      smtpUrl: environment.SMTP_URL?.trim() || '',
      mailFrom: environment.MAIL_FROM?.trim() || '',
    },
    jwt: {
      accessSecret: requiredSecret(environment, 'JWT_ACCESS_SECRET'),
      refreshSecret: requiredSecret(environment, 'JWT_REFRESH_SECRET'),
      issuer: environment.JWT_ISSUER?.trim() || 'edugrade-api',
      audience: environment.JWT_AUDIENCE?.trim() || 'edugrade-clients',
      accessTtlSeconds: parsePositiveInteger(environment, 'JWT_ACCESS_TTL_SECONDS', 900),
      refreshTtlSeconds: parsePositiveInteger(environment, 'JWT_REFRESH_TTL_SECONDS', 604800),
    },
  };
}
