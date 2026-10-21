import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/orm/database.service';
import {
  archiveSupersededCurricula,
  lockCurriculumProgram,
  vietnamDate,
} from './curriculum-lifecycle';

@Injectable()
export class CurriculumLifecycleWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CurriculumLifecycleWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.run();
    if (this.stopped) return;
    this.timer = setInterval(() => void this.run(), 60_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }

  private async run(): Promise<void> {
    if (this.stopped || this.running) return this.running;
    this.running = this.tick()
      .catch(() => this.logger.warn('Curriculum lifecycle reconciliation failed'))
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  async tick(now = new Date()): Promise<void> {
    const programs = await this.db.curriculumUnit.findMany({
      where: { status: 'APPROVED', fromDate: { lte: new Date(`${vietnamDate(now)}T00:00:00Z`) } },
      select: { programId: true },
      distinct: ['programId'],
      orderBy: { programId: 'asc' },
    });
    for (const { programId } of programs) {
      if (this.stopped) break;
      for (let attempt = 0; ; attempt++) {
        try {
          await this.db.$transaction(
            async (tx) => {
              await lockCurriculumProgram(tx, programId);
              await archiveSupersededCurricula(tx, programId, now);
            },
            { isolationLevel: 'RepeatableRead', timeout: 20_000 },
          );
          break;
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034' &&
            attempt < 2
          )
            continue;
          throw error;
        }
      }
    }
  }
}
