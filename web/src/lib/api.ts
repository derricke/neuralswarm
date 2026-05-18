export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
export const API_AUTH_KEY = process.env.NEXT_PUBLIC_API_KEY ?? '';

const API_KEY_STORAGE_KEY = 'neuralswarm_api_key';

export function getApiAuthKey(): string {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(API_KEY_STORAGE_KEY)?.trim();
    if (stored) {
      return stored;
    }
  }

  return API_AUTH_KEY.trim();
}

export function setApiAuthKey(value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = value.trim();
  if (!normalized) {
    window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(API_KEY_STORAGE_KEY, normalized);
}

function withApiHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);

  if (!merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }

  const apiKey = getApiAuthKey();
  if (apiKey && !merged.has('Authorization')) {
    merged.set('Authorization', `Bearer ${apiKey}`);
  }

  return merged;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const makeRequest = () =>
    fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: withApiHeaders(init?.headers),
      cache: 'no-store',
    });

  let response = await makeRequest();

  if (
    response.status === 401 &&
    typeof window !== 'undefined' &&
    window.localStorage.getItem(API_KEY_STORAGE_KEY)
  ) {
    const text = await response.text();

    if (text.includes('Invalid or expired API key')) {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
      response = await makeRequest();
    } else {
      throw new Error(text || `Request failed with ${response.status}`);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}
