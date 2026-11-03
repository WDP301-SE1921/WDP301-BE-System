/** The center is single-tenant: its contact details live in one `center_profiles` row. */
export const CENTER_PROFILE_ID = 'default';

export interface CenterContact {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  openingHours: string | null;
}

/** Environment variable of each contact field, applied by `pnpm seed`. */
export const CENTER_CONTACT_ENV: Record<keyof CenterContact, string> = {
  name: 'CENTER_NAME',
  address: 'CENTER_ADDRESS',
  phone: 'CENTER_PHONE',
  email: 'CENTER_EMAIL',
  openingHours: 'CENTER_OPENING_HOURS',
};

/** CENTER_* values that are set and not blank; missing ones are left out. */
export function centerContactFromEnv(env: NodeJS.ProcessEnv): Partial<CenterContact> {
  const contact: Partial<CenterContact> = {};
  for (const [field, key] of Object.entries(CENTER_CONTACT_ENV)) {
    const value = env[key]?.trim();
    if (value) contact[field as keyof CenterContact] = value;
  }
  return contact;
}
