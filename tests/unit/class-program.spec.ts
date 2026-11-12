import { CatalogService } from '../../src/modules/academic/catalog.service';
import { loadProgramForNewClass } from '../../src/modules/registration-flow/class-program';
import { RegistrationFlowService } from '../../src/modules/registration-flow/registration-flow.service';

const manager = { id: 'manager-1', role: 'MANAGER' } as never;
const program = {
  id: 'program-1',
  isActive: true,
  deletedAt: null,
  subjectRecord: { id: 'subject-1', isActive: true, deletedAt: null },
};

function dbWith(found: unknown): { program: { findUnique: jest.Mock } } {
  return { program: { findUnique: jest.fn().mockResolvedValue(found) } };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('program of a new class', () => {
  it('accepts an active program with an active subject', async () => {
    await expect(loadProgramForNewClass(dbWith(program) as never, 'program-1')).resolves.toBe(
      program,
    );
  });

  it.each([
    ['missing', null, 'PROGRAM_NOT_FOUND'],
    ['soft-deleted by the ADMIN', { ...program, deletedAt: new Date() }, 'PROGRAM_NOT_FOUND'],
    ['inactive', { ...program, isActive: false }, 'PROGRAM_INACTIVE'],
    [
      'of a soft-deleted subject',
      { ...program, subjectRecord: { ...program.subjectRecord, deletedAt: new Date() } },
      'SUBJECT_INACTIVE',
    ],
    [
      'of an inactive subject',
      { ...program, subjectRecord: { ...program.subjectRecord, isActive: false } },
      'SUBJECT_INACTIVE',
    ],
  ])('rejects a program that is %s', async (_label, found, code) => {
    expect(await codeOf(loadProgramForNewClass(dbWith(found) as never, 'program-1'))).toBe(code);
  });

  it('keeps POST /classes from creating a class in a soft-deleted program', async () => {
    const create = jest.fn();
    const db = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'teacher-1' }) },
      program: { findUnique: jest.fn().mockResolvedValue({ ...program, deletedAt: new Date() }) },
      class: { create },
    };
    const service = new RegistrationFlowService(db as never, {} as never);
    const input = { programId: 'program-1', name: 'Toán 9C', capacity: 20, monthlyFee: 1_200_000 };
    expect(await codeOf(service.createClass(manager, input as never))).toBe('PROGRAM_NOT_FOUND');
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps POST /academic/classes from creating a class in a soft-deleted program', async () => {
    const create = jest.fn();
    const db = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'teacher-1' }) },
      program: { findUnique: jest.fn().mockResolvedValue({ ...program, deletedAt: new Date() }) },
      class: { create },
    };
    const service = new CatalogService({ db } as never, {} as never, {} as never);
    const input = {
      programId: 'program-1',
      name: 'Toán 9C',
      teacherId: 'teacher-1',
      capacity: 20,
      monthlyFee: 1_200_000,
    };
    expect(await codeOf(service.createClass(manager, input as never))).toBe('PROGRAM_NOT_FOUND');
    expect(create).not.toHaveBeenCalled();
  });
});
