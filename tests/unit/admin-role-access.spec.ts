import {
  actsAsStaff,
  isAdmin,
  isBackOffice,
  isManagerOrAdmin,
  roleAllowed,
} from '../../src/common/auth/role-access';

describe('roleAllowed', () => {
  it('lets ADMIN use anything open to MANAGER or STAFF', () => {
    expect(roleAllowed('ADMIN', ['MANAGER'])).toBe(true);
    expect(roleAllowed('ADMIN', ['STAFF'])).toBe(true);
    expect(roleAllowed('ADMIN', ['STAFF', 'PARENT'])).toBe(true);
  });

  it('keeps personal teacher / designer / parent actions to their own role', () => {
    expect(roleAllowed('ADMIN', ['TEACHER'])).toBe(false);
    expect(roleAllowed('ADMIN', ['CURRICULUM_DESIGNER'])).toBe(false);
    expect(roleAllowed('ADMIN', ['PARENT'])).toBe(false);
  });

  it('does not widen other roles', () => {
    expect(roleAllowed('MANAGER', ['STAFF'])).toBe(false);
    expect(roleAllowed('STAFF', ['MANAGER'])).toBe(false);
    expect(roleAllowed('TEACHER', ['TEACHER'])).toBe(true);
  });
});

describe('role groups', () => {
  it('classifies roles', () => {
    expect(isManagerOrAdmin('ADMIN')).toBe(true);
    expect(isManagerOrAdmin('STAFF')).toBe(false);
    expect(isBackOffice('ADMIN')).toBe(true);
    expect(isBackOffice('TEACHER')).toBe(false);
    expect(actsAsStaff('ADMIN')).toBe(true);
    expect(actsAsStaff('MANAGER')).toBe(false);
    expect(isAdmin({ role: 'ADMIN' })).toBe(true);
    expect(isAdmin({ role: 'MANAGER' })).toBe(false);
  });
});
