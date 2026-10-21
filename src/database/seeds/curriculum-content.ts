/** Illustrative content following CLASS_CURRICULUM_INPUT_TEMPLATE, not a supplied textbook. */
export interface Topic {
  title: string;
  summary: string;
  exercise: string;
  answer: string;
}

export const SUBJECTS = [
  {
    key: 'math',
    code: 'MATH',
    name: 'Toán',
    teacher: 'teacher',
    designer: 'designer',
    fee: 800000,
    room: 0,
  },
  {
    key: 'physics',
    code: 'PHYSICS',
    name: 'Vật lý',
    teacher: 'physics-teacher',
    designer: 'designer-2',
    fee: 750000,
    room: 1,
  },
  {
    key: 'chemistry',
    code: 'CHEMISTRY',
    name: 'Hóa học',
    teacher: 'chemistry-teacher',
    designer: 'designer-2',
    fee: 750000,
    room: 2,
  },
  {
    key: 'biology',
    code: 'BIOLOGY',
    name: 'Sinh học',
    teacher: 'biology-teacher',
    designer: 'designer-2',
    fee: 700000,
    room: 3,
  },
] as const;

export const TOPICS: Record<string, Topic[]> = {
  'math-6': [
    {
      title: 'Số tự nhiên và thứ tự phép tính',
      summary: 'Đọc, viết số tự nhiên; tính biểu thức có ngoặc và lũy thừa.',
      exercise: 'Tính 120 - 3 × (12 + 8).',
      answer: '60.',
    },
    {
      title: 'Ước và bội',
      summary: 'Phân tích thừa số nguyên tố, tìm ước chung lớn nhất và bội chung nhỏ nhất.',
      exercise: 'Tìm ƯCLN và BCNN của 12 và 18.',
      answer: 'ƯCLN = 6; BCNN = 36.',
    },
    {
      title: 'Phân số và số thập phân',
      summary: 'Rút gọn, quy đồng, thực hiện các phép tính phân số và số thập phân.',
      exercise: 'Tính 2/3 + 1/6.',
      answer: '5/6.',
    },
    {
      title: 'Hình học trực quan',
      summary: 'Nhận biết tam giác, tứ giác; tính chu vi và diện tích hình chữ nhật.',
      exercise: 'Hình chữ nhật dài 8 cm, rộng 5 cm. Tính diện tích.',
      answer: '40 cm².',
    },
  ],
  'math-7': [
    {
      title: 'Số hữu tỉ',
      summary: 'Biểu diễn số hữu tỉ, so sánh và thực hiện phép tính có dấu.',
      exercise: 'Tính -3/4 + 5/8.',
      answer: '-1/8.',
    },
    {
      title: 'Tỉ lệ thức và đại lượng tỉ lệ',
      summary: 'Dùng tính chất tỉ lệ thức để giải bài toán thực tế.',
      exercise: '3 quyển vở giá 24000 đồng. 5 quyển cùng loại giá bao nhiêu?',
      answer: '40000 đồng.',
    },
    {
      title: 'Biểu thức đại số',
      summary: 'Thay giá trị biến, thu gọn và cộng trừ đa thức một biến.',
      exercise: 'Thu gọn 3x + 2 - x + 5.',
      answer: '2x + 7.',
    },
    {
      title: 'Tam giác và quan hệ góc',
      summary: 'Tổng ba góc tam giác, các trường hợp bằng nhau và tam giác cân.',
      exercise: 'Tam giác có hai góc 50° và 60°. Tìm góc còn lại.',
      answer: '70°.',
    },
  ],
  'math-8': [
    {
      title: 'Đa thức nhiều biến',
      summary: 'Nhận biết đơn thức, thu gọn và thực hiện phép cộng, nhân đa thức.',
      exercise: 'Khai triển (x + 2)(x + 3).',
      answer: 'x² + 5x + 6.',
    },
    {
      title: 'Hằng đẳng thức và phân tích nhân tử',
      summary: 'Vận dụng bình phương một tổng, hiệu hai bình phương và đặt nhân tử chung.',
      exercise: 'Phân tích x² - 9 thành nhân tử.',
      answer: '(x - 3)(x + 3).',
    },
    {
      title: 'Phương trình bậc nhất',
      summary: 'Biến đổi tương đương và giải phương trình một ẩn.',
      exercise: 'Giải 3x - 7 = 8.',
      answer: 'x = 5.',
    },
    {
      title: 'Tứ giác và định lý Thalès',
      summary: 'Nhận biết hình bình hành, hình chữ nhật và sử dụng tỉ số đoạn thẳng.',
      exercise: 'Hình bình hành có cạnh 6 cm và 4 cm. Tính chu vi.',
      answer: '20 cm.',
    },
  ],
  'math-9': [
    {
      title: 'Căn bậc hai',
      summary: 'Điều kiện xác định và biến đổi biểu thức chứa căn bậc hai.',
      exercise: 'Rút gọn √50.',
      answer: '5√2.',
    },
    {
      title: 'Hệ phương trình',
      summary: 'Giải hệ phương trình bằng phương pháp thế và cộng đại số.',
      exercise: 'Giải hệ x + y = 7; x - y = 1.',
      answer: 'x = 4, y = 3.',
    },
    {
      title: 'Phương trình bậc hai',
      summary: 'Biệt thức, công thức nghiệm và quan hệ giữa các nghiệm.',
      exercise: 'Giải x² - 5x + 6 = 0.',
      answer: 'x = 2 hoặc x = 3.',
    },
    {
      title: 'Hệ thức lượng và đường tròn',
      summary: 'Vận dụng định lý Pythagore, tỉ số lượng giác và các góc trong đường tròn.',
      exercise: 'Tam giác vuông có hai cạnh góc vuông 6 cm và 8 cm. Tính cạnh huyền.',
      answer: '10 cm.',
    },
  ],
  'physics-6': [
    {
      title: 'Đo chiều dài và khối lượng',
      summary: 'Chọn dụng cụ, đọc giới hạn đo, độ chia nhỏ nhất và đổi đơn vị.',
      exercise: 'Đổi 2,5 m sang cm.',
      answer: '250 cm.',
    },
    {
      title: 'Lực và tác dụng của lực',
      summary: 'Nhận biết lực đẩy, kéo; lực có thể làm đổi chuyển động hoặc biến dạng.',
      exercise: 'Nêu tác dụng của lực khi bóp một quả bóng cao su.',
      answer: 'Làm quả bóng biến dạng.',
    },
    {
      title: 'Trọng lực và lực đàn hồi',
      summary: 'Phân biệt lực hút của Trái Đất với lực đàn hồi của lò xo.',
      exercise: 'Vật thả từ trên cao rơi xuống do lực nào?',
      answer: 'Trọng lực.',
    },
    {
      title: 'Nhiệt độ và sự chuyển thể',
      summary: 'Đọc nhiệt kế, nhận biết nóng chảy, đông đặc và bay hơi.',
      exercise: 'Nước đá chuyển thành nước lỏng là quá trình nào?',
      answer: 'Nóng chảy.',
    },
  ],
  'physics-7': [
    {
      title: 'Tốc độ chuyển động',
      summary: 'Tính tốc độ từ quãng đường và thời gian; đọc bảng số liệu.',
      exercise: 'Đi 120 m trong 20 s. Tính tốc độ.',
      answer: '6 m/s.',
    },
    {
      title: 'Âm thanh',
      summary: 'Âm do vật dao động tạo ra; phân biệt độ cao và độ to của âm.',
      exercise: 'Nguồn âm có tần số lớn hơn tạo ra âm cao hay thấp hơn?',
      answer: 'Cao hơn.',
    },
    {
      title: 'Ánh sáng và phản xạ',
      summary: 'Vẽ tia sáng; sử dụng định luật phản xạ và nhận biết ảnh qua gương phẳng.',
      exercise: 'Góc tới 30°. Góc phản xạ bằng bao nhiêu?',
      answer: '30°.',
    },
    {
      title: 'Nam châm và từ trường',
      summary: 'Nhận biết hai cực nam châm, lực tương tác và định hướng la bàn.',
      exercise: 'Hai cực cùng tên của nam châm tương tác thế nào?',
      answer: 'Đẩy nhau.',
    },
  ],
  'physics-8': [
    {
      title: 'Khối lượng riêng',
      summary: 'Sử dụng công thức D = m/V và đổi đơn vị thể tích.',
      exercise: 'Vật có m = 540 g, V = 200 cm³. Tính khối lượng riêng.',
      answer: '2,7 g/cm³.',
    },
    {
      title: 'Áp suất và lực đẩy',
      summary: 'Tính áp suất, giải thích áp suất chất lỏng và lực đẩy Archimedes.',
      exercise: 'Lực 100 N tác dụng lên diện tích 0,02 m². Tính áp suất.',
      answer: '5000 Pa.',
    },
    {
      title: 'Công và năng lượng',
      summary: 'Nhận biết công cơ học, cơ năng và các dạng chuyển hóa năng lượng.',
      exercise: 'Lực 20 N cùng hướng dịch chuyển 3 m. Tính công.',
      answer: '60 J.',
    },
    {
      title: 'Nhiệt năng',
      summary: 'Phân biệt dẫn nhiệt, đối lưu và bức xạ; đọc thí nghiệm truyền nhiệt.',
      exercise: 'Nhiệt truyền dọc một thìa kim loại chủ yếu bằng cách nào?',
      answer: 'Dẫn nhiệt.',
    },
  ],
  'physics-9': [
    {
      title: 'Định luật Ohm',
      summary: 'Vận dụng I = U/R và phân tích mạch điện đơn giản.',
      exercise: 'U = 12 V, R = 6 Ω. Tính cường độ dòng điện.',
      answer: '2 A.',
    },
    {
      title: 'Điện trở nối tiếp và song song',
      summary: 'Tính điện trở tương đương và phân bố hiệu điện thế trong mạch.',
      exercise: 'Điện trở 3 Ω và 6 Ω mắc nối tiếp. Tính điện trở tương đương.',
      answer: '9 Ω.',
    },
    {
      title: 'Công suất và điện năng',
      summary: 'Tính P = UI; tính điện năng tiêu thụ và sử dụng điện an toàn.',
      exercise: 'Bóng đèn 60 W dùng 2 giờ. Tính điện năng theo kWh.',
      answer: '0,12 kWh.',
    },
    {
      title: 'Thấu kính và ảnh',
      summary: 'Phân biệt thấu kính hội tụ, phân kỳ; dựng ảnh bằng tia đặc biệt.',
      exercise: 'Thấu kính có rìa mỏng, phần giữa dày thuộc loại nào?',
      answer: 'Thấu kính hội tụ.',
    },
  ],
  'chemistry-6': [
    {
      title: 'Chất và vật thể',
      summary: 'Phân biệt vật thể với chất tạo nên vật thể; quan sát tính chất vật lý.',
      exercise: 'Trong câu “cốc làm bằng thủy tinh”, đâu là chất?',
      answer: 'Thủy tinh.',
    },
    {
      title: 'Ba thể của chất',
      summary: 'Mô tả thể rắn, lỏng, khí và nhận biết sự chuyển thể.',
      exercise: 'Hơi nước thuộc thể nào?',
      answer: 'Thể khí.',
    },
    {
      title: 'Chất tinh khiết và hỗn hợp',
      summary: 'Phân biệt chất tinh khiết, hỗn hợp đồng nhất và không đồng nhất.',
      exercise: 'Nước muối là chất tinh khiết hay hỗn hợp?',
      answer: 'Hỗn hợp.',
    },
    {
      title: 'Tách chất khỏi hỗn hợp',
      summary: 'Chọn lọc, lắng, cô cạn theo tính chất của chất; thực hành an toàn.',
      exercise: 'Dùng cách nào thu muối từ nước muối?',
      answer: 'Cô cạn nước.',
    },
  ],
  'chemistry-7': [
    {
      title: 'Nguyên tử',
      summary: 'Cấu tạo hạt nhân và lớp electron; nhận biết proton, neutron, electron.',
      exercise: 'Hạt nào trong nguyên tử mang điện âm?',
      answer: 'Electron.',
    },
    {
      title: 'Nguyên tố hóa học',
      summary: 'Đọc ký hiệu nguyên tố và phân biệt nguyên tố với hợp chất.',
      exercise: 'Ký hiệu hóa học của oxygen là gì?',
      answer: 'O.',
    },
    {
      title: 'Phân tử, đơn chất và hợp chất',
      summary: 'Nhận biết phân tử; phân loại chất từ thành phần nguyên tố.',
      exercise: 'H₂O là đơn chất hay hợp chất?',
      answer: 'Hợp chất.',
    },
    {
      title: 'Hóa trị và công thức hóa học',
      summary: 'Lập công thức hợp chất đơn giản theo hóa trị.',
      exercise: 'Lập công thức của Al(III) và O(II).',
      answer: 'Al₂O₃.',
    },
  ],
  'chemistry-8': [
    {
      title: 'Phản ứng hóa học',
      summary: 'Nhận biết chất phản ứng, sản phẩm và định luật bảo toàn khối lượng.',
      exercise: 'Cân bằng H₂ + O₂ → H₂O.',
      answer: '2H₂ + O₂ → 2H₂O.',
    },
    {
      title: 'Mol và khối lượng mol',
      summary: 'Vận dụng n = m/M, phân biệt số mol và khối lượng.',
      exercise: 'Tính số mol của 18 g H₂O, M = 18 g/mol.',
      answer: '1 mol.',
    },
    {
      title: 'Dung dịch và nồng độ',
      summary: 'Nhận biết chất tan, dung môi và tính nồng độ phần trăm.',
      exercise: '10 g muối trong 100 g dung dịch. Tính C%.',
      answer: '10%.',
    },
    {
      title: 'Acid, base và pH',
      summary: 'Nhận biết acid, base và đọc thang pH; không tự thử hóa chất nguy hiểm.',
      exercise: 'Dung dịch có pH = 3 thuộc nhóm nào?',
      answer: 'Acid.',
    },
  ],
  'chemistry-9': [
    {
      title: 'Oxide, acid, base và muối',
      summary: 'Phân loại chất và viết phương trình phản ứng trung hòa.',
      exercise: 'Hoàn thành HCl + NaOH → ...',
      answer: 'NaCl + H₂O.',
    },
    {
      title: 'Kim loại và dãy hoạt động',
      summary: 'Nhận biết tính chất kim loại; dự đoán phản ứng thế theo dãy hoạt động.',
      exercise: 'Hoàn thành Fe + CuSO₄ → ...',
      answer: 'FeSO₄ + Cu.',
    },
    {
      title: 'Hydrocarbon',
      summary: 'Nhận biết hợp chất chứa carbon và hydrogen; đọc công thức methane.',
      exercise: 'Viết công thức phân tử methane.',
      answer: 'CH₄.',
    },
    {
      title: 'Ethanol và acetic acid',
      summary:
        'Nhận biết nhóm chức và tính chất cơ bản qua mô hình, không tự tiến hành thí nghiệm.',
      exercise: 'Viết công thức thu gọn acetic acid.',
      answer: 'CH₃COOH.',
    },
  ],
  'biology-6': [
    {
      title: 'Tế bào',
      summary: 'Nhận biết màng tế bào, tế bào chất, nhân và vai trò của tế bào.',
      exercise: 'Đơn vị cấu tạo cơ bản của cơ thể sống là gì?',
      answer: 'Tế bào.',
    },
    {
      title: 'Cơ thể đơn bào và đa bào',
      summary: 'So sánh số lượng tế bào và các cấp tổ chức cơ thể.',
      exercise: 'Trùng roi là cơ thể đơn bào hay đa bào?',
      answer: 'Đơn bào.',
    },
    {
      title: 'Đa dạng sinh vật',
      summary: 'Phân nhóm vi khuẩn, nấm, thực vật, động vật dựa trên đặc điểm quan sát.',
      exercise: 'Nấm có tự quang hợp như cây xanh không?',
      answer: 'Không.',
    },
    {
      title: 'Thực vật và môi trường',
      summary: 'Nhận biết cơ quan thực vật và ý nghĩa bảo vệ đa dạng sinh học.',
      exercise: 'Cơ quan nào thường hấp thụ nước và muối khoáng?',
      answer: 'Rễ.',
    },
  ],
  'biology-7': [
    {
      title: 'Trao đổi chất và năng lượng',
      summary: 'Nhận biết trao đổi chất, hô hấp tế bào và nhu cầu năng lượng.',
      exercise: 'Hô hấp tế bào giải phóng hay tích trữ năng lượng?',
      answer: 'Giải phóng năng lượng.',
    },
    {
      title: 'Quang hợp',
      summary: 'Xác định nguyên liệu, điều kiện và sản phẩm của quang hợp.',
      exercise: 'Khí nào được cây sử dụng trong quang hợp?',
      answer: 'Carbon dioxide (CO₂).',
    },
    {
      title: 'Cảm ứng và sinh trưởng',
      summary: 'Nhận biết phản ứng với kích thích và các yếu tố ảnh hưởng sinh trưởng.',
      exercise: 'Cây mọc hướng về phía ánh sáng biểu hiện hiện tượng gì?',
      answer: 'Hướng sáng.',
    },
    {
      title: 'Sinh sản ở sinh vật',
      summary: 'So sánh sinh sản vô tính và hữu tính qua ví dụ quen thuộc.',
      exercise: 'Giâm cành thuộc hình thức sinh sản nào?',
      answer: 'Sinh sản vô tính.',
    },
  ],
  'biology-8': [
    {
      title: 'Vận động và cơ thể người',
      summary: 'Nhận biết xương, khớp, cơ và cách giữ tư thế học tập phù hợp.',
      exercise: 'Bộ phận nối hai đầu xương gọi là gì?',
      answer: 'Khớp xương.',
    },
    {
      title: 'Tiêu hóa và dinh dưỡng',
      summary: 'Mô tả đường đi thức ăn và vai trò các cơ quan tiêu hóa.',
      exercise: 'Cơ quan nào hấp thụ phần lớn chất dinh dưỡng?',
      answer: 'Ruột non.',
    },
    {
      title: 'Tuần hoàn và hô hấp',
      summary: 'Nhận biết tim, mạch máu, phổi và trao đổi khí.',
      exercise: 'Khí nào được đưa từ phổi vào máu khi hít thở?',
      answer: 'Oxygen (O₂).',
    },
    {
      title: 'Thần kinh và giác quan',
      summary: 'Nhận biết phản xạ, cơ quan cảm giác và vệ sinh mắt khi học tập.',
      exercise: 'Phản ứng rụt tay khi chạm vật nóng là gì?',
      answer: 'Phản xạ.',
    },
  ],
  'biology-9': [
    {
      title: 'Quy luật di truyền',
      summary: 'Phân biệt kiểu gene, kiểu hình và đọc sơ đồ lai một cặp tính trạng.',
      exercise: 'Lai Aa × Aa cho tỉ lệ kiểu gene nào?',
      answer: '1 AA : 2 Aa : 1 aa.',
    },
    {
      title: 'DNA và gene',
      summary: 'Nhận biết cấu trúc DNA, nguyên tắc bổ sung và vai trò gene.',
      exercise: 'Trong DNA, A liên kết bổ sung với base nào?',
      answer: 'T.',
    },
    {
      title: 'Nhiễm sắc thể và phân bào',
      summary: 'So sánh nguyên phân, giảm phân và ý nghĩa duy trì bộ nhiễm sắc thể.',
      exercise: 'Giảm phân làm số nhiễm sắc thể trong giao tử thay đổi thế nào?',
      answer: 'Giảm còn một nửa so với tế bào ban đầu.',
    },
    {
      title: 'Sinh thái và môi trường',
      summary: 'Nhận biết quần thể, quần xã, hệ sinh thái và đọc chuỗi thức ăn.',
      exercise: 'Trong chuỗi cỏ → châu chấu → ếch, sinh vật sản xuất là gì?',
      answer: 'Cỏ.',
    },
  ],
};

export function lessonContent(topic: Topic, phase: string): string {
  return [
    `## Mục tiêu\n${topic.summary}`,
    `## Nội dung giảng dạy\n${phase}: ${topic.title}. Giáo viên giới thiệu kiến thức, làm mẫu một bài, cho học sinh giải thích cách làm rồi luyện tập theo nhóm.`,
    `## Bài tập\n${topic.exercise}`,
    `## Hướng dẫn và đáp án\n${topic.answer} Chấm cả lập luận, đơn vị và cách trình bày; trao đổi các lỗi thường gặp.`,
    '## Tài liệu\nNội dung minh họa cho dữ liệu demo; giáo viên điều chỉnh theo tài liệu thực tế của trung tâm.',
  ].join('\n\n');
}
