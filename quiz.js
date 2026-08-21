// =============================================
// ĐỌC PARAMS TỪ URL + DATA TỪ SESSIONSTORAGE
// =============================================
const params = new URLSearchParams(window.location.search);
const QUIZ_TYPE = params.get('type') || 'multiple';   // multiple | matching | typing
const TIMER_SECONDS = parseInt(params.get('timer') || '0') * 60;

// Nếu đến từ chế độ tích lũy: source=accumulate&sync=<mã>
// → cho phép đánh dấu "đã học thuộc" ngay trong lúc làm bài,
//   và loại các từ đã học thuộc khỏi việc tạo câu hỏi.
const SOURCE = params.get('source') || '';
const SYNC_CODE = params.get('sync') || '';
const IS_ACCUMULATE = SOURCE === 'accumulate' && !!SYNC_CODE;
const BACK_URL = SOURCE === 'accumulate' ? 'accumulate.html' : 'index.html';

// Data từ vựng đã lọc (sessionStorage set bởi filter.js hoặc accumulate.js)
const rawData = JSON.parse(sessionStorage.getItem('filtered_vocab') || '[]');

// Toàn bộ danh sách từ đã tích lũy + đã học thuộc (chỉ có ý nghĩa khi IS_ACCUMULATE)
// accumulatedWordsAll cần thiết để lưu lại đúng lên Supabase (upsert ghi đè toàn bộ mảng)
const accumulatedWordsAll = IS_ACCUMULATE
  ? JSON.parse(sessionStorage.getItem('accumulated_words') || '[]')
  : [];
let masteredWords = IS_ACCUMULATE
  ? JSON.parse(sessionStorage.getItem('mastered_words') || '[]')
  : [];

// Nếu không có data → quay về trang chủ tương ứng
if (rawData.length === 0) {
  alert('Không có dữ liệu từ vựng. Vui lòng chọn lại bộ lọc.');
  window.location.href = BACK_URL;
}

// =============================================
// UTILS
// =============================================

// Shuffle mảng (Fisher-Yates)
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Lấy ngẫu nhiên n phần tử từ mảng
function pickRandom(arr, n) {
  return shuffle(arr).slice(0, n);
}

// =============================================
// XỬ LÝ TRÙNG LẶP TỪ NHẬT
// Mỗi từ tiếng Nhật chỉ xuất hiện 1 lần trong 1 bài
// Lấy 1 dòng đại diện cho mỗi từ (random)
// =============================================
function deduplicateByWord(data) {
  const map = {};
  data.forEach(row => {
    const key = row.vocabulary;
    if (!map[key]) map[key] = [];
    map[key].push(row);
  });

  // Với mỗi từ, random chọn 1 dòng làm đại diện
  return Object.values(map).map(rows => {
    const rep = rows[Math.floor(Math.random() * rows.length)];
    rep._allMeanings = rows; // giữ tất cả nghĩa để show giải thích
    return rep;
  });
}

// Deduplicate toàn bộ data
const uniqueWordsAll = deduplicateByWord(rawData);

// Nếu là chế độ tích lũy: loại các từ đã đánh dấu "học thuộc" khỏi
// nguồn tạo câu hỏi (nhưng chúng vẫn được tính trong quỹ tích lũy ở accumulate.js)
let uniqueWords = IS_ACCUMULATE
  ? uniqueWordsAll.filter(w => !masteredWords.includes(w.vocabulary))
  : uniqueWordsAll;

// =============================================
// TRẠNG THÁI BÀI THI
// =============================================
let questions = [];      // danh sách câu hỏi đã generate
let currentIdx = 0;      // câu hiện tại
let score = 0;           // số câu đúng
let answered = false;    // đã trả lời câu hiện tại chưa
let timerInterval = null;
let timeLeft = TIMER_SECONDS;

// Lưu lại lịch sử trả lời để show kết quả
const history = [];      // [{question, userAnswer, correct, word}]

// =============================================
// ĐÁNH DẤU / BỎ ĐÁNH DẤU "ĐÃ HỌC THUỘC" NGAY TRONG LÚC LÀM BÀI
// Chỉ hoạt động khi đến từ chế độ tích lũy (IS_ACCUMULATE)
// =============================================
async function toggleMastery(vocab, btn) {
  if (!IS_ACCUMULATE) return;

  const idx = masteredWords.indexOf(vocab);
  const willBeMastered = idx === -1;

  if (willBeMastered) masteredWords.push(vocab);
  else masteredWords.splice(idx, 1);

  sessionStorage.setItem('mastered_words', JSON.stringify(masteredWords));

  if (btn) {
    btn.classList.toggle('is-mastered', willBeMastered);
    btn.textContent = willBeMastered
      ? '✅ Đã đánh dấu học thuộc — bấm để bỏ'
      : '🎓 Đánh dấu đã học thuộc';
  }

  const ok = await saveAccumulateProgress(SYNC_CODE, accumulatedWordsAll, masteredWords);
  if (!ok) {
    alert('Không thể lưu trạng thái học thuộc lên máy chủ. Vui lòng kiểm tra kết nối mạng.');
  }
}

