function resolveMiracleUrl(url) {
  return url;
}

async function resolveAuthToken() {
  const auth = typeof window !== "undefined" ? window.MiracleAuth : null;
  if (auth && typeof auth.whenAuthenticated === "function") {
    try {
      await auth.whenAuthenticated();
    } catch (error) {
      // Ignore: fall through and send the request without a token.
    }
  }
  return auth && typeof auth.getAccessToken === "function" ? auth.getAccessToken() || "" : "";
}

export async function fetchJSON(url, options = {}) {
  const token = await resolveAuthToken();
  const requestInit = {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  const response = await fetch(resolveMiracleUrl(url), requestInit);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const rawBody = await response.text();

  let payload = null;
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      if (response.ok) {
        const parseError = new SyntaxError(`Expected JSON but received ${contentType || "unknown content-type"} with body: ${rawBody.slice(0, 400)}`);
        parseError.responseStatus = response.status;
        parseError.responseContentType = contentType;
        parseError.responseBodyPreview = rawBody.slice(0, 400);
        throw parseError;
      }
      const failure = new Error(`HTTP ${response.status} ${response.statusText} | ${contentType || "unknown content-type"} | ${rawBody.slice(0, 400)}`);
      failure.responseStatus = response.status;
      failure.responseContentType = contentType;
      failure.responseBodyPreview = rawBody.slice(0, 400);
      throw failure;
    }
  }

  if (!response.ok) {
    const failure = new Error(payload?.error || `HTTP ${response.status} ${response.statusText}`);
    failure.responseStatus = response.status;
    failure.responseContentType = contentType;
    failure.responseBodyPreview = rawBody.slice(0, 400);
    throw failure;
  }

  return payload || {};
}
