import * as dotenv from 'dotenv';
dotenv.config();

// Hỗ trợ môi trường local Windows khi gặp SSL leaf signature từ proxy / antivirus
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../src/config/configuration';
import { AcademicAiService, isRecord } from '../src/integrations/academic-ai.service';
import {
  buildGradingSkillPayload,
  GRADING_SKILL_INSTRUCTION,
} from '../src/modules/academic/ai-grading-skill';
import { validateScores } from '../src/modules/academic/assessment.service';
import { QuestionKind } from '@prisma/client';

async function main() {
  console.log('='.repeat(60));
  console.log('🧪 KIỂM TRA LUỒNG CHẤM BÀI BẰNG AI (DEEPSEEK / OPENAI)');
  console.log('='.repeat(60));

  const env = validateEnvironment(process.env);
  const aiKey = env.academic.aiKey;
  const aiUrl = env.academic.aiUrl;
  const aiModel = env.academic.aiModel;

  console.log(`📡 Endpoint : ${aiUrl || '(chưa cấu hình)'}`);
  console.log(`🤖 Model    : ${aiModel || '(chưa cấu hình)'}`);
  console.log(`🔑 API Key  : ${aiKey ? aiKey.slice(0, 7) + '...' + aiKey.slice(-4) : '(TRỐNG)'}`);

  if (!aiKey) {
    console.error('\n❌ LỖI: Chưa tìm thấy AI_API_KEY trong file .env!');
    console.error('👉 Vui lòng mở file .env và thêm dòng:');
    console.error('   AI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx');
    process.exit(1);
  }

  const configService = new ConfigService(env);
  const aiService = new AcademicAiService(configService);

  if (!aiService.available()) {
    console.error('\n❌ LỖI: AcademicAiService báo không khả dụng.');
    process.exit(1);
  }

  // Chuẩn bị dữ liệu mẫu mô phỏng bài tập thực tế trong EduGrade
  const sampleQuestions = [
    {
      id: 'cau-1-trac-nghiem',
      kind: 'MULTIPLE_CHOICE' as QuestionKind,
      prompt: 'Khai triển biểu thức (x + 2)(x + 3) thu được kết quả nào?',
      choices: ['x² + 5x + 6', 'x² + 6', 'x² + x + 6', '2x + 5'],
      correctAnswer: 'x² + 5x + 6',
      rubric: null,
      maxScore: 4,
    },
    {
      id: 'cau-2-tu-luan',
      kind: 'ESSAY' as QuestionKind,
      prompt: 'Giải phương trình bậc nhất một ẩn: 3x - 7 = 8 và kiểm tra lại nghiệm.',
      correctAnswer: 'x = 5. Thay vào được: 3(5) - 7 = 15 - 7 = 8 (thỏa mãn).',
      rubric: [
        'Barem điểm chi tiết (Tổng 6.0 điểm):',
        '- Bước 1: Áp dụng quy tắc chuyển vế đổi dấu được 3x = 8 + 7 => 3x = 15 (2.0 điểm).',
        '- Bước 2: Chia hai vế cho 3 tìm được nghiệm x = 5 và kết luận nghiệm (3.0 điểm). Thiếu kết luận trừ 0.5 điểm.',
        '- Bước 3: Thay x = 5 vào hai vế để kiểm tra nghiệm (1.0 điểm).',
      ].join('\n'),
      maxScore: 6,
      outcome: {
        code: 'M8-EQ-02',
        title: 'Giải phương trình bậc nhất một ẩn',
        statement: 'Học sinh biết áp dụng quy tắc chuyển vế, quy tắc nhân để giải và kiểm tra nghiệm.',
      },
    },
  ];

  // Học sinh trả lời đúng câu 1; câu 2 giải đúng nhưng quên bước kiểm tra nghiệm (kỳ vọng đạt ~5.0 / 6.0)
  const sampleAnswers = [
    {
      questionId: 'cau-1-trac-nghiem',
      answer: 'x² + 5x + 6',
    },
    {
      questionId: 'cau-2-tu-luan',
      answer: 'Ta có 3x - 7 = 8 => 3x = 8 + 7 => 3x = 15 => x = 15 / 3 = 5. Vậy phương trình có nghiệm x = 5.',
    },
  ];

  const payload = buildGradingSkillPayload({
    assignment: {
      id: 'bai-kiem-tra-chuong-1',
      title: 'Kiểm tra 15 phút: Đại số 8',
      instructions: 'Học sinh làm bài tự luận cần trình bày rõ các bước biến đổi và thử lại nghiệm.',
      kind: 'TEST',
      testType: 'FIFTEEN_MINUTES',
      program: {
        name: 'Toán 8',
        subject: 'Toán',
        grade: 8,
      },
      sessionLesson: {
        id: 'bai-hoc-phuong-trinh',
        sequence: 3,
        title: 'Phương trình bậc nhất một ẩn và cách giải',
        content: [
          'Khái niệm phương trình bậc nhất một ẩn dạng ax + b = 0 (a khác 0).',
          'Hai quy tắc biến đổi tương đương: Quy tắc chuyển vế (chuyển hạng tử đổi dấu) và quy tắc nhân với một số khác 0.',
          'Các bước giải: 1) Chuyển các hạng tử chứa ẩn sang một vế, hằng số sang vế kia; 2) Thu gọn về dạng ax = c; 3) Tìm x = c/a; 4) Thử lại nghiệm vào phương trình ban đầu.',
        ].join('\n'),
      },
    },
    questions: sampleQuestions,
    answers: sampleAnswers,
  });

  console.log('\n🚀 Đang gửi dữ liệu chấm sang AI...');
  console.log(`   - Giáo trình : ${payload.curriculum.program?.name} (${payload.curriculum.sessionLesson?.title})`);
  console.log(`   - Số câu hỏi : ${payload.questions.length} (1 trắc nghiệm + 1 tự luận có Barem điểm)`);

  const startTime = Date.now();

  try {
    const response = await aiService.json(GRADING_SKILL_INSTRUCTION, payload);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ AI phản hồi thành công sau ${duration}s!`);

    if (!isRecord(response) || !Array.isArray(response.scores)) {
      throw new Error('Dữ liệu AI trả về không chứa mảng scores hợp lệ.');
    }

    const scores = response.scores.map((s: unknown) => {
      if (
        !isRecord(s) ||
        typeof s.questionId !== 'string' ||
        typeof s.score !== 'number' ||
        typeof s.feedback !== 'string'
      ) {
        throw new Error('Cấu trúc phần tử score không đúng định dạng.');
      }
      return { questionId: s.questionId, score: s.score, feedback: s.feedback };
    });

    // Chạy bộ kiểm tra chuẩn xác định điểm số của EduGrade
    validateScores(sampleQuestions, scores);

    console.log('\n📊 KẾT QUẢ CHẤM ĐIỂM CHI TIẾT TỪ AI:');
    console.log('-'.repeat(60));

    let totalScore = 0;
    let maxTotal = 0;

    for (const q of sampleQuestions) {
      const result = scores.find((s) => s.questionId === q.id);
      totalScore += result?.score ?? 0;
      maxTotal += q.maxScore;

      console.log(`\n[${q.kind}] Câu: "${q.prompt}"`);
      console.log(`🎯 Điểm chấm: ${result?.score ?? 0} / ${q.maxScore}`);
      console.log(`📝 Nhận xét : ${result?.feedback}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`🏆 TỔNG ĐIỂM: ${totalScore.toFixed(2)} / ${maxTotal.toFixed(2)}`);
    console.log('='.repeat(60));
    console.log('\n🎉 Chúc mừng! Tính năng AI Grading với DeepSeek API đã hoạt động hoàn hảo.');
  } catch (error) {
    console.error('\n❌ LỖI TRONG QUÁ TRÌNH GỌI AI:');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

void main();
