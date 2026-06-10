/* ============================================================
   StyleAI — app.js
   Full client-side SPA.  No backend.  Uses Gemini API.
   All data stored in localStorage.
   ============================================================ */

'use strict';

// ── Constants ─────────────────────────────────────────────────
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const LS = {
  API_KEY : 'styleai_apikey',
  PROFILE : 'styleai_profile',
  CLOTHES : 'styleai_clothes',
};

const STYLE_PREFS = [
  'カジュアル','フォーマル','ストリート','フェミニン',
  'モード','ナチュラル','スポーティ','エレガント',
  'ボーイッシュ','クラシック','ゴージャス','シンプル',
];

const TPO_OPTIONS = [
  { v:'デート',      e:'💕' }, { v:'ビジネス',    e:'💼' },
  { v:'カジュアル',  e:'☀️'  }, { v:'フォーマル',  e:'🎩' },
  { v:'アウトドア',  e:'⛺'  }, { v:'パーティー',  e:'🎉' },
  { v:'旅行',        e:'✈️'  }, { v:'お出かけ',    e:'🛍️' },
  { v:'ホームウェア',e:'🏠'  },
];

const SEASON_OPTIONS = [
  { v:'春', e:'🌸' }, { v:'夏', e:'☀️' },
  { v:'秋', e:'🍂' }, { v:'冬', e:'❄️' },
];

const STYLE_OPTIONS = [
  { v:'カジュアル' }, { v:'モード'     }, { v:'フェミニン' },
  { v:'スポーティ' }, { v:'クラシック' }, { v:'ストリート' },
];

const CATEGORIES = ['すべて','トップス','ボトムス','アウター','ワンピース','靴','バッグ','アクセサリー','その他'];

// ── State ─────────────────────────────────────────────────────
const state = {
  activeTab       : 'profile',
  pendingFiles    : [],
  filterCategory  : 'すべて',
  coord           : { tpo:'', season:'', style:'' },
};

// ── localStorage helpers ──────────────────────────────────────
const getApiKey   = ()     => localStorage.getItem(LS.API_KEY) ?? '';
const setApiKey   = key    => localStorage.setItem(LS.API_KEY, key);
const getProfile  = ()     => JSON.parse(localStorage.getItem(LS.PROFILE) ?? '{}');
const saveProfile = p      => localStorage.setItem(LS.PROFILE, JSON.stringify(p));
const getClothes  = ()     => JSON.parse(localStorage.getItem(LS.CLOTHES) ?? '[]');
const saveClothes = list   => localStorage.setItem(LS.CLOTHES, JSON.stringify(list));
const addClothes  = item   => { const l = getClothes(); l.unshift(item); saveClothes(l); };
const delClothes  = id     => saveClothes(getClothes().filter(c => c.id !== id));

