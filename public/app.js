// Laya Multilingual PWA — 브라우저 온디바이스 판정
import { Agent, toInternal } from './vendor/laya-ts/dist/index.js';
import { serializeState, buildQuestionPrefix } from './vendor/laya-ts/dist/common.js';
import * as ort from 'onnxruntime-web';

const MODEL_BASE = 'https://laya-multilingual.dydtnsp.workers.dev/models/mv2';  // Worker R2 서빙 (절대 URL 필수 — laya-ts baseUrlFor가 스킴 있음을 요구)

// ort wasm 바이너리는 R2에서 로드 (25MiB assets 제한 회피)
ort.env.wasm.wasmPaths = '/models/mv2/ort/';
ort.env.wasm.numThreads = 2;
const $ = (id) => document.getElementById(id);
const status = $('status');
const btn = $('run');
const qjson = $('qjson');
const qerr = $('qerr');
const presetSel = $('preset');

let agent = null;

async function loadModel() {
  status.textContent = '모델 다운로드 중 (encoder+head+tokenizer, 첫 방문만)...';
  agent = await Agent.load(MODEL_BASE);
  status.textContent = '로딩 완료 - 판정 준비됨';
  btn.disabled = false;
  btn.textContent = '판정 실행';
}

// ---- 백엔드 (브라우저 온디바이스 / 노트북 ollaya) ----
const LS_BACKEND = 'laya-backend';
const LS_SRV = 'laya-server-url';
const DEFAULT_SRV = 'http://100.71.1.74:11435';
let backend = localStorage.getItem(LS_BACKEND) || 'browser';
let srvUrl = localStorage.getItem(LS_SRV) || DEFAULT_SRV;
const beSel = $('backend');
const beinfo = $('beinfo');
beSel.value = backend === 'olllaya' ? 'olllaya' : 'browser';
beSel.addEventListener('change', () => {
  backend = beSel.value;
  localStorage.setItem(LS_BACKEND, backend);
  updateBeInfo();
  if (backend === 'browser' && agent) btn.disabled = false;
});
const keyInput = $('srvkey');
keyInput.value = srvKey();
keyInput.addEventListener('change', () => {
  try { keyInput.value ? localStorage.setItem(LS_AUTH, keyInput.value) : localStorage.removeItem(LS_AUTH); } catch {}
  status.textContent = keyInput.value ? '서버 키 저장됨' : '서버 키 지움';
  status.className = 'status';
});
function updateBeInfo() {
  beinfo.textContent = backend === 'browser'
    ? '온디바이스 INT8 — 오프라인 가능'
    : srvUrl + ' — tailnet GPU';
}
const LS_AUTH = 'laya-server-key';
function srvKey() { try { return localStorage.getItem(LS_AUTH) || ''; } catch { return ''; } }
async function predictRemote(text, questions) {
  const body = { model: 'laya', state: { body: text }, questions, extras: ['laya'] };
  const t0 = performance.now();
  const headers = { 'Content-Type': 'application/json' };
  const key = srvKey();
  if (key) headers['Authorization'] = 'Bearer ' + key;
  const res = await fetch(srvUrl + '/api/decide', {
    method: 'POST', headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.status;
    try { const e = await res.json(); msg = e.error || e.code || msg; } catch {}
    throw new Error('서버 ' + msg + (res.status === 401 ? ' — 서버 키 입력 필요' : ' (노트북 기동·OLLAYA_ORIGINS 확인)'));
  }
  const out = await res.json();
  const ms = (out.server_ms ?? (performance.now() - t0).toFixed(0));
  // /api/decide 응답을 브라우저 predict 출력 형태로 정규화
  const answers = {};
  for (const [k, v] of Object.entries(out.answers ?? {})) {
    if (v.type === 'choice') {
      answers[k] = { type: 'choice', choice: v.choice, probabilities: v.probabilities ?? {}, confidence: v.confidence ?? 0 };
    } else if (v.type === 'noul') {
      answers[k] = { type: 'noul', noul: v.noul ?? 0 };
    } else if (v.type === 'score') {
      answers[k] = { type: 'score', score: v.score ?? 0, confidence: v.confidence ?? 0,
        legend: Object.fromEntries(Object.entries(v.legend ?? {}).map(([n, l]) => [Number(n), l])),
        probabilities: Object.fromEntries(Object.entries(v.probabilities ?? {}).map(([n, p]) => [Number(n), p])) };
    } else {
      answers[k] = v;
    }
  }
  return { model: out.model, answers, usage: out.usage,
    routing: out.routing, state_truncated: out.state_truncated, server_ms: ms };
}

// ---- 질문 프리셋 ----
const PRESETS = {
  기본: {
    intent: { type: 'choice', instructions: '이 텍스트의 핵심 요청은?', criteria: {
      refund: '돈을 돌려달라', complaint: '불만·문제 제기', inquiry: '정보 문의', action: '무언가 해달라', other: '기타' } },
    urgency: { type: 'score', instructions: '긴급도는?', criteria: ['여유', '보통', '긴급'] },
    negative: { type: 'noul', instructions: '부정적 감정이 담겼나?' },
    churn: { type: 'noul', instructions: '이탈·해지 위협이 있나?' },
  },
  '고객 지원': {
    department: { type: 'choice', instructions: '어느 팀이 처리해야 하나?', criteria: {
      billing: '결제·청구·환불', technical: '버그·오류·장애', account: '로그인·계정·설정' } },
    is_urgent: { type: 'noul', instructions: '기한이 임박한 요청인가?' },
    frustration: { type: 'score', instructions: '고객의 화남 정도는?', criteria: ['차분함', '불편 표현', '분노'] },
  },
  '이메일 분류': {
    category: { type: 'choice', instructions: '이 메일의 종류는?', criteria: {
      spam: '광고·원치 않는 메일', work: '업무 관련', personal: '개인 메일', notice: '공지·알림' } },
    needs_reply: { type: 'noul', instructions: '답장이 필요한가?' },
    priority: { type: 'score', instructions: '처리 우선순위는?', criteria: ['낮음', '보통', '높음'] },
  },
  감정: {
    emotion: { type: 'choice', instructions: '이 텍스트의 감정은?', criteria: {
      positive: '긍정·기쁨', neutral: '중립', negative: '부정·분노', anxious: '불안·걱정' } },
    intensity: { type: 'score', instructions: '감정 강도는?', criteria: ['약함', '보통', '강함'] },
  },
};

// ---- 사용자 정의 프리셋 (localStorage 영구 저장) ----
const LS_USER = 'laya-user-presets';
const LS_LAST = 'laya-last-preset';
function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem(LS_USER) || '{}'); } catch { return {}; }
}
function saveUserPresets(u) {
  try { localStorage.setItem(LS_USER, JSON.stringify(u)); } catch {}
}
function refreshPresetOptions(selected) {
  const all = { ...PRESETS, ...loadUserPresets() };
  presetSel.innerHTML = '';
  const groupDef = document.createElement('optgroup'); groupDef.label = '내장 프리셋';
  const groupUser = document.createElement('optgroup'); groupUser.label = '내 프리셋';
  for (const [name, q] of Object.entries(all)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    (name in PRESETS ? groupDef : groupUser).appendChild(opt);
  }
  presetSel.appendChild(groupDef); presetSel.appendChild(groupUser);
  presetSel.value = selected;
}
function presetQuestions(name) {
  return { ...PRESETS, ...loadUserPresets() }[name];
}

