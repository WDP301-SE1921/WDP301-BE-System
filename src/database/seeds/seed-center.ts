import type { Prisma, PrismaClient } from '@prisma/client';

import { CENTER_PROFILE_ID, type CenterContact } from '../../modules/center/center-profile';

/**
 * Demo contact details. The phone uses the 0123 prefix retired in 2018 and the email a .local domain,
 * so the demo never reaches a real business; set CENTER_* for real values.
 */
export const DEMO_CENTER_CONTACT: CenterContact = {
  name: 'Trung tâm bồi dưỡng văn hóa EduGrade',
  address: '123 Đường Số 1, Phường 1, TP. Hồ Chí Minh',
  phone: '0123 456 789',
  email: 'lienhe@edugrade.local',
  openingHours: 'Thứ 2 – Chủ nhật, 7:30 – 21:00',
};

/**
 * Creates the center row (demo values in demo mode) and writes the CENTER_* values that are set, so
 * re-running the seed updates the contact details without touching anything else.
 */
export async function seedCenterProfile(
  db: PrismaClient | Prisma.TransactionClient,
  fromEnv: Partial<CenterContact>,
  demo: boolean,
): Promise<CenterContact> {
  const profile = await db.centerProfile.upsert({
    where: { id: CENTER_PROFILE_ID },
    create: { id: CENTER_PROFILE_ID, ...(demo ? DEMO_CENTER_CONTACT : {}), ...fromEnv },
    update: fromEnv,
  });
  return {
    name: profile.name,
    address: profile.address,
    phone: profile.phone,
    email: profile.email,
    openingHours: profile.openingHours,
  };
}
