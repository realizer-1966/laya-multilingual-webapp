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

let agent = null;

async function loadModel() {
  status.textContent = '모델 다운로드 중 (encoder+head+tokenizer, 첫 방문만)...';
  agent = await Agent.load(MODEL_BASE);
  status.textContent = '로딩 완료 - 판정 준비됨';
  btn.disabled = false;
  btn.textContent = '판정 실행';
}

const QUESTIONS = {
  intent: { type: 'choice', instructions: '이 텍스트의 핵심 요청은?', criteria: {
    refund: '돈을 돌려달라', complaint: '불만·문제 제기', inquiry: '정보 문의', action: '무언가 해달라', other: '기타' } },
  urgency: { type: 'score', instructions: '긴급도는?', criteria: ['여유', '보통', '긴급'] },
  negative: { type: 'noul', instructions: '부정적 감정이 담겼나?' },
  churn: { type: 'noul', instructions: '이탈·해지 위협이 있나?' },
};

function bar(name, label, prob) {
  const pct = (prob * 100).toFixed(1);
  return '<div class="label"><b class="qname">' + name + '</b> <span class="conf">' + label +
         ' &middot; ' + pct + '%</span></div><div class="prob"><span style="width:' + pct + '%"></span></div>';
}

btn.addEventListener('click', async () => {
  const text = $('text').value.trim();
  if (!text || !agent) return;
  btn.disabled = true;
  status.textContent = '판정 중...';
  try {
    const t0 = performance.now();
    const out = await agent.predict({ body: text }, QUESTIONS);
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
  }
  btn.disabled = false;
});

// SW 등록 (오프라인)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

loadModel().catch((e) => { status.textContent = '로딩 실패: ' + e.message; console.error(e); });
