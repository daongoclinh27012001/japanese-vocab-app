// =============================================
// CHẾ ĐỘ TÍCH LŨY (ĐỒNG BỘ ĐA THIẾT BỊ)
//
// Tiến độ (danh sách các từ đã tích lũy) được lưu trên
// Supabase, gắn với một "mã đồng bộ" (sync code) ngẫu nhiên.
// Mã này được lưu trong localStorage của trình duyệt để
// tự động load lại. Muốn dùng ở thiết bị khác, chỉ cần
// nhập đúng mã đồng bộ vào ô "Đồng bộ thiết bị khác".
// =============================================

const SYNC_CODE_KEY = 'jp_accumulate_sync_code'; // localStorage: chỉ lưu MÃ, không lưu tiến độ
const BATCH_SIZE = 20;

let allVocabData = [];     // toàn bộ dòng dữ liệu từ Supabase (chưa dedupe)
let uniqueAllWords = [];   // danh sách unique các từ (giá trị cột vocabulary) trong toàn DB
let accumulatedWords = []; // danh sách các từ đã tích lũy (nguồn thật nằm trên Supabase)
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
  const words = await fetchAccumulateProgress(code);

  if (words === null) {
    // Mã chưa tồn tại trên Supabase → coi như tiến độ trống, sẽ tạo mới khi lưu lần đầu
    accumulatedWords = [];
  } else {
    // Loại bỏ các từ không còn tồn tại trong DB (phòng khi dữ liệu vocab thay đổi)
    accumulatedWords = words.filter(w => uniqueAllWords.includes(w));
  }
}

async function saveProgressToCloud() {
  const ok = await saveAccumulateProgress(syncCode, accumulatedWords);
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
// RENDER TIẾN ĐỘ + BẬT/TẮT NÚT
// =============================================
function renderProgress() {
  const total = uniqueAllWords.length;
  const count = accumulatedWords.length;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  document.getElementById('acc-count').textContent = count;
  document.getElementById('acc-total').textContent = total;
  document.getElementById('acc-pct').textContent = `${pct}%`;
  document.getElementById('acc-progress-fill').style.width = `${pct}%`;
  document.getElementById('sync-code-display').textContent = syncCode;

  const canStart = count >= 4;
  document.querySelectorAll('.quiz-start-btn').forEach(btn => {
    btn.disabled = !canStart;
  });

  const btnMore = document.getElementById('btn-add-more');
  if (count >= total) {
    btnMore.disabled = true;
    btnMore.textContent = '🏆 Đã tích lũy hết toàn bộ từ vựng!';
  } else {
    btnMore.disabled = false;
    btnMore.textContent = `🎯 Tích lũy thêm ${Math.min(BATCH_SIZE, total - count)} từ`;
  }
}

// =============================================
// BẮT ĐẦU LÀM BÀI (dùng lại quiz.html/quiz.js có sẵn)
// =============================================
function startQuiz(type) {
  const filtered = allVocabData.filter(r => accumulatedWords.includes(r.vocabulary));
  sessionStorage.setItem('filtered_vocab', JSON.stringify(filtered));

  const timerOn = document.getElementById('timer-toggle').checked;
  const timerMin = parseInt(document.getElementById('timer-minutes').value) || 5;

  const params = new URLSearchParams({
    type,
    timer: timerOn ? timerMin : 0,
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
