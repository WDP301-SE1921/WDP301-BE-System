import { ApiProperty } from '@nestjs/swagger';
import { AssignmentKind, CurriculumItemKind, TestType } from '@prisma/client';

export class ParentSubjectDto {
  @ApiProperty() subject!: string;
  @ApiProperty() grade!: number;
}
export class ParentClassDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
export class ParentGradeSubjectDto {
  @ApiProperty() subject!: string;
}
export class ParentGradeClassDto extends ParentClassDto {
  @ApiProperty({ type: ParentGradeSubjectDto }) program!: ParentGradeSubjectDto;
}
export class ParentGradedAssignmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: AssignmentKind }) kind!: AssignmentKind;
  @ApiProperty({ enum: TestType, nullable: true }) testType!: TestType | null;
  @ApiProperty({ type: ParentGradeClassDto }) class!: ParentGradeClassDto;
}
export class ParentGradeHistoryDto {
  @ApiProperty() recipientId!: string;
  @ApiProperty({ type: ParentGradedAssignmentDto }) assignment!: ParentGradedAssignmentDto;
  @ApiProperty() submissionId!: string;
  @ApiProperty() attemptNo!: number;
  @ApiProperty() totalScore!: number;
  @ApiProperty() maxScore!: number;
  @ApiProperty({ type: Number, nullable: true }) scoreOutOf10!: number | null;
  @ApiProperty() feedback!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt!: Date | null;
}
export class ParentSubjectAverageDto {
  @ApiProperty() subject!: string;
  @ApiProperty() count!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Unweighted mean of published scores normalized to 10; not an official weighted transcript.',
  })
  averageOutOf10!: number | null;
}
export class ParentGradesResponseDto {
  @ApiProperty() studentId!: string;
  @ApiProperty({ type: [ParentSubjectAverageDto] }) subjects!: ParentSubjectAverageDto[];
  @ApiProperty({ type: [ParentGradeHistoryDto] }) history!: ParentGradeHistoryDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}
export class ParentLessonOutlineDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'Order inside this unit, not a course-wide lesson number.' })
  sequence!: number;
  @ApiProperty({ enum: CurriculumItemKind }) kind!: CurriculumItemKind;
  @ApiProperty({ type: String, nullable: true }) monthKey!: string | null;
}
export class ParentCurriculumUnitDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() programId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) fromDate!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) toDate!: Date;
  @ApiProperty() version!: number;
  @ApiProperty({ type: ParentSubjectDto }) program!: ParentSubjectDto;
  @ApiProperty({ type: [ParentClassDto] }) classes!: ParentClassDto[];
  @ApiProperty({ type: [ParentLessonOutlineDto] }) lessons!: ParentLessonOutlineDto[];
}
export class ParentCurriculumResponseDto {
  @ApiProperty() studentId!: string;
  @ApiProperty({ type: [ParentCurriculumUnitDto] }) items!: ParentCurriculumUnitDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}
