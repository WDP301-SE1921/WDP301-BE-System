import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../database/orm/database.service';
import { AppError } from '../../common/errors/app.error';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

class SubjectDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(191) name!: string;
}
class UpdateSubjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(64) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(191) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

@ApiBearerAuth()
@ApiTags('subjects')
@Controller({ path: 'subjects', version: '1' })
export class SubjectsController {
  constructor(private readonly db: DatabaseService) {}

  private require(user: AuthenticatedUser, write = false): void {
    if (
      write
        ? user.role !== 'MANAGER'
        : !['MANAGER', 'STAFF', 'TEACHER', 'CURRICULUM_DESIGNER'].includes(user.role)
    )
      throw new AppError('FORBIDDEN', 'Role is not allowed', HttpStatus.FORBIDDEN);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('search') search?: string): Promise<unknown> {
    this.require(user);
    return this.db.subject.findMany({
      where: search
        ? { OR: [{ code: { contains: search.trim() } }, { name: { contains: search.trim() } }] }
        : {},
      include: { _count: { select: { programs: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    this.require(user);
    const subject = await this.db.subject.findUnique({
      where: { id },
      include: { programs: true },
    });
    if (!subject)
      throw new AppError('SUBJECT_NOT_FOUND', 'Subject not found', HttpStatus.NOT_FOUND);
    return subject;
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: SubjectDto): Promise<unknown> {
    this.require(user, true);
    return this.db.subject.create({
      data: { code: input.code.trim().toUpperCase(), name: input.name.trim() },
    });
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: UpdateSubjectDto,
  ): Promise<unknown> {
    this.require(user, true);
    const subject = await this.db.subject.findUnique({ where: { id } });
    if (!subject)
      throw new AppError('SUBJECT_NOT_FOUND', 'Subject not found', HttpStatus.NOT_FOUND);
    return this.db.$transaction(async (tx) => {
      if (input.name !== undefined && input.name.trim() !== subject.name) {
        const used = await tx.curriculumUnit.count({ where: { program: { subjectId: id } } });
        if (used)
          throw new AppError(
            'SUBJECT_IN_USE',
            'Subject name is used by approved or draft curriculum',
            HttpStatus.CONFLICT,
          );
      }
      const updated = await tx.subject.update({
        where: { id },
        data: {
          ...(input.code === undefined ? {} : { code: input.code.trim().toUpperCase() }),
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      });
      if (input.name !== undefined)
        await tx.program.updateMany({ where: { subjectId: id }, data: { subject: updated.name } });
      return updated;
    });
  }

  @Delete(':id')
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<unknown> {
    this.require(user, true);
    const subject = await this.db.subject.findUnique({
      where: { id },
      include: { _count: { select: { programs: true } } },
    });
    if (!subject)
      throw new AppError('SUBJECT_NOT_FOUND', 'Subject not found', HttpStatus.NOT_FOUND);
    if (subject._count.programs)
      return this.db.subject.update({ where: { id }, data: { isActive: false } });
    await this.db.subject.delete({ where: { id } });
    return { id, deleted: true };
  }
}