let currentName = '기본';
function showPreset() {
  qjson.value = JSON.stringify(presetQuestions(currentName), null, 2);
  qerr.textContent = '';
}

// 마지막 사용 프리셋 복원
try {
  const lastName = sessionStorage.getItem(LS_LAST) || localStorage.getItem(LS_LAST);
  if (lastName && presetQuestions(lastName)) currentName = lastName;
} catch {}
if (!presetQuestions(currentName)) currentName = '기본';
refreshPresetOptions(currentName);
showPreset();

const btnSave = $('save');
const btnDelete = $('delete');

presetSel.addEventListener('change', () => { currentName = presetSel.value; showPreset(); });
$('reset').addEventListener('click', () => showPreset());

// ---- 사용자 프리셋 저장/삭제 ----
btnSave.addEventListener('click', () => {
  let q;
  try { q = JSON.parse(qjson.value); validateQuestions(q); }
  catch (e) { qerr.textContent = '저장 실패: ' + e.message; return; }
  let name = prompt('프리셋 이름을 입력하세요 (내장과 같은 이름은 덮어씀):', currentName in PRESETS ? '' : currentName);
  if (!name) return;
  name = name.trim();
  if (!name) return;
  const users = loadUserPresets();
  users[name] = q;
  saveUserPresets(users);
  currentName = name;
  refreshPresetOptions(name);
  qerr.textContent = '';
  status.textContent = '프리셋 "' + name + '" 저장됨';
  status.className = 'status';
});

