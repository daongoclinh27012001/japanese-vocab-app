// =============================================
// SUPABASE CONFIG
// Thay 2 giá trị này bằng thông tin project của bạn
// Vào Supabase → Project Settings → API
// =============================================
const SUPABASE_URL = 'https://oklnvaeoydcsoctsvgam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rbG52YWVveWRjc29jdHN2Z2FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTc5MDcsImV4cCI6MjA5NzE3MzkwN30.hUxKNOkEepp7y92TQAqXgqwxOwPfWtOsOW6ARt-a1gs';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================
// HÀM FETCH TỪ VỰNG THEO BỘ LỌC
// Trả về mảng các từ phù hợp với điều kiện lọc
// =============================================
async function fetchVocabulary(filters = {}) {
  let query = supabaseClient.from('vocabulary').select('*');

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
    return [];
  }

  // Lọc theo word_classes (substring search, chạy phía client)
  // Vì cột word_classes chứa chuỗi ghép như "Danh từ, Động từ nhóm 3 (Suru)"
  let result = data;
  if (filters.wordClass && filters.wordClass.length > 0) {
    result = data.filter(row =>
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