// ── Gemini API ────────────────────────────────────────────────
async function callGemini(prompt, base64 = null, mime = 'image/jpeg') {
  const key = getApiKey();
  if (!key) throw new Error('APIキーが未設定です。右上の🔑ボタンから設定してください。');

  const parts = [];
  if (base64) parts.push({ inline_data: { mime_type: mime, data: base64 } });
  parts.push({ text: prompt });

  const res = await fetch(`${GEMINI_URL}?key=${key}`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({
      contents        : [{ parts }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }

  const json = await res.json();
  const candidate = json.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = candidate?.finishReason ?? 'UNKNOWN';
    throw new Error(`AIから応答が得られませんでした（finishReason: ${reason}）`);
  }
  return text;
}

async function analyzeClothingImage(base64, mime) {
  const prompt = `この画像を分析してください。服の写真、またはブランドタグ・素材表示タグ・洗濯表示タグの画像です。
画像から読み取れるすべての情報（服のデザイン・色・ブランドロゴ・タグのテキスト）をもとに、以下のJSONのみを返してください。
コードブロック（\`\`\`）や説明文は一切不要です。JSONだけを返してください。

{
  "type": "トップス",
  "subType": "Tシャツ",
  "brand": "",
  "colors": ["白"],
  "material": "コットン",
  "materialComposition": "",
  "careInstructions": [],
  "seasons": ["春", "夏"],
  "style": "カジュアル",
  "tags": ["シンプル"],
  "description": "白無地のTシャツ"
}

上記はサンプルです。実際の画像の内容に合わせて各フィールドを埋めてください。
- type: トップス/ボトムス/アウター/ワンピース/靴/バッグ/アクセサリー/その他 のいずれか
- brand: タグやロゴから読み取れるブランド名。不明なら空文字
- materialComposition: タグに素材組成（例: 綿100%）が書いてあれば記入。なければ空文字
- careInstructions: 洗濯タグから読み取れるケア方法の配列（例: ["手洗い可", "乾燥機不可"]）。不明なら空配列
- seasons: 服に適した季節を配列で（複数可）
- style: カジュアル/フォーマル/スポーティ/フェミニン/モード/ストリート のいずれか`;

  const raw = await callGemini(prompt, base64, mime);
  let txt = raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/,      '')
    .replace(/```\s*$/,      '')
    .trim();

  const firstBrace = txt.indexOf('{');
  const lastBrace  = txt.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    txt = txt.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(txt);
}

async function generateCoordinate(profile, clothes, tpo, season, style, extra) {
  const clothesList = clothes.length
    ? clothes.map(c => {
        const brandPart = c.info.brand ? ` ブランド:${c.info.brand}` : '';
        return `- [${c.id}] ${c.info.type}(${c.info.subType ?? ''})${brandPart} 色:${(c.info.colors??[]).join('/')} スタイル:${c.info.style} 季節:${(c.info.seasons??[]).join('/')} "${c.info.description}"`;
      }).join('\n')
    : '（服が未登録）';

  const profileStr = [
    `性別: ${profile.gender||'未設定'}`,
    `年代: ${profile.ageGroup||'未設定'}`,
    `骨格: ${profile.skeletonType||'未設定'}`,
    `パーソナルカラー: ${profile.personalColor||'未設定'}`,
    `体型: ${profile.bodyType||'未設定'}`,
    `好み: ${(profile.stylePreferences||[]).join(', ')||'未設定'}`,
    `身長: ${profile.height ? profile.height+'cm' : '未設定'}`,
    `メモ: ${profile.profileNote||'なし'}`,
  ].join('\n');

  const prompt = `あなたはプロのファッションスタイリストです。
以下のユーザー情報と手持ちの服を参考に、コーディネートを3パターン提案してください。

【ユーザープロフィール】
${profileStr}

【手持ちの服（計${clothes.length}点）】
${clothesList}

【提案条件】
シーン: ${tpo||'指定なし'}
季節: ${season||'指定なし'}
スタイル: ${style||'指定なし'}
追加リクエスト: ${extra||'なし'}

【出力フォーマット（マークダウン）】

## コーディネート1: [キャッチーなタイトル]
### 組み合わせアイテム
- ✅ [手持ちの服] または 🛒 [買い足し推奨アイテム]
（箇条書きで列挙）

### ポイント
（なぜこの組み合わせがユーザーに合うか、骨格・パーソナルカラーの観点も交えて）

### 着こなしヒント
（具体的なスタイリングアドバイス）

### 買い足し提案
（手持ちにないが追加すると良いアイテムと理由。手持ちだけで完結する場合は省略）

---

（コーディネート2・3も同フォーマット）

## まとめ
（全体的なアドバイスと今後のクローゼット強化への提言）`;

  return callGemini(prompt);
}

// ── Image utilities ──────────────────────────────────────────
function compressImage(file, maxPx = 900, quality = 0.75) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else       { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = url;
  });
}

function dataUrlToBase64(dataUrl) {
  return dataUrl.split(',')[1];
}

// ── UI utilities ──────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'ok') {
  const el    = document.getElementById('toast');
  const inner = document.getElementById('toastInner');
  inner.textContent = msg;
  inner.style.background = type === 'err' ? '#dc2626' : '#1f2937';
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.display = 'none', 3200);
}

function showLoading(msg = '処理中...') {
  document.getElementById('loadingMsg').textContent = msg;
  document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

function updateApiKeyLabel() {
  const el  = document.getElementById('apiKeyLabel');
  const has = !!getApiKey();
  el.textContent = has ? 'APIキー設定済み ✓' : 'APIキー未設定';
  el.style.color = has ? '#16a34a' : '';
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.getElementById(`${name}Tab`).style.display = 'block';
  document.querySelectorAll('.nav-tab').forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('active-tab', active);
  });
}

// ── Profile tab ───────────────────────────────────────────────
function initProfileTab() {
  // Style preference chips
  const chipsEl = document.getElementById('stylePreferenceChips');
  STYLE_PREFS.forEach(s => {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'chip';
    btn.textContent = s;
    btn.dataset.val = s;
    btn.addEventListener('click', () => btn.classList.toggle('selected'));
    chipsEl.appendChild(btn);
  });

  // Radio card interaction (visual feedback)
  document.querySelectorAll('.radio-card-label input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll(`input[name="${radio.name}"]`).forEach(r => {
        // visual update handled via CSS :checked selector
      });
    });
  });

  loadProfileUI();
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfileFromUI);
}

function loadProfileUI() {
  const p = getProfile();
  const safe = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  safe('gender',      p.gender);
  safe('ageGroup',    p.ageGroup);
  safe('height',      p.height);
  safe('profileNote', p.profileNote);

  ['skeletonType','personalColor','bodyType'].forEach(n => {
    if (!p[n]) return;
    const r = document.querySelector(`input[name="${n}"][value="${p[n]}"]`);
    if (r) r.checked = true;
  });

  if (p.stylePreferences?.length) {
    document.querySelectorAll('#stylePreferenceChips .chip').forEach(btn => {
      if (p.stylePreferences.includes(btn.dataset.val)) btn.classList.add('selected');
    });
  }
}

function saveProfileFromUI() {
  const profile = {
    gender      : document.getElementById('gender').value,
    ageGroup    : document.getElementById('ageGroup').value,
    skeletonType: document.querySelector('input[name="skeletonType"]:checked')?.value ?? '',
    personalColor: document.querySelector('input[name="personalColor"]:checked')?.value ?? '',
    bodyType    : document.querySelector('input[name="bodyType"]:checked')?.value ?? '',
    stylePreferences: [...document.querySelectorAll('#stylePreferenceChips .chip.selected')]
                        .map(b => b.dataset.val),
    height      : document.getElementById('height').value,
    profileNote : document.getElementById('profileNote').value,
  };
  saveProfile(profile);
  showToast('プロフィールを保存しました ✓');
}

// ── Closet tab ────────────────────────────────────────────────
function initClosetTab() {
  buildFilterPills();
  renderGrid();

  const uploadArea  = document.getElementById('uploadArea');
  const imageUpload = document.getElementById('imageUpload');
  const cameraInput = document.getElementById('cameraInput');

  document.getElementById('cameraBtn').addEventListener('click', () => cameraInput.click());
  document.getElementById('galleryBtn').addEventListener('click', () => imageUpload.click());

  uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    uploadArea.classList.add('upload-drag');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('upload-drag');
  });
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('upload-drag');
    handleFiles(e.dataTransfer.files);
  });

  imageUpload.addEventListener('change', e => handleFiles(e.target.files));
  cameraInput.addEventListener('change', e => handleFiles(e.target.files));
  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
}

function handleFiles(files) {
  state.pendingFiles = [...files];
  if (!state.pendingFiles.length) return;

  const preview = document.getElementById('uploadPreview');
  const row     = document.getElementById('previewRow');
  preview.style.display = 'block';
  row.innerHTML = '';
  state.pendingFiles.forEach(f => {
    const img = document.createElement('img');
    img.src       = URL.createObjectURL(f);
    img.className = 'w-20 h-20 object-cover rounded-xl flex-shrink-0';
    row.appendChild(img);
  });
}

async function runAnalysis() {
  if (!state.pendingFiles.length) return;
  if (!getApiKey()) { openApiKeyModal(); return; }

  showLoading('AIが服を分析中…');
  let ok = 0;
  const errors = [];

  for (const file of state.pendingFiles) {
    try {
      const dataUrl = await compressImage(file);
      const base64  = dataUrlToBase64(dataUrl);
      const info    = await analyzeClothingImage(base64, 'image/jpeg');
      addClothes({
        id      : Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        imageUrl: dataUrl,
        info,
        addedAt : new Date().toISOString(),
      });
      ok++;
    } catch (e) {
      console.error('Analysis failed for file:', file.name, e);
      errors.push(e.message || String(e));
    }
  }

  hideLoading();
  state.pendingFiles = [];
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('imageUpload').value = '';
  document.getElementById('cameraInput').value = '';
  renderGrid();

  if (ok > 0) {
    showToast(`${ok}点を追加しました${errors.length ? `（${errors.length}点失敗）` : ''}`);
  } else {
    const reason = errors[0] ?? '不明なエラー';
    showToast(`分析失敗: ${reason}`, 'err');
  }
}

function buildFilterPills() {
  const row = document.getElementById('filterRow');
  row.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className  = 'filter-pill' + (cat === 'すべて' ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      state.filterCategory = cat;
      row.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGrid();
    });
    row.appendChild(btn);
  });
}

function renderGrid() {
  const all      = getClothes();
  const filtered = state.filterCategory === 'すべて'
    ? all
    : all.filter(c => c.info?.type === state.filterCategory);

  document.getElementById('clothesCount').textContent = `${all.length} 点`;

  const grid  = document.getElementById('clothesGrid');
  const empty = document.getElementById('emptyCloset');

  if (!filtered.length) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = 'grid';

  grid.innerHTML = filtered.map(item => `
    <div class="clothes-card" data-id="${item.id}">
      <div class="relative overflow-hidden">
        <img src="${item.imageUrl}" alt="${escHtml(item.info?.description ?? '')}" loading="lazy" />
        <button class="del-btn"
          data-id="${item.id}" title="削除">
          <i class="fas fa-times"></i>
        </button>
        <div class="clothes-overlay">
          <span class="text-white text-xs font-medium">${escHtml(item.info?.type ?? '不明')}</span>
        </div>
      </div>
      <div class="clothes-info">
        <p class="text-xs text-gray-500 line-clamp-2">${escHtml(item.info?.description ?? '')}</p>
        <div class="clothes-info-tags">
          ${(item.info?.colors ?? []).slice(0, 2)
              .map(c => `<span class="clothes-color-tag">${escHtml(c)}</span>`)
              .join('')}
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.clothes-card').forEach(card => {
    card.addEventListener('click', e => {
      if (!e.target.closest('.del-btn')) openItemModal(card.dataset.id);
    });
  });

  grid.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('この服を削除しますか？')) return;
      delClothes(btn.dataset.id);
      renderGrid();
      showToast('削除しました');
    });
  });
}