btnDelete.addEventListener('click', () => {
  if (currentName in PRESETS) { qerr.textContent = '내장 프리셋은 삭제할 수 없습니다 (덮어쓰려면 같은 이름으로 저장)'; return; }
  const users = loadUserPresets();
  if (!(currentName in users)) return;
  if (!confirm('프리셋 "' + currentName + '"을(를) 삭제할까요?')) return;
  delete users[currentName];
  saveUserPresets(users);
  currentName = '기본';
  refreshPresetOptions(currentName);
  showPreset();
  status.textContent = '프리셋 삭제됨';
  status.className = 'status';
});

// ---- 질문 검증 (공용) ----
function validateQuestions(q) {
  if (typeof q !== 'object' || !q || Array.isArray(q)) throw new Error('질문 객체 {이름: 질문} 형태여야 합니다');
  const keys = Object.keys(q);
  if (keys.length === 0) throw new Error('최소 1개의 질문이 필요합니다');
  if (keys.length > 20) throw new Error('질문이 너무 많습니다 (최대 20개)');
  for (const [k, v] of Object.entries(q)) {
    if (!v || typeof v !== 'object') throw new Error(k + ': 질문 객체가 아님');
    if (!['choice', 'score', 'noul'].includes(v.type)) throw new Error(k + ': type은 choice/score/noul 중 하나');
    if (!v.instructions || typeof v.instructions !== 'string') throw new Error(k + ': instructions(문자열) 필요');
    if (v.type === 'choice' && !v.criteria) throw new Error(k + ': choice에는 criteria 필요');
    if (v.type === 'score' && (!Array.isArray(v.criteria) || v.criteria.length < 2 || v.criteria.length > 10)) throw new Error(k + ': score에는 2~10개 레벨 배열 필요');
    if (v.type === 'noul' && v.criteria && typeof v.criteria !== 'object') throw new Error(k + ': noul의 criteria는 {true, false} 형태');
  }
}

// JSON 실시간 검증 + 세션 저장 (편집 중에도 유지)
qjson.addEventListener('input', () => {
  try {
    validateQuestions(JSON.parse(qjson.value));
    qerr.textContent = '';
    try { sessionStorage.setItem('laya-questions', qjson.value); sessionStorage.setItem(LS_LAST, currentName); } catch {}
  } catch (e) {
    if (e instanceof SyntaxError) qerr.textContent = 'JSON 문법 오류: ' + e.message;
    else qerr.textContent = e.message;
  }
});

function currentQuestions() {
  const q = JSON.parse(qjson.value);  // 판정 시 재검증 — 오류는 아래 catch에서 표시
  validateQuestions(q);
  return q;
}

