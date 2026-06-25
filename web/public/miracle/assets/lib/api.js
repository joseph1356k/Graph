function resolveMiracleUrl(url) {
  if (typeof url !== "string") {
    return url;
  }
  if (url.startsWith("/api/")) {
    return `/api/miracle${url}`;
  }
  return url;
}

export async function fetchJSON(url, options) {
  const response = await fetch(resolveMiracleUrl(url), options);
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