function openItemModal(id) {
  const item = getClothes().find(c => c.id === id);
  if (!item) return;
  const { info } = item;
  document.getElementById('itemModalBody').innerHTML = `
    <div class="flex gap-3 mb-4">
      <img src="${item.imageUrl}" class="w-28 h-28 object-cover rounded-xl flex-shrink-0" alt="" />
      <div class="flex-1 min-w-0">
        <p class="font-bold text-sm">${escHtml(info?.subType ?? info?.type ?? '不明')}</p>
        <p class="text-xs text-gray-400">${escHtml(info?.type ?? '')}</p>
        <div class="flex flex-wrap gap-1 mt-2">
          ${(info?.seasons ?? []).map(s => `<span class="tag-season">${escHtml(s)}</span>`).join('')}
        </div>
      </div>
    </div>
    <div class="space-y-1.5 text-sm">
      ${info?.brand ? `<div><span class="text-gray-400 text-xs">ブランド：</span><span class="font-medium">${escHtml(info.brand)}</span></div>` : ''}
      <div><span class="text-gray-400 text-xs">色：</span>${escHtml((info?.colors ?? []).join(', ') || '−')}</div>
      <div><span class="text-gray-400 text-xs">素材：</span>${escHtml(info?.material || '−')}</div>
      ${info?.materialComposition ? `<div><span class="text-gray-400 text-xs">素材組成：</span>${escHtml(info.materialComposition)}</div>` : ''}
      ${(info?.careInstructions ?? []).length ? `<div>
        <span class="text-gray-400 text-xs">ケア：</span>
        <div class="flex flex-wrap gap-1 mt-1">
          ${info.careInstructions.map(c => `<span class="tag-care">${escHtml(c)}</span>`).join('')}
        </div>
      </div>` : ''}
      <div><span class="text-gray-400 text-xs">スタイル：</span>${escHtml(info?.style || '−')}</div>
      <div><span class="text-gray-400 text-xs">説明：</span>${escHtml(info?.description || '−')}</div>
      <div>
        <span class="text-gray-400 text-xs">タグ：</span>
        <div class="flex flex-wrap gap-1 mt-1">
          ${(info?.tags ?? []).map(t => `<span class="tag-cat">${escHtml(t)}</span>`).join('')}
        </div>
      </div>
    </div>`;
  document.getElementById('itemModal').style.display = 'flex';
}

