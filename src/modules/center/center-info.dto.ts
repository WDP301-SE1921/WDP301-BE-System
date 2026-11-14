import { ApiProperty } from '@nestjs/swagger';

export class CenterInfoDto {
  @ApiProperty({ type: String, nullable: true, example: 'Trung tâm bồi dưỡng văn hóa EduGrade' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '12 Nguyễn Văn Bảo, Gò Vấp, TP.HCM' })
  address!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '028 1234 5678' })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'lienhe@edugrade.vn' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Thứ 2 - Chủ nhật, 7:30 - 21:00' })
  openingHours!: string | null;
}

export class PublicSubjectDto {
  @ApiProperty({ example: 'clx0subject0math' })
  id!: string;

  @ApiProperty({ example: 'MATH' })
  code!: string;

  @ApiProperty({ example: 'Toán học' })
  name!: string;
}
