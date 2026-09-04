// =============================================
// SUPABASE CONFIG
// Thay 2 giá trị này bằng thông tin project của bạn
// Vào Supabase → Project Settings → API
// =============================================
const SUPABASE_URL = 'https://oklnvaeoydcsoctsvgam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rbG52YWVveWRjc29jdHN2Z2FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTc5MDcsImV4cCI6MjA5NzE3MzkwN30.hUxKNOkEepp7y92TQAqXgqwxOwPfWtOsOW6ARt-a1gs';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    // Ép mọi request tới Supabase bỏ qua cache của trình duyệt.
    // Nếu không có dòng này, có thiết bị/trình duyệt sẽ tiếp tục
    // hiển thị dữ liệu cũ (vd: tổng số từ) dù dữ liệu trên server
    // đã thay đổi, cho tới khi hard-reload (Ctrl+Shift+R).
    fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
  },
});

// =============================================
// HÀM FETCH TỪ VỰNG THEO BỘ LỌC
// Trả về mảng các từ phù hợp với điều kiện lọc
// =============================================
async function fetchVocabulary(filters = {}) {
  // Supabase REST API mặc định giới hạn 1000 dòng / request.
  // Nếu bảng "vocabulary" vượt quá 1000 dòng, cần phân trang (range)
  // để lấy được TOÀN BỘ dữ liệu, tránh bị cắt bớt âm thầm.
  const PAGE_SIZE = 1000;
  let allRows = [];
  let from = 0;

  while (true) {
    let query = supabaseClient.from('vocabulary').select('*').range(from, from + PAGE_SIZE - 1);

    // Lọc theo level
    if (filters.level && filters.level.length > 0) {
      query = query.in('level', filters.level);
    }

    // Lọc theo topic
    if (filters.topic && filters.topic.length > 0) {
      query = query.in('topic', filters.topic);
    }

    // Lọc theo kanji: kiểm tra vocabulary có chứa ký tự kanji không
    // Nếu chọn nhiều kanji, lấy union (OR)
    if (filters.kanji && filters.kanji.length > 0) {
      const kanjiConditions = filters.kanji
        .map(k => `vocabulary.ilike.%${k}%`)
        .join(',');
      query = query.or(kanjiConditions);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Lỗi fetch vocabulary:', error);
      return allRows; // trả về những gì đã lấy được thay vì mất trắng
    }

    allRows = allRows.concat(data);

    // Hết dữ liệu (trang trả về ít hơn PAGE_SIZE) → dừng vòng lặp
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Lọc theo word_classes (substring search, chạy phía client)
  // Vì cột word_classes chứa chuỗi ghép như "Danh từ, Động từ nhóm 3 (Suru)"
  let result = allRows;
  if (filters.wordClass && filters.wordClass.length > 0) {
    result = allRows.filter(row =>
      filters.wordClass.some(wc => row.word_classes && row.word_classes.includes(wc))
    );
  }

  return result;
}

// =============================================
// HÀM FETCH KANJI (cho dropdown bộ lọc)
// =============================================
async function fetchKanjiList() {
  const { data, error } = await supabaseClient
    .from('kanji')
    .select('character, han_viet, meaning, level')
    .order('level', { ascending: true });

  if (error) {
    console.error('Lỗi fetch kanji:', error);
    return [];
  }
  return data;
}

// =============================================
// HÀM LẤY TẤT CẢ CÁC NGHĨA CỦA 1 TỪ NHẬT
// Dùng để hiển thị giải thích sau khi trả lời
// =============================================
async function fetchAllMeanings(vocabulary) {
  const { data, error } = await supabaseClient
    .from('vocabulary')
    .select('meaning, word_classes, example, example_translation_vi, example_translation_en')
    .eq('vocabulary', vocabulary);

  if (error) {
    console.error('Lỗi fetch meanings:', error);
    return [];
  }
  return data;
}

// =============================================
// SỬA / XÓA MỘT NGHĨA CỦA TỪ (dùng trong lúc xem giải thích sau khi trả lời)
// Thao tác trực tiếp trên bảng "vocabulary", theo id của dòng (mỗi dòng = 1 nghĩa)
// =============================================
async function updateVocabularyMeaning(id, newMeaning) {
  const { error } = await supabaseClient
    .from('vocabulary')
    .update({ meaning: newMeaning })
    .eq('id', id);

  if (error) {
    console.error('Lỗi cập nhật nghĩa:', error);
    return false;
  }
  return true;
}

async function deleteVocabularyMeaning(id) {
  const { error } = await supabaseClient
    .from('vocabulary')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Lỗi xóa nghĩa:', error);
    return false;
  }
  return true;
}

// =============================================
// HÀM FETCH TIẾN ĐỘ TÍCH LŨY THEO MÃ ĐỒNG BỘ
// Trả về: { words, masteredWords } nếu tìm thấy, null nếu chưa có mã này
// =============================================
async function fetchAccumulateProgress(syncCode) {
  const { data, error } = await supabaseClient
    .from('accumulate_progress')
    .select('words, mastered_words')
    .eq('sync_code', syncCode)
    .maybeSingle();

  if (error) {
    console.error('Lỗi fetch tiến độ tích lũy:', error);
    return null;
  }
  if (!data) return null;

  return {
    words: data.words || [],
    masteredWords: data.mastered_words || [],
  };
}

// =============================================
// HÀM LƯU TIẾN ĐỘ TÍCH LŨY LÊN SUPABASE
// Upsert: nếu mã chưa tồn tại thì tạo mới, có rồi thì cập nhật
// words: toàn bộ từ đã tích lũy
// masteredWords: tập con của words đã được đánh dấu "học thuộc"
//                (vẫn tính vào quỹ tích lũy, nhưng không lặp lại trong câu hỏi)
// =============================================
async function saveAccumulateProgress(syncCode, words, masteredWords = []) {
  const { error } = await supabaseClient
    .from('accumulate_progress')
    .upsert(
      { sync_code: syncCode, words, mastered_words: masteredWords },
      { onConflict: 'sync_code' }
    );

  if (error) {
    console.error('Lỗi lưu tiến độ tích lũy:', error);
    return false;
  }
  return true;
}
