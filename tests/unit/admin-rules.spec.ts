import { assertCanChangeStatus, emailServiceState } from '../../src/modules/admin/admin-rules';

const admin = { id: 'admin-1', role: 'ADMIN' as const, status: 'ACTIVE' as const };
const staff = { id: 'staff-1', role: 'STAFF' as const, status: 'ACTIVE' as const };

function code(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'NO_ERROR';
}

describe('assertCanChangeStatus', () => {
  it('allows an admin to disable another account', () => {
    expect(
      code(() =>
        assertCanChangeStatus({
          actorId: 'admin-1',
          target: staff,
          nextStatus: 'DISABLED',
          activeAdminCount: 1,
        }),
      ),
    ).toBe('NO_ERROR');
  });

  it('refuses a no-op status change', () => {
    expect(
      code(() =>
        assertCanChangeStatus({
          actorId: 'admin-1',
          target: staff,
          nextStatus: 'ACTIVE',
          activeAdminCount: 1,
        }),
      ),
    ).toBe('ACCOUNT_STATUS_UNCHANGED');
  });

  it('refuses disabling yourself', () => {
    expect(
      code(() =>
        assertCanChangeStatus({
          actorId: 'admin-1',
          target: admin,
          nextStatus: 'DISABLED',
          activeAdminCount: 2,
        }),
      ),
    ).toBe('ADMIN_SELF_LOCK');
  });

  it('keeps at least one active admin', () => {
    const other = { ...admin, id: 'admin-2' };
    expect(
      code(() =>
        assertCanChangeStatus({
          actorId: 'admin-1',
          target: other,
          nextStatus: 'DISABLED',
          activeAdminCount: 1,
        }),
      ),
    ).toBe('ADMIN_LAST_ACTIVE');
    expect(
      code(() =>
        assertCanChangeStatus({
          actorId: 'admin-1',
          target: other,
          nextStatus: 'DISABLED',
          activeAdminCount: 2,
        }),
      ),
    ).toBe('NO_ERROR');
  });

  it('always allows re-enabling an account', () => {
    expect(
      code(() =>
        assertCanChangeStatus({
          actorId: 'admin-1',
          target: { ...staff, status: 'DISABLED' },
          nextStatus: 'ACTIVE',
          activeAdminCount: 1,
        }),
      ),
    ).toBe('NO_ERROR');
  });
});

describe('emailServiceState', () => {
  it('reports configuration and recent failures without exposing settings', () => {
    expect(emailServiceState(false, 0)).toBe('NOT_CONFIGURED');
    expect(emailServiceState(true, 0)).toBe('AVAILABLE');
    expect(emailServiceState(true, 3)).toBe('DEGRADED');
  });
});
