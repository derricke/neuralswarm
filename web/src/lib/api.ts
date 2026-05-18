export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
export const API_AUTH_KEY = process.env.NEXT_PUBLIC_API_KEY ?? '';

function withApiHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);

  if (!merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }

  if (API_AUTH_KEY && !merged.has('Authorization')) {
    merged.set('Authorization', `Bearer ${API_AUTH_KEY}`);
  }

  return merged;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: withApiHeaders(init?.headers),
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}
