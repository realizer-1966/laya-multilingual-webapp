// laya-multilingual-webapp Worker
// - / : PWA 정적 (assets 바인딩)
// - /models/* : R2 바인딩에서 모델 서빙 (CORS 헤더 포함)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/models/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      const key = decodeURIComponent(url.pathname.slice("/models/".length));
      const obj = await env.MODELS.get(key);
      if (!obj) return new Response("Not found: " + key, { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(obj.body, { headers });
    }
    // 나머지는 정적 PWA (assets 바인딩)
    return env.ASSETS.fetch(request);
  },
};
