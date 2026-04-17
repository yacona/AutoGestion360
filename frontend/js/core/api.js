const API_BASE_URL = window.location.origin;

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem(STORAGE.TOKEN);
  const headers = options.headers || {};

  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }

  const requestOptions = { ...options, headers };

  if (options.body instanceof FormData) {
    delete requestOptions.headers["Content-Type"];
  }

  const res = await fetch(`${API_BASE_URL}${path}`, requestOptions);

  if (res.status === 401) {
    logout();
    throw new Error("No autorizado. Debe iniciar sesión.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.message || "Error en la petición");
  }

  return data;
}
