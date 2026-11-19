function json(data, status, origin, env) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin"
  };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== env.ALLOWED_ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403, origin, env);
      const headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
        "Cache-Control": "no-store"
      };
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin, env);
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return json({ ok: false, error: "origin_not_allowed" }, 403, origin, env);
    if (!env.TELEGRAM_CLIENT_ID || !env.TELEGRAM_CLIENT_SECRET || !env.ALLOWED_REDIRECT_URI) {
      return json({ ok: false, error: "relay_not_configured" }, 503, origin, env);
    }
    let input;
    try { input = await request.json(); } catch (_) { return json({ ok: false, error: "invalid_json" }, 400, origin, env); }
    const code = typeof input.code === "string" ? input.code : "";
    const verifier = typeof input.code_verifier === "string" ? input.code_verifier : "";
    const redirectUri = typeof input.redirect_uri === "string" ? input.redirect_uri : "";
    const clientId = typeof input.client_id === "string" ? input.client_id : "";
    if (!code || code.length > 4096 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || redirectUri !== env.ALLOWED_REDIRECT_URI || clientId !== env.TELEGRAM_CLIENT_ID) {
      return json({ ok: false, error: "invalid_exchange_parameters" }, 400, origin, env);
    }
    const basic = btoa(`${env.TELEGRAM_CLIENT_ID}:${env.TELEGRAM_CLIENT_SECRET}`);
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.ALLOWED_REDIRECT_URI,
      client_id: env.TELEGRAM_CLIENT_ID,
      code_verifier: verifier
    });
    let response;
    try {
      response = await fetch("https://oauth.telegram.org/token", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: form.toString()
      });
    } catch (_) {
      return json({ ok: false, error: "telegram_upstream_unreachable" }, 502, origin, env);
    }
    let tokenPayload;
    try { tokenPayload = await response.json(); } catch (_) { return json({ ok: false, error: "telegram_invalid_response" }, 502, origin, env); }
    if (!response.ok || !tokenPayload || typeof tokenPayload.id_token !== "string") {
      const allowed = ["invalid_grant", "invalid_client", "invalid_request", "unauthorized_client"];
      const error = allowed.includes(tokenPayload && tokenPayload.error) ? tokenPayload.error : "telegram_token_exchange_failed";
      return json({ ok: false, error }, 400, origin, env);
    }
    // Only return the signed ID token required by PHP. Never expose/store the client secret.
    return json({ ok: true, id_token: tokenPayload.id_token }, 200, origin, env);
  }
};
