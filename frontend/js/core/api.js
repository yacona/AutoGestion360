/* =========================================================
   API
   Cliente HTTP compartido con inyeccion de token.
   ========================================================= */

function buildApiHeaders(options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = typeof getAuthToken === "function"
    ? getAuthToken()
    : window.AG360.core.storage.get(STORAGE.TOKEN, "");

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

  return requestOptions;
}

async function apiFetch(path, options = {}) {
  const baseUrl = window.AG360.config.apiBaseUrl || window.location.origin;
  const requestOptions = buildApiRequestOptions(options);
  const res = await fetch(`${baseUrl}${path}`, requestOptions);

  if (res.status === 401) {
    if (typeof logout === "function") logout();
    throw new Error("No autorizado. Debe iniciar sesion.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.message || "Error en la peticion");
  }

  return data;
}

window.AG360.core.api = {
  apiFetch,
  buildApiHeaders,
  buildApiRequestOptions,
};
