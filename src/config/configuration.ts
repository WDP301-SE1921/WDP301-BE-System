export type NodeEnvironment = 'development' | 'test' | 'production';

export interface AppConfiguration {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
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

export function validateEnvironment(environment: Environment): AppConfiguration {
  const nodeEnv = parseNodeEnvironment(environment.NODE_ENV);
  const corsOrigins = required(environment, 'CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (nodeEnv === 'production' && corsOrigins.some((origin) => origin === '*')) {
    throw new Error('CORS_ORIGINS cannot contain a wildcard in production');
  }

  return {
    nodeEnv,
    port: parsePort(environment.PORT),
    databaseUrl: required(environment, 'DATABASE_URL'),
    corsOrigins,
    swaggerEnabled: parseBoolean(environment.SWAGGER_ENABLED, nodeEnv !== 'production'),
  };
}