// ---- state 잘림 계산 (laya-ts와 동일한 시퀀스 구성) ----
// room = maxLen - prefix - [SEP] 이고 state는 slice(0, room)으로 앞부분만 남는다.
// 배열 state(웹앱은 {body: text} 객체라 항상 앞부분 보존).
function truncationInfo(text, questions) {
  const tok = agent.tok, maxLen = agent.maxLen, headMaxLen = agent.headMaxLen;
  const stAll = tok.encode(serializeState({ body: text }).split(tok.maskToken).join(' '));
  let minRoom = Infinity, prefixTokens = 0;
  for (const qid of Object.keys(questions)) {
    const prefix = buildQuestionPrefix(tok, toInternal(questions[qid]), maxLen, headMaxLen);
    const room = Math.max(0, maxLen - prefix.ids.length - 1);
    prefixTokens += prefix.ids.length;
    if (room < minRoom) minRoom = room;
  }
  return {
    stateTokens: stAll.length,
    room: minRoom,
    truncated: stAll.length > minRoom,
    prefixTokens,
    maxLen,
  };
}

function bar(name, label, prob) {
  const pct = (prob * 100).toFixed(1);
  return '<div class="label"><b class="qname">' + name + '</b> <span class="conf">' + label +
         ' &middot; ' + pct + '%</span></div><div class="prob"><span style="width:' + pct + '%"></span></div>';
}

btn.addEventListener('click', async () => {
  const text = $('text').value.trim();
  if (!text || !agent) return;
  let questions;
  try { questions = currentQuestions(); }
  catch (e) { status.textContent = '질문 JSON 오류: ' + e.message; status.className = 'status err'; return; }
  btn.disabled = true;
  status.textContent = '판정 중...';
  status.className = 'status';
  try {
    const t0 = performance.now();
    const out = backend === 'olllaya'
      ? await predictRemote(text, questions)
      : await agent.predict({ body: text }, questions);
    const ms = (out.server_ms ?? (performance.now() - t0).toFixed(0));
    const tr = truncationInfo(text, questions);
    let html = '<div class="card">';
    for (const [k, v] of Object.entries(out.answers)) {
      if (v.type === 'choice') {
        const p = v.probabilities[v.choice] ?? 0;
        html += bar(k, v.choice, p);
      } else if (v.type === 'noul') {
        html += bar(k, v.noul >= 0.5 ? 'YES' : 'NO', v.noul);
      } else {
        const legend = Object.values(v.legend ?? {});
        const lv = Math.round(v.score);
        html += bar(k, (legend[lv] ?? v.score) + ' (' + v.score.toFixed(2) + ')', v.answer_confidence);
      }
      html += '<div class="conf" style="margin-top:-6px">교정 신뢰도 ' + (v.answer_confidence * 100).toFixed(1) + '%</div>';
    }
    html += '<div class="conf">' + ms + 'ms &middot; ' + (out.usage?.input_tokens ?? 0) + ' tokens</div>';
    // state 용량 요약 + 잘림 경고
    const warn = tr.stateTokens > tr.room;
    html += '<div class="stateinfo' + (warn ? ' warn' : '') + '">' +
      'state ' + tr.stateTokens + ' / ' + tr.room + ' tokens (질문 ' + tr.prefixTokens + ' + state, 한도 ' + tr.maxLen + ')' +
      (warn ? ' — ⚠️ 잘림! 앞 ' + tr.room + '토큰만 판정에 사용됨' : ' — 잘림 없음') + '</div>';
    if (backend === 'olllaya') {
      const rt = out.routing ? out.routing.model + ' (' + out.routing.reason + ')' : out.model;
      html += '<div class="conf">서버: ' + (out.model ?? '') + ' · ' + ms + 'ms 왕복 · 라우팅: ' + rt + '</div>';
    }
    html += '</div>';
    $('results').innerHTML = html;
    status.textContent = '완료';
  } catch (e) {
    status.textContent = '오류: ' + e.message;
    status.className = 'status err';
  }
  btn.disabled = false;
});

// SW 등록 (오프라인)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

updateBeInfo();
if (backend === 'browser') {
  loadModel().catch((e) => { status.textContent = '로딩 실패: ' + e.message; console.error(e); });
} else {
  btn.disabled = false;
  btn.textContent = '판정 실행 (노트북)';
  status.textContent = '노트북 ollaya 백엔드 대기 — 브라우저 모델 로드 생략 (즉시 사용 가능)';
}
