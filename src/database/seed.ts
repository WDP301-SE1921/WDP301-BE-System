import { existsSync } from 'node:fs';
import { PrismaClient, type UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const PASSWORD_HASH_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;

interface SeedAccount {
  role: UserRole;
  envKey: string;
  defaultEmail: string;
  displayName: string;
}

const ACCOUNTS: SeedAccount[] = [
  {
    role: 'MANAGER',
    envKey: 'SEED_MANAGER_EMAIL',
    defaultEmail: 'manager@edugrade.local',
    displayName: 'Quản lý trung tâm',
  },
  {
    role: 'STAFF',
    envKey: 'SEED_STAFF_EMAIL',
    defaultEmail: 'staff@edugrade.local',
    displayName: 'Nhân viên',
  },
  {
    role: 'TEACHER',
    envKey: 'SEED_TEACHER_EMAIL',
    defaultEmail: 'teacher@edugrade.local',
    displayName: 'Giáo viên',
  },
  {
    role: 'CURRICULUM_DESIGNER',
    envKey: 'SEED_CURRICULUM_DESIGNER_EMAIL',
    defaultEmail: 'designer@edugrade.local',
    displayName: 'Thiết kế giáo trình',
  },
  {
    role: 'PARENT',
    envKey: 'SEED_PARENT_EMAIL',
    defaultEmail: 'parent@edugrade.local',
    displayName: 'Phụ huynh',
  },
];

function loadEnvFile(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

function readPassword(): string {
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password || password.length < 8)
    throw new Error('Set SEED_DEFAULT_PASSWORD (at least 8 characters) before seeding.');
  if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES)
    throw new Error('SEED_DEFAULT_PASSWORD must be at most 72 UTF-8 bytes.');
  return password;
}

/** Creates one account per role. Existing emails are left untouched, so re-running is safe. */
async function seed(): Promise<void> {
  loadEnvFile();
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true')
    throw new Error(
      'Refusing to seed default accounts in production without SEED_ALLOW_PRODUCTION=true.',
    );
  const passwordHash = await bcrypt.hash(readPassword(), PASSWORD_HASH_ROUNDS);
  const prisma = new PrismaClient();
  try {
    for (const account of ACCOUNTS) {
      const email = (process.env[account.envKey]?.trim() || account.defaultEmail).toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        console.log(
          `skip    ${account.role.padEnd(20)} ${email} (already exists as ${existing.role})`,
        );
        continue;
      }
      await prisma.user.create({
        data: {
          email,
          passwordHash,
          displayName: account.displayName,
          role: account.role,
          status: 'ACTIVE',
          // Seeded accounts must be able to act immediately; there is no mailbox to verify.
          emailVerifiedAt: new Date(),
          ...(account.role === 'PARENT' ? { parentProfile: { create: {} } } : {}),
        },
      });
      console.log(`created ${account.role.padEnd(20)} ${email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