function masteryButtonHTML(vocab, small) {
  if (!IS_ACCUMULATE) return '';
  const isMastered = masteredWords.includes(vocab);
  const cls = `btn-mastery${small ? ' btn-mastery-sm' : ''}${isMastered ? ' is-mastered' : ''}`;
  const label = small
    ? (isMastered ? '✅ Đã thuộc' : '🎓 Đánh dấu')
    : (isMastered ? '✅ Đã đánh dấu học thuộc — bấm để bỏ' : '🎓 Đánh dấu đã học thuộc');
  return `<button class="${cls}" data-word="${vocab}">${label}</button>`;
}

// =============================================
// GENERATE CÂU HỎI
// =============================================
function generateQuestions() {
  if (QUIZ_TYPE === 'multiple') return generateMultiple();
  if (QUIZ_TYPE === 'matching') return generateMatching();
  if (QUIZ_TYPE === 'typing')   return generateTyping();
  return [];
}

// --- TRẮC NGHIỆM ---
// 20 câu, mỗi câu 4 đáp án
// Câu hỏi random theo 2 mẫu:
//   A) "Từ [JP] có nghĩa là gì?" → đáp án là nghĩa tiếng Việt
//   B) "[Nghĩa TV] trong tiếng Nhật là gì?" → đáp án là từ tiếng Nhật
function generateMultiple() {
  const pool = shuffle(uniqueWords).slice(0, 20);
  return pool.map(item => {
    const mode = Math.random() < 0.5 ? 'jp2vi' : 'vi2jp';

    // Lấy 3 từ khác làm đáp án sai (đảm bảo không trùng vocabulary)
    const others = uniqueWords.filter(w => w.vocabulary !== item.vocabulary);
    const wrongs = pickRandom(others, 3);

    let question, correctAnswer, wrongAnswers;

    if (mode === 'jp2vi') {
      question = item.vocabulary;
      correctAnswer = item.meaning;
      wrongAnswers = wrongs.map(w => w.meaning);
    } else {
      question = item.meaning;
      correctAnswer = item.vocabulary;
      wrongAnswers = wrongs.map(w => w.vocabulary);
    }

    const options = shuffle([correctAnswer, ...wrongAnswers]);

    return {
      type: 'multiple',
      mode,
      question,
      pronunciation: item.pronunciation,
      correctAnswer,
      options,
      word: item,           // dòng đại diện
      allMeanings: item._allMeanings,
    };
  });
}

// --- NỐI TỪ ---
// 4 lượt, mỗi lượt 5 cặp (từ JP — nghĩa TV)
// Đảm bảo trong 1 lượt không có 2 từ JP trùng nhau
function generateMatching() {
  const pool = shuffle(uniqueWords).slice(0, 20); // tối đa 20 từ (4 lượt × 5)
  const rounds = [];

  for (let i = 0; i < 4; i++) {
    const slice = pool.slice(i * 5, i * 5 + 5);
    if (slice.length < 2) break; // không đủ từ thì bỏ lượt

    rounds.push({
      type: 'matching',
      pairs: slice.map(item => ({
        jp: item.vocabulary,
        vi: item.meaning,
        pronunciation: item.pronunciation,
        word: item,
        allMeanings: item._allMeanings,
      })),
    });
  }
  return rounds;
}

// --- GÕ CHỮ ---
// 20 câu, hỏi nghĩa tiếng Việt → gõ từ tiếng Nhật
function generateTyping() {
  const pool = shuffle(uniqueWords).slice(0, 20);
  return pool.map(item => ({
    type: 'typing',
    question: item.meaning,
    correctAnswer: item.vocabulary,
    pronunciation: item.pronunciation,
    word: item,
    allMeanings: item._allMeanings,
  }));
}

