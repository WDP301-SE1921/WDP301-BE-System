import { createHash } from 'node:crypto';
import type { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { demoId } from './seed-calendar';

interface AccountDefinition {
  key: string;
  role: UserRole;
  email: string;
  displayName: string;
  envKey?: string;
  status?: UserStatus;
  unverified?: boolean;
}

const BASE_ACCOUNTS: AccountDefinition[] = [
  {
    key: 'manager',
    role: 'MANAGER',
    envKey: 'SEED_MANAGER_EMAIL',
    email: 'manager@edugrade.local',
    displayName: 'Nguyễn Hoàng - Quản lý',
  },
  {
    key: 'staff',
    role: 'STAFF',
    envKey: 'SEED_STAFF_EMAIL',
    email: 'staff@edugrade.local',
    displayName: 'Trần Mai - Nhân viên',
  },
  {
    key: 'teacher',
    role: 'TEACHER',
    envKey: 'SEED_TEACHER_EMAIL',
    email: 'teacher@edugrade.local',
    displayName: 'Nguyễn Minh Đức - Giáo viên Toán',
  },
  {
    key: 'designer',
    role: 'CURRICULUM_DESIGNER',
    envKey: 'SEED_CURRICULUM_DESIGNER_EMAIL',
    email: 'designer@edugrade.local',
    displayName: 'Lê Thu Hương - Thiết kế giáo trình',
  },
  {
    key: 'parent',
    role: 'PARENT',
    envKey: 'SEED_PARENT_EMAIL',
    email: 'parent@edugrade.local',
    displayName: 'Nguyễn Văn Nam',
  },
];

const DEMO_ACCOUNTS: AccountDefinition[] = [
  {
    key: 'physics-teacher',
    role: 'TEACHER',
    email: 'teacher.physics@edugrade.local',
    displayName: 'Trần Quang Huy - Giáo viên Vật lý',
  },
  {
    key: 'chemistry-teacher',
    role: 'TEACHER',
    email: 'teacher.chemistry@edugrade.local',
    displayName: 'Phạm Ngọc Lan - Giáo viên Hóa học',
  },
  {
    key: 'biology-teacher',
    role: 'TEACHER',
    email: 'teacher.biology@edugrade.local',
    displayName: 'Võ Thanh Hà - Giáo viên Sinh học',
  },
  {
    key: 'substitute-teacher',
    role: 'TEACHER',
    email: 'teacher.substitute@edugrade.local',
    displayName: 'Đỗ Tuấn Anh - Giáo viên dạy thay',
  },
  {
    key: 'designer-2',
    role: 'CURRICULUM_DESIGNER',
    email: 'designer.science@edugrade.local',
    displayName: 'Bùi Hải Yến - Giáo trình Khoa học',
  },
  {
    key: 'staff-disabled',
    role: 'STAFF',
    email: 'staff.disabled@edugrade.local',
    displayName: 'Nhân viên đã khóa',
    status: 'DISABLED',
  },
  {
    key: 'parent-2',
    role: 'PARENT',
    email: 'parent.2@edugrade.local',
    displayName: 'Trần Thị Hạnh',
  },
  {
    key: 'parent-3',
    role: 'PARENT',
    email: 'parent.3@edugrade.local',
    displayName: 'Lê Văn Thành',
  },
  {
    key: 'parent-4',
    role: 'PARENT',
    email: 'parent.4@edugrade.local',
    displayName: 'Phạm Thu Trang',
  },
  { key: 'parent-5', role: 'PARENT', email: 'parent.5@edugrade.local', displayName: 'Võ Ngọc Mai' },
  {
    key: 'parent-empty',
    role: 'PARENT',
    email: 'parent.empty@edugrade.local',
    displayName: 'Phụ huynh chưa có hồ sơ con',
  },
  {
    key: 'parent-disabled',
    role: 'PARENT',
    email: 'parent.disabled@edugrade.local',
    displayName: 'Phụ huynh đã khóa',
    status: 'DISABLED',
  },
  {
    key: 'parent-unverified',
    role: 'PARENT',
    email: 'parent.unverified@edugrade.local',
    displayName: 'Phụ huynh chưa xác minh email',
    unverified: true,
  },
  {
    key: 'candidate-pending',
    role: 'TEACHER',
    email: 'candidate.pending@edugrade.local',
    displayName: 'Giáo viên chờ phê duyệt',
    status: 'DISABLED',
  },
  {
    key: 'candidate-rejected',
    role: 'TEACHER',
    email: 'candidate.rejected@edugrade.local',
    displayName: 'Hồ sơ giáo viên bị từ chối',
    status: 'DISABLED',
  },
];

export type SeedUsers = Record<string, User>;

/** Validate fresh account settings before a destructive reset can begin. */
export function validateSeedAccountEmails(includeDemo: boolean, env: NodeJS.ProcessEnv): void {
  const definitions = includeDemo ? [...BASE_ACCOUNTS, ...DEMO_ACCOUNTS] : BASE_ACCOUNTS;
  const seen = new Set<string>();
  for (const account of definitions) {
    const email = (
      account.envKey ? env[account.envKey]?.trim() || account.email : account.email
    ).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error(`Invalid seed account email for ${account.role}.`);
    if (seen.has(email)) throw new Error(`Seed account emails must be distinct: ${email}`);
    seen.add(email);
  }
}

export async function seedAccounts(
  tx: Prisma.TransactionClient,
  passwordHash: string,
  includeDemo: boolean,
  at: Date,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedUsers> {
  const definitions = includeDemo ? [...BASE_ACCOUNTS, ...DEMO_ACCOUNTS] : BASE_ACCOUNTS;
  const users: SeedUsers = {};
  const seen = new Set<string>();
  for (const account of definitions) {
    const email = (
      account.envKey ? env[account.envKey]?.trim() || account.email : account.email
    ).toLowerCase();
    if (seen.has(email)) throw new Error(`Seed account emails must be distinct: ${email}`);
    seen.add(email);
    const emailKey = createHash('sha256').update(email).digest('hex').slice(0, 16);
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: {
        id: demoId(`user_${account.key}_${emailKey}`),
        email,
        passwordHash,
        displayName: account.displayName,
        role: account.role,
        status: account.status ?? 'ACTIVE',
        emailVerifiedAt: account.unverified ? null : at,
        createdAt: at,
      },
    });
    if (user.role !== account.role)
      throw new Error(
        `Seed email ${email} belongs to ${user.role}, expected ${account.role}. Existing accounts were not changed.`,
      );
    users[account.key] = user;
    if (user.role === 'PARENT') {
      await tx.parentProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          id: demoId(`parent_${account.key}_${emailKey}`),
          userId: user.id,
          phone: `090${String(definitions.indexOf(account) + 1).padStart(7, '0')}`,
          createdAt: at,
        },
      });
    }
  }
  return users;
}
