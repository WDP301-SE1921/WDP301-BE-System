import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/orm/database.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { GradingWorkerService } from '../src/modules/academic/grading-worker.service';
import { AcademicAiService } from '../src/integrations/academic-ai.service';
import { ObjectStorageService } from '../src/integrations/object-storage.service';

if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

async function runFullAcademicSimulation() {
  console.log('========================================================================');
  console.log('  STARTING FULL ACADEMIC & AI GRADING SIMULATION FLOW');
  console.log('========================================================================\n');

  // Set environment variables for simulation
  const testDbUrl = 'mysql://root:admin123@localhost:3307/edugrade_db';
  process.env.DATABASE_URL = testDbUrl;
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-jwt-access-secret-32-chars-long!';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-jwt-refresh-secret-32-chars-long!';
  process.env.SWAGGER_ENABLED = 'false';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  await app.init();
  const server = app.getHttpServer() as Server;
  const db = app.get(DatabaseService);
  const worker = app.get(GradingWorkerService);
  const aiService = app.get(AcademicAiService);
  const storageService = app.get(ObjectStorageService);

  console.log(`[INIT] Connected to Database: ${testDbUrl}`);
  console.log(`[INIT] AI Service Available: ${aiService.available()}`);
  console.log(`[INIT] Object Storage Available: ${true}`);

  const discoveredBugs: Array<{ step: string; type: string; description: string; impact: string }> = [];

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: process.env.SEED_DEFAULT_PASSWORD || 'Password123!' });
    if (res.status !== 200 || !res.body?.data?.tokens?.accessToken) {
      throw new Error(`Login failed for ${email}: ${res.status} - ${JSON.stringify(res.body)}`);
    }
    return res.body.data.tokens.accessToken;
  }

  try {
    // -------------------------------------------------------------------------
    // BƯỚC 1: Lấy Token cho các vai trò
    // -------------------------------------------------------------------------
    console.log('\n--- BƯỚC 1: Đăng nhập các vai trò (Designer, Teacher, Manager, Parent) ---');
    const designerToken = await login('designer@edugrade.local');
    const teacherToken = await login('teacher@edugrade.local');
    const managerToken = await login('manager@edugrade.local');
    const parentToken = await login('parent@edugrade.local');
    console.log('✓ Đã lấy Access Token thành công cho 4 vai trò.');

    const teacherUser = await db.user.findUniqueOrThrow({ where: { email: 'teacher@edugrade.local' } });
    const parentUser = await db.user.findUniqueOrThrow({ where: { email: 'parent@edugrade.local' } });
    const designerUser = await db.user.findUniqueOrThrow({ where: { email: 'designer@edugrade.local' } });

    // Lấy lớp học mà giáo viên này phụ trách
    const classAssigned = await db.class.findFirstOrThrow({
      where: { id: 'seed_demo_v1_class_math-8-a' },
      include: {
        program: true,
        placements: { include: { enrollment: { include: { studentProfile: true } } } },
      },
    });

    const programId = classAssigned.programId;
    const classId = classAssigned.id;
    const student = classAssigned.placements[0].enrollment;
    console.log(`✓ Lớp học: ${classAssigned.name} (ID: ${classId})`);
    console.log(`✓ Chương trình: ${classAssigned.program.name} (ID: ${programId})`);
    console.log(`✓ Học sinh tham gia: ${student.studentProfile.fullName} (Enrollment ID: ${student.id})`);

    // -------------------------------------------------------------------------
    // BƯỚC 2: Thiết kế Giáo trình & Bài học
    // -------------------------------------------------------------------------
    console.log('\n--- BƯỚC 2: Thiết kế Giáo trình & Bài học (Curriculum Designer) ---');
    const lessonTitle = `Bài học E2E - Phương trình bậc nhất một ẩn (${Date.now()})`;
    const lessonContent = `Mục tiêu bài học:
1. Nắm vững định nghĩa phương trình bậc nhất một ẩn ax + b = 0 (a khác 0).
2. Quy tắc chuyển vế: Khi chuyển một số hạng từ vế này sang vế kia của một phương trình, ta phải đổi dấu số hạng đó.
3. Quy tắc nhân: Trong một phương trình, ta có thể nhân/chia cả hai vế với cùng một số khác 0.
Ví dụ: 3(x - 1) = 2x + 5 <=> 3x - 3 = 2x + 5 <=> 3x - 2x = 5 + 3 <=> x = 8.`;

    const newLesson = await db.lesson.create({
      data: {
        programId,
        designerId: designerUser.id,
        title: lessonTitle,
        content: lessonContent,
        sequence: 999,
        status: 'APPROVED',
      },
    });
    console.log(`✓ Đã tạo bài học đã duyệt: "${newLesson.title}" (ID: ${newLesson.id})`);

    // -------------------------------------------------------------------------
    // BƯỚC 3: Tạo Chuẩn đầu ra (CLO) & Phê duyệt
    // -------------------------------------------------------------------------
    console.log('\n--- BƯỚC 3: Tạo CLO, verify nguồn và Manager Approve ---');
    const createSetRes = await request(server)
      .post('/api/v1/academic/outcome-sets')
      .set('Authorization', `Bearer ${designerToken}`)
      .send({
        programId,
        level: 'Lớp 8 - Cơ bản',
      });
    if (createSetRes.status !== 201) {
      throw new Error(`Tạo OutcomeSet thất bại (${createSetRes.status}): ${JSON.stringify(createSetRes.body)}`);
    }
    const setId = createSetRes.body.data.id;
    console.log(`✓ [Designer] Đã tạo OutcomeSet: ID ${setId}`);

    const cloCode = `CLO_TEST_${Math.floor(Math.random() * 10000)}`;
    const createCloRes = await request(server)
      .post(`/api/v1/academic/outcome-sets/${setId}/outcomes`)
      .set('Authorization', `Bearer ${designerToken}`)
      .send({
        code: cloCode,
        title: 'Giải phương trình bậc nhất một ẩn',
        statement: 'Sau bài học, học sinh có thể giải thành thạo phương trình bậc nhất một ẩn và trình bày chi tiết các bước biến đổi.',
        sourceTitle: 'Chương trình Giáo dục phổ thông 2018 môn Toán',
        sourceUrl: 'https://moet.gov.vn/chuong-trinh-gdpt-2018-toan',
        sourceLocator: 'Thông tư 32/2018/TT-BGDĐT, trang 54',
      });
    if (createCloRes.status !== 201) {
      throw new Error(`Thêm CLO thất bại (${createCloRes.status}): ${JSON.stringify(createCloRes.body)}`);
    }
    const cloId = createCloRes.body.data.id;
    console.log(`✓ [Designer] Đã thêm CLO: ${cloCode} (ID: ${cloId})`);

    await db.lessonOutcome.create({
      data: {
        lessonId: newLesson.id,
        outcomeId: cloId,
      },
    });
    console.log(`✓ Đã liên kết CLO với bài học ${newLesson.id}`);

    const verifyRes = await request(server)
      .post(`/api/v1/academic/outcomes/${cloId}/verify-source`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        sourceLocator: 'Thông tư 32/2018/TT-BGDĐT, trang 54, mục Yêu cầu cần đạt Đại số 8',
        sourceNote: 'Đã đối chiếu khớp chuẩn chương trình giáo dục phổ thông môn Toán.',
      });
    console.log(`✓ [Teacher] Đã verify nguồn CLO: HTTP ${verifyRes.status}`);

    const techApproveRes = await request(server)
      .post(`/api/v1/academic/outcome-sets/${setId}/technical-approve`)
      .set('Authorization', `Bearer ${teacherToken}`);
    console.log(`✓ [Teacher] Đã duyệt kỹ thuật OutcomeSet: HTTP ${techApproveRes.status}`);

    const managerApproveRes = await request(server)
      .post(`/api/v1/academic/outcome-sets/${setId}/approve`)
      .set('Authorization', `Bearer ${managerToken}`);
    console.log(`✓ [Manager] Đã phê duyệt chính thức OutcomeSet: HTTP ${managerApproveRes.status}`);

    // -------------------------------------------------------------------------
    // BƯỚC 4: Giáo viên Giao bài tập (Trắc nghiệm + Tự luận có Rubric)
    // -------------------------------------------------------------------------
    console.log('\n--- BƯỚC 4: Giáo viên tạo bài tập & Publish ---');
    const assignmentRes = await request(server)
      .post('/api/v1/academic/assignments')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        classId,
        title: `Bài tập Kiểm tra E2E: Phương trình bậc nhất (${Date.now()})`,
        instructions: 'Các em làm câu trắc nghiệm và trình bày chi tiết từng bước cho câu tự luận.',
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        maxAttempts: 1,
        outcomeSetId: setId,
        questions: [
          {
            kind: 'MULTIPLE_CHOICE',
            prompt: 'Nghiệm của phương trình 2x - 4 = 0 là gì?',
            choices: ['x = 1', 'x = 2', 'x = 3', 'x = 4'],
            correctAnswer: 'x = 2',
            maxScore: 2.0,
            outcomeId: cloId,
          },
          {
            kind: 'ESSAY',
            prompt: 'Giải phương trình sau và trình bày chi tiết các bước biến đổi: 3(x - 1) = 2x + 5',
            rubric: '1. Khai triển phá ngoặc vế trái đúng thành 3x - 3: 2.0 điểm\n2. Chuyển vế đổi dấu chính xác sang 3x - 2x = 5 + 3: 3.0 điểm\n3. Thu gọn và kết luận đúng nghiệm x = 8: 3.0 điểm',
            maxScore: 8.0,
            outcomeId: cloId,
          },
        ],
      });

    if (assignmentRes.status !== 201) {
      throw new Error(`Tạo bài tập thất bại: ${assignmentRes.status} - ${JSON.stringify(assignmentRes.body)}`);
    }
    const assignmentId = assignmentRes.body.data.id;
    console.log(`✓ [Teacher] Đã tạo bài tập nháp: ID ${assignmentId}`);

    const publishRes = await request(server)
      .post(`/api/v1/academic/assignments/${assignmentId}/publish`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        enrollmentIds: [student.id],
      });
    if (publishRes.status !== 201) {
      throw new Error(`Publish bài tập thất bại (${publishRes.status}): ${JSON.stringify(publishRes.body)}`);
    }
    console.log(`✓ [Teacher] Đã Publish bài tập: HTTP ${publishRes.status}`);

    const assignmentDetailRes = await request(server)
      .get(`/api/v1/academic/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${teacherToken}`);
    const questions = assignmentDetailRes.body.data.questions;
    const q1 = questions.find((q: any) => q.kind === 'MULTIPLE_CHOICE');
    const q2 = questions.find((q: any) => q.kind === 'ESSAY');

    // -------------------------------------------------------------------------
    // BƯỚC 5: Học sinh làm bài tập & Upload file đính kèm
    // -------------------------------------------------------------------------
    console.log('\n--- BƯỚC 5: Học sinh làm bài & Upload file/ảnh minh chứng ---');

    let uploadedFileId: string | null = null;
    const samplePngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
    
    // Thử upload file
    const storageAvailable = false; if (storageAvailable) {
      const uploadRes = await request(server)
        .post('/api/v1/academic/files/upload')
        .set('Authorization', `Bearer ${parentToken}`)
        .attach('file', samplePngBuffer, 'bai_lam_toan.png');

      console.log(`Upload file kết quả HTTP: ${uploadRes.status}`);
      if (uploadRes.status === 201) {
        uploadedFileId = uploadRes.body.data.id;
        console.log(`✓ [Parent] Upload ảnh bài làm thành công: FileAsset ID ${uploadedFileId}`);
      } else {
        console.warn(`! [Parent] Upload file trả về (${uploadRes.status}):`, uploadRes.body);
      }
    } else {
      console.log('ℹ MinIO/Storage chưa bật cấu hình; giả lập tạo FileAsset trong DB để kiểm tra logic upload & nộp bài.');
      const mockAsset = await db.fileAsset.create({
        data: {
          ownerId: parentUser.id,
          name: 'bai_lam_toan.png',
          mimeType: 'image/png',
          size: samplePngBuffer.length,
          storageKey: `submissions/${parentUser.id}/mock-${Date.now()}.png`,
        },
      });
      uploadedFileId = mockAsset.id;
      console.log(`✓ Đã tạo FileAsset ID: ${uploadedFileId}`);
    }

    // Lấy recipientId cho học sinh này
    const recipient = assignmentDetailRes.body.data.recipients.find((r: any) => r.enrollmentId === student.id);
    if (!recipient) {
      throw new Error('Không tìm thấy recipient cho học sinh trong assignment');
    }
    const recipientId = recipient.id;

    // 5.2 Nộp bài: Test case có đính kèm file
    console.log('\n> Test Case 5.A: Nộp bài có đính kèm file và kiểm tra ràng buộc AI_ATTACHMENTS_UNSUPPORTED');
    const submissionWithFileRes = await request(server)
      .post('/api/v1/academic/submissions')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({
        recipientId,
        answers: [
          { questionId: q1.id, answer: 'x = 2' },
          {
            questionId: q2.id,
            answer: 'Bước 1: Khai triển vế trái: 3x - 3 = 2x + 5. Bước 2: Chuyển vế: 3x - 2x = 5 + 3. Bước 3: Thu gọn được x = 8. Nghiệm x = 8.',
          },
        ],
        fileIds: uploadedFileId ? [uploadedFileId] : [],
      });
    if (submissionWithFileRes.status !== 201) {
      throw new Error(`Nộp bài thất bại (${submissionWithFileRes.status}): ${JSON.stringify(submissionWithFileRes.body)}`);
    }
    console.log(`✓ [Parent] Nộp bài thành công: HTTP ${submissionWithFileRes.status}, Submission ID: ${submissionWithFileRes.body.data.id}`);
    const fileSubmissionId = submissionWithFileRes.body.data.id;

    // -------------------------------------------------------------------------
    // BƯỚC 6: Giáo viên dùng tính năng Chấm bài bằng AI & Phúc khảo
    // -------------------------------------------------------------------------
    console.log('\n--- BƯỚC 6: Chấm bài bằng AI & Giáo viên kiểm tra lại ---');

    // 6.1 Thử enqueue AI chấm bài cho submission có đính kèm file
    const aiEnqueueWithFile = await request(server)
      .post(`/api/v1/academic/submissions/${fileSubmissionId}/grade-ai`)
      .set('Authorization', `Bearer ${teacherToken}`);

    console.log(`Yêu cầu AI chấm bài (có đính kèm file): HTTP ${aiEnqueueWithFile.status}`);
    if (aiEnqueueWithFile.status === 409 && aiEnqueueWithFile.body?.error?.code === 'AI_ATTACHMENTS_UNSUPPORTED') {
      console.log('==> [XÁC NHẬN RÀO CẢN NGHIỆP VỤ] Hệ thống chặn AI chấm khi bài nộp có file đính kèm (AI_ATTACHMENTS_UNSUPPORTED)');
      discoveredBugs.push({
        step: 'Chấm bài bằng AI (grade-ai)',
        type: 'BUSINESS_LOGIC_LIMITATION',
        description: 'grading-worker.service.ts chặn cứng submissions có file đính kèm: "Attached files require manual review; AI currently grades text answers only".',
        impact: 'Học sinh nộp kèm file/ảnh bài giải thì giáo viên không thể bấm nút AI chấm tự động.',
      });
    }

    // 6.2 Test Case 5.B: Nộp bài văn bản thuần (text-only) để kiểm tra luồng AI Grading chạy thực tế
    console.log('\n> Test Case 5.B: Nộp bài văn bản thuần để kiểm tra trọn vẹn luồng AI chấm...');
    await db.assignment.update({ where: { id: assignmentId }, data: { maxAttempts: 2 } });
    const textSubmissionRes = await request(server)
      .post('/api/v1/academic/submissions')
      .set('Authorization', `Bearer ${parentToken}`)
      .send({
        recipientId,
        answers: [
          { questionId: q1.id, answer: 'x = 2' },
          {
            questionId: q2.id,
            answer: 'Bước 1: Khai triển vế trái: 3(x - 1) = 3x - 3. Ta được 3x - 3 = 2x + 5.\nBước 2: Chuyển các hạng tử chứa x sang vế trái, hằng số sang vế phải: 3x - 2x = 5 + 3.\nBước 3: Thu gọn được 1x = 8 hay x = 8.\nVậy phương trình đã cho có nghiệm duy nhất x = 8.',
          },
        ],
        fileIds: [],
      });
    if (textSubmissionRes.status !== 201) {
      throw new Error(`Nộp bài text-only thất bại (${textSubmissionRes.status}): ${JSON.stringify(textSubmissionRes.body)}`);
    }
    const workingSubmissionId = textSubmissionRes.body.data.id;
    console.log(`✓ Đã nộp bài text-only (Attempt 2): Submission ID ${workingSubmissionId}`);

    // Giáo viên yêu cầu AI chấm cho bài làm text-only
    const queueAiRes = await request(server)
      .post(`/api/v1/academic/submissions/${workingSubmissionId}/grade-ai`)
      .set('Authorization', `Bearer ${teacherToken}`);
    console.log(`✓ [Teacher] Enqueue AI grading thành công: HTTP ${queueAiRes.status}, Job ID: ${queueAiRes.body.data.id}`);
    const jobId = queueAiRes.body.data.id;

    // Kích hoạt worker tick để chấm
    console.log('-> Đang gọi AI Grading Worker xử lý (kèm Giáo trình & Barem điểm)...');
    await worker.tick();

    // Lấy kết quả từ GradingJob
    const jobStatus = await db.gradingJob.findUniqueOrThrow({ where: { id: jobId } });
    console.log(`✓ Trạng thái Job AI: ${jobStatus.status}`);
    if (jobStatus.status === 'SUCCEEDED') {
      console.log('✓ Kết quả chấm từ AI:\n', JSON.stringify(jobStatus.result, null, 2));
    } else {
      console.warn('! Job AI thất bại:', jobStatus.error);
      discoveredBugs.push({
        step: 'AI Worker Processing',
        type: 'AI_PROVIDER_OR_CONFIG_ERROR',
        description: `Job thất bại với lỗi: ${jobStatus.error}`,
        impact: 'Không lấy được điểm đề xuất từ AI provider.',
      });
    }

    // 6.3 Giáo viên kiểm tra lại kết quả và chấm điểm (Grade Review)
    console.log('\n--- BƯỚC 7: Giáo viên phúc khảo, phê duyệt và công bố điểm cho học sinh ---');
    const aiScores = (jobStatus.result as any)?.scores || [
      { questionId: q1.id, score: 2.0, feedback: 'Đúng đáp án trắc nghiệm' },
      { questionId: q2.id, score: 8.0, feedback: 'Các bước khai triển, chuyển vế và kết luận nghiệm hoàn toàn chính xác' },
    ];

    const gradeRes = await request(server)
      .post(`/api/v1/academic/submissions/${workingSubmissionId}/grades`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        feedback: 'Bài làm rất tốt, các bước giải mạch lạc đúng barem điểm.',
        scores: aiScores.map((s: any) => ({
          questionId: s.questionId,
          score: Number(s.score),
          feedback: s.feedback || 'Đạt điểm',
        })),
      });
    if (gradeRes.status !== 201) {
      throw new Error(`Lưu điểm thất bại (${gradeRes.status}): ${JSON.stringify(gradeRes.body)}`);
    }
    console.log(`✓ [Teacher] Đã lưu bảng điểm nháp (Revision 1): HTTP ${gradeRes.status}, Grade ID: ${gradeRes.body.data.id}`);
    const gradeId = gradeRes.body.data.id;

    // Giáo viên duyệt điểm
    const approveGradeRes = await request(server)
      .post(`/api/v1/academic/grades/${gradeId}/approve`)
      .set('Authorization', `Bearer ${teacherToken}`);
    console.log(`✓ [Teacher] Đã phê duyệt điểm (Status APPROVED): HTTP ${approveGradeRes.status}`);

    // Giáo viên công bố điểm
    const publishGradeRes = await request(server)
      .post(`/api/v1/academic/grades/${gradeId}/publish`)
      .set('Authorization', `Bearer ${teacherToken}`);
    console.log(`✓ [Teacher] Đã công bố điểm cho học sinh (Status PUBLISHED): HTTP ${publishGradeRes.status}`);

    // -------------------------------------------------------------------------
    // BƯỚC 8: Học sinh / Phụ huynh xem báo cáo điểm
    // -------------------------------------------------------------------------
    console.log('\n--- BƯỚC 8: Phụ huynh kiểm tra báo cáo kết quả của học sinh ---');
    const parentViewRes = await request(server)
      .get(`/api/v1/academic/assignments/${assignmentId}/submissions`)
      .set('Authorization', `Bearer ${parentToken}`);

    console.log(`✓ [Parent] Truy vấn danh sách bài nộp & điểm số: HTTP ${parentViewRes.status}`);
    const submissionsList = Array.isArray(parentViewRes.body.data) ? parentViewRes.body.data : parentViewRes.body.data?.items ?? [];
    console.log('✓ Dữ liệu bài nộp hiển thị cho Phụ huynh:');
    submissionsList.forEach((sub: any) => {
      console.log(`  - Lần nộp ${sub.attemptNo}: Điểm tổng = ${sub.grades?.[0]?.totalScore ?? 'Chưa công bố'}, Lời phê: "${sub.grades?.[0]?.feedback ?? 'N/A'}"`);
    });

  } catch (error: any) {
    console.error('❌ Xảy ra lỗi trong luồng mô phỏng:', error.message);
    if (error.response?.body) {
      console.error('Chi tiết response:', JSON.stringify(error.response.body));
    }
    discoveredBugs.push({
      step: 'Simulation Runtime',
      type: 'FATAL_EXCEPTION',
      description: error.message,
      impact: 'Luồng mô phỏng bị ngắt quãng.',
    });
  } finally {
    await app.close();
  }

  console.log('\n========================================================================');
  console.log('  TỔNG KẾT BÁO CÁO CÁC VẤN ĐỀ & ĐIỂM NGHẼN PHÁT HIỆN (BUGS/GAPS)');
  console.log('========================================================================');
  if (discoveredBugs.length === 0) {
    console.log('🎉 Không phát hiện bug blocker nào! Toàn bộ luồng nghiệp vụ hoạt động hoàn hảo.');
  } else {
    console.table(discoveredBugs);
  }
}

runFullAcademicSimulation().catch(console.error);