// ── Coordinate tab ────────────────────────────────────────────
function initCoordinateTab() {
  buildOptionGrid('tpoGrid',    TPO_OPTIONS,    'tpo',    o => `${o.e} ${o.v}`);
  buildOptionGrid('seasonGrid', SEASON_OPTIONS, 'season', o => `${o.e} ${o.v}`);
  buildOptionGrid('styleGrid',  STYLE_OPTIONS,  'style',  o => o.v);
  document.getElementById('generateBtn').addEventListener('click', runCoordinate);
}

function buildOptionGrid(containerId, options, stateKey, labelFn) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'option-btn';
    btn.textContent = labelFn(opt);
    btn.dataset.val = opt.v;
    btn.addEventListener('click', () => {
      const active = btn.classList.contains('selected');
      el.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
      if (!active) { btn.classList.add('selected'); state.coord[stateKey] = opt.v; }
      else          state.coord[stateKey] = '';
    });
    el.appendChild(btn);
  });
}

async function runCoordinate() {
  if (!getApiKey()) { openApiKeyModal(); return; }

  const clothes = getClothes();
  if (!clothes.length) {
    showToast('クローゼットに服を登録してから試みてください', 'err');
    return;
  }

  showLoading('AIがコーデを考え中…');
  const extra = document.getElementById('extraRequest').value.trim();

  try {
    const md = await generateCoordinate(
      getProfile(), clothes,
      state.coord.tpo, state.coord.season, state.coord.style, extra
    );
    hideLoading();
    renderCoordResult(md);
  } catch (e) {
    hideLoading();
    showToast(`エラー: ${e.message}`, 'err');
  }
}

