/* =========================================================
   API
   Cliente HTTP compartido con access token + refresh token.
   ========================================================= */

let refreshInFlightPromise = null;

function getApiBaseUrl() {
  return window.AG360.config.apiBaseUrl || window.location.origin;
}

function shouldAttachAuthorization(options = {}) {
  return options.withoutAuth !== true;
}

function buildApiHeaders(options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = shouldAttachAuthorization(options) && typeof getAuthToken === "function"
    ? getAuthToken()
    : "";

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (!headers["Content-Type"] && options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

function buildApiRequestOptions(options = {}) {
  const requestOptions = {
    ...options,
    headers: buildApiHeaders(options),
  };

  if (options.body instanceof FormData) {
    delete requestOptions.headers["Content-Type"];
  }

  delete requestOptions.withoutAuth;
  delete requestOptions.skipAuthRefresh;

  return requestOptions;
}

async function parseApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    return text ? { message: text } : {};
  }

  return res.json().catch(() => ({}));
}

async function performTokenRefresh() {
  if (refreshInFlightPromise) {
    return refreshInFlightPromise;
  }

  refreshInFlightPromise = (async () => {
    const refreshToken = typeof getRefreshToken === "function" ? getRefreshToken() : "";
    if (!refreshToken) {
      throw new Error("No hay refresh token disponible.");
    }

    const res = await fetch(`${getApiBaseUrl()}/api/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    const data = await parseApiResponse(res);
    if (!res.ok) {
      throw new Error(data.error || data.message || "No se pudo renovar la sesión.");
    }

    if (typeof updateSessionTokens === "function") {
      updateSessionTokens(data);
    }

    return data;
  })();

  try {
    return await refreshInFlightPromise;
  } finally {
    refreshInFlightPromise = null;
  }
}

async function apiFetch(path, options = {}) {
  const requestOptions = buildApiRequestOptions(options);
  const res = await fetch(`${getApiBaseUrl()}${path}`, requestOptions);

  if (res.status === 401 && options.skipAuthRefresh !== true && shouldAttachAuthorization(options)) {
    try {
      await performTokenRefresh();
      const retryOptions = buildApiRequestOptions({
        ...options,
        skipAuthRefresh: true,
      });
      const retryRes = await fetch(`${getApiBaseUrl()}${path}`, retryOptions);
      const retryData = await parseApiResponse(retryRes);

      if (!retryRes.ok) {
        if (retryRes.status === 401 && typeof logout === "function") {
          await logout({ skipRemote: true });
        }
        throw new Error(retryData.error || retryData.message || "Error en la petición");
      }

      return retryData;
    } catch (error) {
      if (typeof logout === "function") {
        await logout({ skipRemote: true });
      }
      throw new Error(error.message || "No autorizado. Debe iniciar sesión.");
    }
  }

  const data = await parseApiResponse(res);

  if (!res.ok) {
    throw new Error(data.error || data.message || "Error en la petición");
  }

  return data;
}

window.AG360.core.api = {
  apiFetch,
  buildApiHeaders,
  buildApiRequestOptions,
};