// =============================================
// RENDER CÂU HỎI
// =============================================
function renderQuestion() {
  const q = questions[currentIdx];
  const total = questions.length;
  answered = false;

  // Progress
  document.getElementById('progress-bar').style.width =
    `${(currentIdx / total) * 100}%`;
  document.getElementById('question-number').textContent =
    QUIZ_TYPE === 'matching'
      ? `Lượt ${currentIdx + 1} / ${total}`
      : `Câu ${currentIdx + 1} / ${total}`;

  document.getElementById('btn-next').style.display = 'none';

  if (q.type === 'multiple') renderMultiple(q);
  else if (q.type === 'matching') renderMatching(q);
  else if (q.type === 'typing') renderTyping(q);
}

// --- RENDER TRẮC NGHIỆM ---
function renderMultiple(q) {
  const isJP = q.mode === 'jp2vi';
  document.getElementById('quiz-body').innerHTML = `
    <p class="question-text">${isJP ? 'Từ này có nghĩa là gì?' : 'Từ này trong tiếng Nhật là gì?'}</p>
    <div class="question-jp">${q.question}</div>
    ${isJP && q.pronunciation ? `<div style="color:#aaa; font-size:0.9rem; margin-top:-12px; margin-bottom:16px;">${q.pronunciation}</div>` : ''}
    <div class="options-list" id="options-list">
      ${q.options.map((opt, i) => `
        <button class="option-btn" data-index="${i}" data-value="${opt}">
          ${String.fromCharCode(65 + i)}. ${opt}
        </button>
      `).join('')}
    </div>
    <div class="explanation" id="explanation"></div>
  `;

  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => handleMultipleAnswer(btn, q));
  });
}

function handleMultipleAnswer(btn, q) {
  if (answered) return;
  answered = true;

  const selected = btn.dataset.value;
  const isCorrect = selected === q.correctAnswer;
  if (isCorrect) score++;

  // Đánh dấu đúng/sai
  document.querySelectorAll('.option-btn').forEach(b => {
    b.disabled = true;
    if (b.dataset.value === q.correctAnswer) b.classList.add('correct');
    else if (b === btn && !isCorrect) b.classList.add('wrong');
  });

  // Lưu lịch sử
  history.push({
    question: q.question,
    userAnswer: selected,
    correctAnswer: q.correctAnswer,
    correct: isCorrect,
    word: q.word,
    allMeanings: q.allMeanings,
  });

  showExplanation(q.word, q.allMeanings);
  document.getElementById('btn-next').style.display = 'block';
}

// --- RENDER NỐI TỪ ---
function renderMatching(q) {
  const leftItems = shuffle(q.pairs.map(p => p.jp));
  const rightItems = shuffle(q.pairs.map(p => p.vi));

  document.getElementById('quiz-body').innerHTML = `
    <p class="question-text" style="margin-bottom:16px;">Nối từ tiếng Nhật với nghĩa tương ứng</p>
    <div id="matching-area" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:start;">
      <div id="col-left" style="display:flex; flex-direction:column; gap:8px;">
        ${leftItems.map(jp => `
          <button class="option-btn match-left" data-jp="${jp}" style="text-align:center; font-size:1.1rem; font-weight:800; color:#c0392b;">
            ${jp}
          </button>
        `).join('')}
      </div>
      <div id="col-right" style="display:flex; flex-direction:column; gap:8px;">
        ${rightItems.map(vi => `
          <button class="option-btn match-right" data-vi="${vi}" style="font-size:0.82rem;">
            ${vi}
          </button>
        `).join('')}
      </div>
    </div>
    <div id="matching-feedback" style="margin-top:14px; font-size:0.85rem; color:#888; min-height:20px;"></div>
    <div class="explanation" id="explanation"></div>
  `;

  setupMatchingLogic(q);
}

function setupMatchingLogic(q) {
  // Map jp → vi để check đáp án
  const correctMap = {};
  q.pairs.forEach(p => { correctMap[p.jp] = p.vi; });

  let selectedLeft = null;
  let matchedCount = 0;
  const totalPairs = q.pairs.length;

  document.querySelectorAll('.match-left').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      document.querySelectorAll('.match-left').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedLeft = btn.dataset.jp;
    });
  });

  document.querySelectorAll('.match-right').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!selectedLeft || btn.disabled) return;

      const selectedVI = btn.dataset.vi;
      const isCorrect = correctMap[selectedLeft] === selectedVI;

      const leftBtn = document.querySelector(`.match-left[data-jp="${selectedLeft}"]`);

      if (isCorrect) {
        leftBtn.classList.add('correct');
        leftBtn.disabled = true;
        btn.classList.add('correct');
        btn.disabled = true;
        matchedCount++;

        document.getElementById('matching-feedback').textContent =
          `✅ Đúng! ${matchedCount}/${totalPairs} cặp`;
      } else {
        leftBtn.classList.add('wrong');
        btn.classList.add('wrong');
        document.getElementById('matching-feedback').textContent = '❌ Sai, thử lại!';
        setTimeout(() => {
          leftBtn.classList.remove('wrong', 'active');
          btn.classList.remove('wrong');
          document.getElementById('matching-feedback').textContent = '';
        }, 800);
      }

      selectedLeft = null;
      document.querySelectorAll('.match-left').forEach(b => b.classList.remove('active'));

      // Hoàn thành lượt
      if (matchedCount === totalPairs) {
        score++;
        history.push({ correct: true, type: 'matching', pairs: q.pairs });
        setTimeout(() => {
          document.getElementById('matching-feedback').textContent = '🎉 Hoàn thành lượt này!';
          document.getElementById('btn-next').style.display = 'block';
          if (IS_ACCUMULATE) renderMatchingMastery(q.pairs);
        }, 400);
      }
    });
  });
}

