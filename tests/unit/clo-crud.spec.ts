import { OutcomeService } from '../../src/modules/academic/outcome.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

describe('CLO CRUD operations', () => {
  const designer = { id: 'designer-1', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;
  const manager = { id: 'manager-1', role: 'MANAGER' } as AuthenticatedUser;
  const otherDesigner = { id: 'designer-2', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;

  function outcomeService(db: unknown): OutcomeService {
    return new OutcomeService({
      db: db as unknown as never,
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(db),
    } as unknown as never);
  }

  describe('getSet & getOutcome', () => {
    it('returns single outcome set with outcomes and program info', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            programId: 'program-1',
            status: 'APPROVED',
            level: 'Lớp 8 - Cơ bản',
            version: 1,
            outcomes: [{ id: 'clo-1', code: 'M8-EQ-01', title: 'Nhận biết phương trình' }],
          }),
        },
      };

      const result = (await outcomeService(db).getSet(manager, 'set-1')) as {
        id: string;
        level: string;
      };
      expect(result.id).toBe('set-1');
      expect(result.level).toBe('Lớp 8 - Cơ bản');
    });

    it('returns single learning outcome with linked lessons and set info', async () => {
      const db = {
        learningOutcome: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'clo-1',
            outcomeSetId: 'set-1',
            code: 'M8-EQ-01',
            title: 'Nhận biết phương trình',
            outcomeSet: { id: 'set-1', programId: 'program-1', status: 'APPROVED' },
            lessonLinks: [],
          }),
        },
      };

      const result = (await outcomeService(db).getOutcome(manager, 'clo-1')) as {
        id: string;
        code: string;
      };
      expect(result.id).toBe('clo-1');
      expect(result.code).toBe('M8-EQ-01');
    });
  });

  describe('deleteOutcome', () => {
    it('allows the set designer to delete a draft outcome not used in assignments', async () => {
      const deleteLinks = jest.fn().mockResolvedValue({ count: 1 });
      const deleteOutcome = jest.fn().mockResolvedValue({ id: 'clo-1' });
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'DRAFT',
          }),
        },
        learningOutcome: {
          findUnique: jest.fn().mockResolvedValue({ id: 'clo-1', outcomeSetId: 'set-1' }),
          delete: deleteOutcome,
        },
        assignmentQuestion: {
          count: jest.fn().mockResolvedValue(0),
        },
        lessonOutcome: {
          deleteMany: deleteLinks,
        },
      };

      const result = (await outcomeService(db).deleteOutcome(designer, 'set-1', 'clo-1')) as {
        id: string;
        deleted: boolean;
      };
      expect(result.deleted).toBe(true);
      expect(deleteLinks).toHaveBeenCalledWith({ where: { outcomeId: 'clo-1' } });
      expect(deleteOutcome).toHaveBeenCalledWith({ where: { id: 'clo-1' } });
    });

    it('blocks deletion if another designer attempts to delete', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'DRAFT',
          }),
        },
      };

      await expect(outcomeService(db).deleteOutcome(otherDesigner, 'set-1', 'clo-1')).rejects.toThrow(
        'Only the set designer',
      );
    });

    it('blocks deletion if outcome is in use in assignments', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'DRAFT',
          }),
        },
        learningOutcome: {
          findUnique: jest.fn().mockResolvedValue({ id: 'clo-1', outcomeSetId: 'set-1' }),
        },
        assignmentQuestion: {
          count: jest.fn().mockResolvedValue(2),
        },
      };

      await expect(outcomeService(db).deleteOutcome(designer, 'set-1', 'clo-1')).rejects.toThrow(
        'Cannot delete an outcome used in assignments',
      );
    });
  });

  describe('deleteSet', () => {
    it('allows designer to delete an empty draft outcome set', async () => {
      const deleteSet = jest.fn().mockResolvedValue({ id: 'set-1' });
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'DRAFT',
            outcomes: [],
          }),
          delete: deleteSet,
        },
        assignment: {
          count: jest.fn().mockResolvedValue(0),
        },
      };

      const result = (await outcomeService(db).deleteSet(designer, 'set-1')) as {
        id: string;
        deleted: boolean;
      };
      expect(result.deleted).toBe(true);
      expect(deleteSet).toHaveBeenCalledWith({ where: { id: 'set-1' } });
    });

    it('refuses to delete an approved outcome set', async () => {
      const db = {
        outcomeSet: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'set-1',
            designerId: 'designer-1',
            status: 'APPROVED',
            outcomes: [],
          }),
        },
      };

      await expect(outcomeService(db).deleteSet(designer, 'set-1')).rejects.toThrow(
        'Only draft outcome sets can be deleted',
      );
    });
  });
});
