// =============================================
// CHẾ ĐỘ TÍCH LŨY (ĐỒNG BỘ ĐA THIẾT BỊ)
//
// Tiến độ (danh sách các từ đã tích lũy) được lưu trên
// Supabase, gắn với một "mã đồng bộ" (sync code) ngẫu nhiên.
// Mã này được lưu trong localStorage của trình duyệt để
// tự động load lại. Muốn dùng ở thiết bị khác, chỉ cần
// nhập đúng mã đồng bộ vào ô "Đồng bộ thiết bị khác".
//
// Từ đã tích lũy có thể được đánh dấu "đã học thuộc":
// - Vẫn tính vào quỹ tích lũy (số đếm, %).
// - Nhưng sẽ KHÔNG xuất hiện trong các bài quiz nữa,
//   trừ khi được bỏ đánh dấu.
// =============================================

const SYNC_CODE_KEY = 'jp_accumulate_sync_code'; // localStorage: chỉ lưu MÃ, không lưu tiến độ
const BATCH_SIZE = 20;
const MIN_TO_REVIEW = 4; // số từ CHƯA học thuộc tối thiểu để bắt đầu quiz

let allVocabData = [];     // toàn bộ dòng dữ liệu từ Supabase (chưa dedupe)
let uniqueAllWords = [];   // danh sách unique các từ (giá trị cột vocabulary) trong toàn DB
let accumulatedWords = []; // danh sách các từ đã tích lũy (nguồn thật nằm trên Supabase)
let masteredWords = [];    // tập con của accumulatedWords đã đánh dấu "học thuộc"
let syncCode = '';         // mã đồng bộ hiện tại

// =============================================
// UTILS
// =============================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, n) {
  return shuffle(arr).slice(0, n);
}

