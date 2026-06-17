// =============================================
// TRẠNG THÁI BỘ LỌC HIỆN TẠI
// =============================================
const state = {
  level: [],
  topic: [],
  wordClass: [],
  kanji: [],
  quizType: null,
  timerEnabled: false,
  timerMinutes: 5,
};

// Cache toàn bộ data để preview nhanh (không cần gọi API mỗi lần click)
let allVocabData = [];
let allKanjiData = [];

// =============================================
// KHỞI ĐỘNG: load data, render giao diện
// =============================================
async function init() {
  // Load song song 2 thứ
  const [vocab, kanji] = await Promise.all([
    fetchVocabulary({}),   // lấy toàn bộ không lọc
    fetchKanjiList(),
  ]);

  allVocabData = vocab;
  allKanjiData = kanji;

  renderTopicChips();
  renderKanjiChips(kanji);
  updatePreview();
  setupEventListeners();
}

// =============================================
// RENDER CHIP CHỦ ĐỀ (lấy từ data thực tế)
// =============================================
function renderTopicChips() {
  const topics = [...new Set(allVocabData.map(r => r.topic).filter(Boolean))].sort();
  const container = document.getElementById('filter-topic');
  container.innerHTML = topics.map(t =>
    `<button class="chip" data-value="${t}">${t}</button>`
  ).join('');

  // Gắn event cho chip vừa tạo
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => toggleFilter('topic', chip));
  });
}

// =============================================
// RENDER CHIP KANJI
// =============================================
function renderKanjiChips(list) {
  const container = document.getElementById('filter-kanji');
  if (list.length === 0) {
    container.innerHTML = '<span style="color:#aaa; font-size:0.85rem;">Không có dữ liệu</span>';
    return;
  }
  container.innerHTML = list.map(k =>
    `<button class="chip" data-value="${k.character}" title="${k.han_viet} — ${k.meaning}">
      ${k.character} <span style="font-size:0.7rem; opacity:0.7;">${k.han_viet}</span>
    </button>`
  ).join('');

  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => toggleFilter('kanji', chip));
  });
}

// =============================================
// SEARCH KANJI
// =============================================
document.getElementById('kanji-search').addEventListener('input', function () {
  const q = this.value.toLowerCase().trim();
  const filtered = q
    ? allKanjiData.filter(k =>
        k.character.includes(q) ||
        (k.han_viet && k.han_viet.toLowerCase().includes(q)) ||
        (k.meaning && k.meaning.toLowerCase().includes(q))
      )
    : allKanjiData;
  renderKanjiChips(filtered);

  // Giữ lại active state cho những chip đã chọn
  document.querySelectorAll('#filter-kanji .chip').forEach(chip => {
    if (state.kanji.includes(chip.dataset.value)) chip.classList.add('active');
  });
});

// =============================================
// TOGGLE CHIP (bật/tắt bộ lọc)
// =============================================
function toggleFilter(type, chip) {
  const value = chip.dataset.value;
  const arr = state[type];
  const idx = arr.indexOf(value);

  if (idx === -1) arr.push(value);
  else arr.splice(idx, 1);

  chip.classList.toggle('active', arr.includes(value));
  updatePreview();
}

// =============================================
// CẬP NHẬT PREVIEW SỐ TỪ (chạy phía client, không cần API)
// =============================================
function updatePreview() {
  let filtered = allVocabData;

  // Lọc level
  if (state.level.length > 0) {
    filtered = filtered.filter(r => state.level.includes(r.level));
  }

  // Lọc topic
  if (state.topic.length > 0) {
    filtered = filtered.filter(r => state.topic.includes(r.topic));
  }

  // Lọc word class (substring)
  if (state.wordClass.length > 0) {
    filtered = filtered.filter(r =>
      state.wordClass.some(wc => r.word_classes && r.word_classes.includes(wc))
    );
  }

  // Lọc kanji (từ vựng có chứa ký tự kanji)
  if (state.kanji.length > 0) {
    filtered = filtered.filter(r =>
      state.kanji.some(k => r.vocabulary && r.vocabulary.includes(k))
    );
  }

  // Đếm số từ unique (theo từ tiếng Nhật, không phải số dòng)
  const uniqueWords = new Set(filtered.map(r => r.vocabulary)).size;
  const totalRows = filtered.length;

  document.getElementById('preview-count').textContent = uniqueWords;
  document.getElementById('preview-note').textContent =
    totalRows > uniqueWords ? `(${totalRows} nghĩa)` : '';

  // Lưu data đã lọc vào sessionStorage để quiz.js dùng
  sessionStorage.setItem('filtered_vocab', JSON.stringify(filtered));

  // Bật/tắt nút bắt đầu
  const canStart = uniqueWords >= 4; // cần ít nhất 4 từ unique để tạo bài
  document.querySelectorAll('.quiz-start-btn').forEach(btn => {
    btn.disabled = !canStart;
  });

  // Hiện/ẩn timer card
  document.getElementById('timer-card').style.display = canStart ? 'block' : 'none';
}

// =============================================
// SETUP TẤT CẢ EVENT LISTENERS
// =============================================
function setupEventListeners() {
  // Chip level
  document.querySelectorAll('#filter-level .chip').forEach(chip => {
    chip.addEventListener('click', () => toggleFilter('level', chip));
  });

  // Chip word class
  document.querySelectorAll('#filter-wordclass .chip').forEach(chip => {
    chip.addEventListener('click', () => toggleFilter('wordClass', chip));
  });

  // Nút bắt đầu quiz
  document.querySelectorAll('.quiz-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const timerOn = document.getElementById('timer-toggle').checked;
      const timerMin = parseInt(document.getElementById('timer-minutes').value) || 5;

      // Truyền params qua URL
      const params = new URLSearchParams({
        type,
        timer: timerOn ? timerMin : 0,
      });
      window.location.href = `quiz.html?${params.toString()}`;
    });
  });

  // Toggle timer input
  document.getElementById('timer-toggle').addEventListener('change', function () {
    document.getElementById('timer-input-wrap').style.display =
      this.checked ? 'flex' : 'none';
  });
}

// =============================================
// CHẠY
// =============================================
init();