function renderCoordResult(md) {
  const badges = [state.coord.tpo, state.coord.season, state.coord.style]
    .filter(Boolean)
    .map(v => `<span class="coord-badge">${escHtml(v)}</span>`)
    .join('');

  const resultsEl = document.getElementById('coordResults');
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = `
    <div class="card">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl">✨</span>
        <h2 class="section-title mb-0">AIコーディネート提案</h2>
      </div>
      ${badges ? `<div class="flex flex-wrap gap-2 mb-4">${badges}</div>` : ''}
      <div class="coord-body">${mdToHtml(md)}</div>
      <button id="regenBtn" class="regen-btn">
        <i class="fas fa-rotate-right"></i>別パターンを提案してもらう
      </button>
    </div>`;

  document.getElementById('regenBtn').addEventListener('click', runCoordinate);
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Simple markdown → HTML (sufficient for Gemini output)
function mdToHtml(md) {
  return md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/^## (.+)$/gm,    '<h2>$1</h2>')
    .replace(/^### (.+)$/gm,   '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm,  '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, match =>
      match.includes('<ul>') ? match : `<ul>${match}</ul>`)
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>')
    .replace(/^---$/gm, '<hr />')
    .replace(/<p>\s*<\/p>/g, '');
}

// ── API Key Modal ─────────────────────────────────────────────
function openApiKeyModal() {
  document.getElementById('apiKeyInput').value = getApiKey();
  document.getElementById('apiKeyModal').style.display = 'flex';
  document.getElementById('apiKeyInput').focus();
}

function initApiKeyModal() {
  document.getElementById('apiKeyBtn').addEventListener('click', openApiKeyModal);

  document.getElementById('saveApiKey').addEventListener('click', () => {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) { showToast('APIキーを入力してください', 'err'); return; }
    setApiKey(key);
    document.getElementById('apiKeyModal').style.display = 'none';
    updateApiKeyLabel();
    showToast('APIキーを保存しました ✓');
  });

  document.getElementById('cancelApiKey').addEventListener('click', () => {
    document.getElementById('apiKeyModal').style.display = 'none';
  });

  document.getElementById('apiKeyInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('saveApiKey').click();
  });

  document.getElementById('apiKeyModal').addEventListener('click', e => {
    if (e.target === document.getElementById('apiKeyModal'))
      document.getElementById('apiKeyModal').style.display = 'none';
  });
}

// ── Item Modal ────────────────────────────────────────────────
function initItemModal() {
  document.getElementById('closeItemModal').addEventListener('click', () => {
    document.getElementById('itemModal').style.display = 'none';
  });
  document.getElementById('itemModal').addEventListener('click', e => {
    if (e.target === document.getElementById('itemModal'))
      document.getElementById('itemModal').style.display = 'none';
  });
}

// ── Misc ──────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tab navigation
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  initProfileTab();
  initClosetTab();
  initCoordinateTab();
  initApiKeyModal();
  initItemModal();
  updateApiKeyLabel();

  // First-time hint
  if (!getApiKey()) {
    setTimeout(() => showToast('まず右上の🔑ボタンでAPIキーを設定してください'), 800);
  }
});