// Tạo mã đồng bộ ngẫu nhiên, ví dụ: "K3F9-QX7A"
function generateSyncCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm (0/O, 1/I)
  const part = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${part()}-${part()}`;
}

function setLoading(isLoading) {
  const btnMore = document.getElementById('btn-add-more');
  btnMore.disabled = isLoading;
  document.getElementById('sync-status').textContent = isLoading ? 'Đang đồng bộ...' : '';
}

// =============================================
// TẢI TIẾN ĐỘ TỪ SUPABASE THEO MÃ ĐỒNG BỘ
// =============================================
async function loadProgressFromCloud(code) {
  const progress = await fetchAccumulateProgress(code);

  if (progress === null) {
    // Mã chưa tồn tại trên Supabase → coi như tiến độ trống, sẽ tạo mới khi lưu lần đầu
    accumulatedWords = [];
    masteredWords = [];
  } else {
    // Loại bỏ các từ không còn tồn tại trong DB (phòng khi dữ liệu vocab thay đổi)
    accumulatedWords = progress.words.filter(w => uniqueAllWords.includes(w));
    // masteredWords chỉ hợp lệ nếu vẫn còn nằm trong accumulatedWords
    masteredWords = progress.masteredWords.filter(w => accumulatedWords.includes(w));
  }
}

async function saveProgressToCloud() {
  const ok = await saveAccumulateProgress(syncCode, accumulatedWords, masteredWords);
  if (!ok) {
    alert('Không thể lưu tiến độ lên máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.');
  }
  return ok;
}

// =============================================
// TÍCH LŨY THÊM TỪ MỚI
// =============================================
async function addMoreWords() {
  const remaining = uniqueAllWords.filter(w => !accumulatedWords.includes(w));
  if (remaining.length === 0) {
    renderProgress();
    return;
  }

  const picked = pickRandom(remaining, Math.min(BATCH_SIZE, remaining.length));
  const previous = [...accumulatedWords];
  accumulatedWords.push(...picked);

  setLoading(true);
  const ok = await saveProgressToCloud();
  setLoading(false);

  if (!ok) {
    accumulatedWords = previous; // rollback nếu lưu thất bại
  }
  renderProgress();
}

// =============================================
// ĐÁNH DẤU / BỎ ĐÁNH DẤU "ĐÃ HỌC THUỘC"
// (dùng cho danh sách trong trang này; trong lúc làm quiz,
// việc đánh dấu được xử lý trực tiếp trong quiz.js)
// =============================================
async function unmarkMastered(word) {
  const previous = [...masteredWords];
  masteredWords = masteredWords.filter(w => w !== word);

  setLoading(true);
  const ok = await saveProgressToCloud();
  setLoading(false);

  if (!ok) masteredWords = previous;
  renderProgress();
}

// =============================================
// RENDER TIẾN ĐỘ + BẬT/TẮT NÚT
// =============================================
function renderProgress() {
  const total = uniqueAllWords.length;
  const count = accumulatedWords.length;
  const masteredCount = masteredWords.length;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const remainingToReview = count - masteredCount;

  document.getElementById('acc-count').textContent = count;
  document.getElementById('acc-total').textContent = total;
  document.getElementById('acc-pct').textContent = `${pct}%`;
  document.getElementById('acc-progress-fill').style.width = `${pct}%`;
  document.getElementById('sync-code-display').textContent = syncCode;
  document.getElementById('acc-mastered').textContent = masteredCount;

  const canStart = remainingToReview >= MIN_TO_REVIEW;
  document.querySelectorAll('.quiz-start-btn').forEach(btn => {
    btn.disabled = !canStart;
  });

  const hint = document.getElementById('mastery-hint');
  if (hint) {
    hint.style.display = count > 0 && !canStart ? 'block' : 'none';
  }

  const btnMore = document.getElementById('btn-add-more');
  if (count >= total) {
    btnMore.disabled = true;
    btnMore.textContent = '🏆 Đã tích lũy hết toàn bộ từ vựng!';
  } else {
    btnMore.disabled = false;
    btnMore.textContent = `🎯 Tích lũy thêm ${Math.min(BATCH_SIZE, total - count)} từ`;
  }

  renderMasteredList();
}

// =============================================
// RENDER DANH SÁCH TỪ ĐÃ HỌC THUỘC (bấm để bỏ đánh dấu)
// =============================================
function renderMasteredList() {
  const card = document.getElementById('mastered-card');
  const list = document.getElementById('mastered-list');
  if (!card || !list) return;

  document.getElementById('mastered-count').textContent = masteredWords.length;

  if (masteredWords.length === 0) {
    card.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  card.style.display = 'block';
  list.innerHTML = masteredWords.map(w =>
    `<button class="chip active" data-value="${w}" title="Bấm để bỏ đánh dấu học thuộc">${w}</button>`
  ).join('');

  list.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => unmarkMastered(chip.dataset.value));
  });
}

// =============================================
// BẮT ĐẦU LÀM BÀI (dùng lại quiz.html/quiz.js có sẵn)
// =============================================
function startQuiz(type) {
  const filtered = allVocabData.filter(r => accumulatedWords.includes(r.vocabulary));
  sessionStorage.setItem('filtered_vocab', JSON.stringify(filtered));
  sessionStorage.setItem('accumulated_words', JSON.stringify(accumulatedWords));
  sessionStorage.setItem('mastered_words', JSON.stringify(masteredWords));

  const timerOn = document.getElementById('timer-toggle').checked;
  const timerMin = parseInt(document.getElementById('timer-minutes').value) || 5;

  // source=accumulate + sync=<mã> để quiz.js biết:
  // 1) loại trừ từ đã học thuộc khỏi câu hỏi
  // 2) cho phép đánh dấu "học thuộc" ngay trong lúc làm bài, và lưu lên Supabase
  const params = new URLSearchParams({
    type,
    timer: timerOn ? timerMin : 0,
    source: 'accumulate',
    sync: syncCode,
  });
  window.location.href = `quiz.html?${params.toString()}`;
}

// =============================================
// CHUYỂN SANG MÃ ĐỒNG BỘ KHÁC (dùng ở thiết bị khác)
// =============================================
async function loadProgressFromCloudSafe(code) {
  try {
    await loadProgressFromCloud(code);
  } catch (e) {
    console.error(e);
    alert('Không tìm thấy hoặc không thể tải mã đồng bộ này.');
  }
}

async function switchToSyncCode(newCode) {
  newCode = newCode.trim().toUpperCase();
  if (!newCode) return;

  setLoading(true);
  await loadProgressFromCloudSafe(newCode);
  setLoading(false);

  syncCode = newCode;
  localStorage.setItem(SYNC_CODE_KEY, syncCode);
  renderProgress();
}

// =============================================
// EVENT LISTENERS
// =============================================
function setupEventListeners() {
  document.getElementById('btn-add-more').addEventListener('click', addMoreWords);

  document.getElementById('btn-reset').addEventListener('click', async () => {
    const confirmed = confirm(
      'Bạn có chắc muốn xóa toàn bộ tiến độ tích lũy (trên mã đồng bộ hiện tại) và bắt đầu lại từ đầu?\nHành động này không thể hoàn tác.'
    );
    if (!confirmed) return;

    accumulatedWords = [];
    masteredWords = [];
    setLoading(true);
    await saveProgressToCloud();
    setLoading(false);
    await addMoreWords();
  });

  document.querySelectorAll('.quiz-start-btn').forEach(btn => {
    btn.addEventListener('click', () => startQuiz(btn.dataset.type));
  });

  document.getElementById('timer-toggle').addEventListener('change', function () {
    document.getElementById('timer-input-wrap').style.display =
      this.checked ? 'flex' : 'none';
  });

  // Sao chép mã đồng bộ
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(syncCode).then(() => {
      const el = document.getElementById('btn-copy-code');
      const old = el.textContent;
      el.textContent = '✅ Đã sao chép';
      setTimeout(() => (el.textContent = old), 1500);
    });
  });

  // Nhập mã đồng bộ từ thiết bị khác
  document.getElementById('btn-use-code').addEventListener('click', async () => {
    const input = document.getElementById('input-sync-code');
    const newCode = input.value.trim();
    if (!newCode) return;

    const confirmed = confirm(
      `Chuyển sang dùng mã "${newCode.toUpperCase()}"?\nTiến độ hiện tại trên thiết bị này vẫn được giữ trên máy chủ, bạn có thể quay lại bằng mã "${syncCode}".`
    );
    if (!confirmed) return;

    await switchToSyncCode(newCode);
    input.value = '';
  });
}

// =============================================
// KHỞI ĐỘNG
// =============================================
async function init() {
  setLoading(true);

  allVocabData = await fetchVocabulary({}); // lấy toàn bộ, không lọc
  uniqueAllWords = [...new Set(allVocabData.map(r => r.vocabulary).filter(Boolean))];

  // Lấy mã đồng bộ đã lưu trong trình duyệt này, hoặc tạo mã mới
  syncCode = localStorage.getItem(SYNC_CODE_KEY) || generateSyncCode();
  localStorage.setItem(SYNC_CODE_KEY, syncCode);

  await loadProgressFromCloud(syncCode);

  setLoading(false);

  if (accumulatedWords.length === 0) {
    await addMoreWords(); // lần đầu vào (hoặc mã mới): tự động lấy 20 từ ngẫu nhiên
  } else {
    renderProgress();
  }

  setupEventListeners();
}

init();