// Hiện danh sách các từ trong lượt vừa xong, cho phép đánh dấu "đã học thuộc"
function renderMatchingMastery(pairs) {
  const el = document.getElementById('explanation');
  if (!el) return;

  el.innerHTML = `
    <div style="font-size:0.78rem; color:#888; margin-bottom:8px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">
      Đánh dấu từ đã học thuộc
    </div>
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${pairs.map(p => `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <span><strong style="color:#c0392b;">${p.jp}</strong> — ${p.vi}</span>
          ${masteryButtonHTML(p.jp, true)}
        </div>
      `).join('')}
    </div>
  `;
  el.classList.add('show');

  el.querySelectorAll('.btn-mastery-sm').forEach(btn => {
    btn.addEventListener('click', () => toggleMastery(btn.dataset.word, btn));
  });
}

// --- RENDER GÕ CHỮ ---
function renderTyping(q) {
  document.getElementById('quiz-body').innerHTML = `
    <p class="question-text">Từ tiếng Nhật của nghĩa sau là gì?</p>
    <div class="question-jp" style="font-size:1.3rem; color:#333;">${q.question}</div>
    <input type="text" id="typing-input" placeholder="Gõ từ tiếng Nhật..."
      style="width:100%; padding:12px 16px; border:2px solid #ddd; border-radius:12px;
             font-size:1.2rem; outline:none; margin-top:8px; text-align:center;"
      autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
    <button class="btn btn-primary" id="btn-submit" style="margin-top:12px;">
      Kiểm tra
    </button>
    <div class="explanation" id="explanation"></div>
  `;

  const input = document.getElementById('typing-input');
  input.focus();

  // Cho phép Enter để submit
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleTypingSubmit(q);
  });
  document.getElementById('btn-submit').addEventListener('click', () => handleTypingSubmit(q));
}

function handleTypingSubmit(q) {
  if (answered) return;
  const input = document.getElementById('typing-input');
  const userAnswer = input.value.trim();
  if (!userAnswer) return;

  answered = true;
  input.disabled = true;
  document.getElementById('btn-submit').style.display = 'none';

  // So sánh (chuẩn hóa: bỏ space, lowercase)
  const normalize = s => s.replace(/\s/g, '').toLowerCase();
  const isCorrect = normalize(userAnswer) === normalize(q.correctAnswer);

  if (isCorrect) {
    score++;
    input.style.borderColor = '#27ae60';
    input.style.background = '#eafaf1';
  } else {
    input.style.borderColor = '#c0392b';
    input.style.background = '#fdf2f2';
    // Hiện đáp án đúng
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:8px; font-size:0.9rem; color:#c0392b; font-weight:700; text-align:center;';
    hint.textContent = `Đáp án đúng: ${q.correctAnswer}`;
    input.insertAdjacentElement('afterend', hint);
  }

  history.push({
    question: q.question,
    userAnswer,
    correctAnswer: q.correctAnswer,
    correct: isCorrect,
    word: q.word,
    allMeanings: q.allMeanings,
  });

  showExplanation(q.word, q.allMeanings);
  document.getElementById('btn-next').style.display = 'block';
}

