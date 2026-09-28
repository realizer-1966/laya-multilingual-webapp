// Laya Multilingual PWA — 브라우저 온디바이스 판정
import { Agent } from './vendor/laya-ts/dist/index.js';
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

let currentName = '기본';

function showPreset() {
  qjson.value = JSON.stringify(PRESETS[currentName], null, 2);
  qerr.textContent = '';
}

// 초기화: 저장된 편집 복원(세션 내) 또는 기본 프리셋
try {
  const savedName = sessionStorage.getItem('laya-preset');
  const savedJson = sessionStorage.getItem('laya-questions');
  if (savedName && PRESETS[savedName]) { currentName = savedName; }
  if (savedJson) { qjson.value = savedJson; } else { showPreset(); }
} catch { showPreset(); }

for (const name of Object.keys(PRESETS)) {
  const opt = document.createElement('option');
  opt.value = name; opt.textContent = name;
  presetSel.appendChild(opt);
}
presetSel.value = currentName;
presetSel.addEventListener('change', () => { currentName = presetSel.value; showPreset(); });
$('reset').addEventListener('click', () => { currentName = presetSel.value; showPreset(); });

// JSON 실시간 검증 + 세션 저장 (편집 중에도 유지)
qjson.addEventListener('input', () => {
  try {
    const q = JSON.parse(qjson.value);
    if (typeof q !== 'object' || !q || Array.isArray(q)) throw new Error('질문 객체 {이름: 질문} 형태여야 합니다');
    for (const [k, v] of Object.entries(q)) {
      if (!v || typeof v !== 'object') throw new Error(k + ': 질문 객체가 아님');
      if (!['choice', 'score', 'noul'].includes(v.type)) throw new Error(k + ': type은 choice/score/noul 중 하나');
      if (!v.instructions || typeof v.instructions !== 'string') throw new Error(k + ': instructions(문자열) 필요');
      if (v.type === 'choice' && !v.criteria) throw new Error(k + ': choice에는 criteria 필요');
      if (v.type === 'score' && (!Array.isArray(v.criteria) || v.criteria.length < 2 || v.criteria.length > 10)) throw new Error(k + ': score에는 2~10개 레벨 배열 필요');
    }
    qerr.textContent = '';
    try { sessionStorage.setItem('laya-questions', qjson.value); sessionStorage.setItem('laya-preset', currentName); } catch {}
  } catch (e) {
    if (e instanceof SyntaxError) qerr.textContent = 'JSON 문법 오류: ' + e.message;
    else qerr.textContent = e.message;
  }
});

function currentQuestions() {
  const q = JSON.parse(qjson.value);  // 판정 시 재검증 — 오류는 아래 catch에서 표시
  if (!q || typeof q !== 'object' || Array.isArray(q) || Object.keys(q).length === 0) {
    throw new Error('질문 편집: 최소 1개의 질문이 필요합니다');
  }
  return q;
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
    const out = await agent.predict({ body: text }, questions);
    const ms = (performance.now() - t0).toFixed(0);
    let html = '<div class="card">';
    for (const [k, v] of Object.entries(out.answers)) {
      if (v.type === 'choice') {
        // 최고 라벨의 확률로 표시
        const p = v.probabilities[v.choice] ?? 0;
        html += bar(k, v.choice, p);
      } else if (v.type === 'noul') {
        html += bar(k, v.noul >= 0.5 ? 'YES' : 'NO', v.noul);
      } else {
        // score: 기댓값
        const legend = Object.values(v.legend ?? {});
        const lv = Math.round(v.score);
        html += bar(k, (legend[lv] ?? v.score) + ' (' + v.score.toFixed(2) + ')', v.answer_confidence);
      }
      html += '<div class="conf" style="margin-top:-6px">교정 신뢰도 ' + (v.answer_confidence * 100).toFixed(1) + '%</div>';
    }
    html += '<div class="conf">' + ms + 'ms &middot; ' + (out.usage?.input_tokens ?? 0) + ' tokens</div></div>';
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

loadModel().catch((e) => { status.textContent = '로딩 실패: ' + e.message; console.error(e); });