// =============================================
// HIỂN THỊ GIẢI THÍCH (từ điển mini)
// =============================================
function showExplanation(word, allMeanings) {
  const el = document.getElementById('explanation');
  if (!el) return;

  const meaningsHTML = allMeanings.map((m, i) => `
    <div class="meaning-item">
      <strong>${i + 1}. ${m.meaning}</strong>
      <span style="color:#aaa; font-size:0.78rem; margin-left:6px;">${m.word_classes || ''}</span>
      ${m.example ? `
        <div class="example" style="margin-top:2px;">
          ${m.example}<br/>
          <span style="color:#999;">${m.example_translation_vi || ''}</span><br/>
          <span style="color:#bbb; font-size:0.78rem;">${m.example_translation_en || ''}</span>
        </div>` : ''}
    </div>
  `).join('');

  el.innerHTML = `
    <div class="jp-word">${word.vocabulary}
      <span style="font-size:0.9rem; font-weight:400; color:#aaa; margin-left:8px;">
        ${word.pronunciation || ''}
      </span>
    </div>
    <div class="meaning-list">${meaningsHTML}</div>
    ${masteryButtonHTML(word.vocabulary, false)}
  `;
  el.classList.add('show');

  const masteryBtn = el.querySelector('.btn-mastery');
  if (masteryBtn) {
    masteryBtn.addEventListener('click', () => toggleMastery(word.vocabulary, masteryBtn));
  }
}

// =============================================
// CHUYỂN CÂU
// =============================================
document.getElementById('btn-next').addEventListener('click', () => {
  currentIdx++;
  if (currentIdx >= questions.length) {
    showResult();
  } else {
    renderQuestion();
  }
});

// =============================================
// KẾT QUẢ
// =============================================
function showResult() {
  stopTimer();
  document.getElementById('question-number').style.display = 'none';
  document.getElementById('btn-next').style.display = 'none';
  document.getElementById('quiz-body').style.display = 'none';
  document.getElementById('timer-display').style.display = 'none';

  const total = QUIZ_TYPE === 'matching' ? questions.length : questions.length;
  const pct = Math.round((score / total) * 100);

  let emoji = '😢';
  if (pct >= 90) emoji = '🏆';
  else if (pct >= 70) emoji = '🎉';
  else if (pct >= 50) emoji = '💪';

  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-score').textContent = `${score} / ${total}`;
  document.getElementById('result-label').textContent = `Đúng ${pct}%`;

  // Review các câu sai (chỉ cho multiple + typing)
  const wrongs = history.filter(h => !h.correct && h.allMeanings);
  if (wrongs.length > 0) {
    document.getElementById('result-review').innerHTML = `
      <div class="card-title" style="margin:16px 0 8px;">Các câu sai</div>
      ${wrongs.map(h => `
        <div class="card" style="margin-bottom:10px;">
          <div style="font-size:1.1rem; font-weight:900; color:#c0392b;">${h.word.vocabulary}
            <span style="font-size:0.85rem; font-weight:400; color:#aaa; margin-left:6px;">${h.word.pronunciation || ''}</span>
          </div>
          ${h.allMeanings.map((m, i) => `
            <div style="font-size:0.85rem; margin-top:4px;">
              <strong>${i + 1}. ${m.meaning}</strong>
              ${m.example ? `<div style="color:#999; font-size:0.78rem; margin-top:2px; font-style:italic;">${m.example}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
  }

  document.getElementById('result-screen').style.display = 'block';
  document.getElementById('progress-bar').style.width = '100%';
}

// =============================================
// TIMER
// =============================================
function startTimer() {
  if (TIMER_SECONDS <= 0) return;

  document.getElementById('timer-display').style.display = 'block';
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      stopTimer();
      showResult();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
}

function updateTimerDisplay() {
  const min = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const sec = (timeLeft % 60).toString().padStart(2, '0');
  const el = document.getElementById('timer-display');
  el.textContent = `⏱ ${min}:${sec}`;
  el.classList.toggle('warning', timeLeft <= 30);
}

// =============================================
// KHỞI ĐỘNG
// =============================================
function init() {
  // Kiểm tra có đủ từ không (đã loại từ học thuộc nếu ở chế độ tích lũy)
  const minRequired = QUIZ_TYPE === 'multiple' ? 4 : 2;
  if (uniqueWords.length < minRequired) {
    const extraHint = IS_ACCUMULATE
      ? ' (đã trừ các từ đang đánh dấu "học thuộc") hoặc bỏ đánh dấu bớt từ đã thuộc'
      : '';
    alert(`Cần ít nhất ${minRequired} từ khác nhau để tạo bài${extraHint}. Vui lòng chọn thêm bộ lọc.`);
    window.location.href = BACK_URL;
    return;
  }

  questions = generateQuestions();

  if (questions.length === 0) {
    alert('Không thể tạo bài. Vui lòng thử lại.');
    window.location.href = BACK_URL;
    return;
  }

  renderQuestion();
  startTimer();
}

init();
