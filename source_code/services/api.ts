const API_URL = import.meta.env.VITE_API_URL || ''; // '' → /api sur Netlify (proxy) ; ou https://colweyz.ddns.net/api
const BASE_PATH = `${API_URL}/api`;

/** URL de base affichée / debug (mode secours). */
export function getApiBasePath(): string {
  return BASE_PATH || '/api';
}

/** Encode un ID pour les chemins URL (#CW84854 → %23CW84854). */
export function apiId(id: string): string {
  return encodeURIComponent(id);
}

export class ApiError extends Error {
  public status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('jwt_token');
  
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE_PATH}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Token is invalid/expired
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('user_role');
      window.dispatchEvent(new Event('auth_expired'));
    }
    
    let message = 'Erreur réseau';
    try {
      const errorData = await response.json();
      message = errorData.error || message;
    } catch {
      message = response.statusText;
    }
    throw new ApiError(message, response.status);
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return {} as T;
  
  try {
    return JSON.parse(text);
  } catch {
    return text as unknown as T;
  }
}

export const api = {
  get: <T>(endpoint: string, options?: RequestInit) => 
    request<T>(endpoint, { ...options, method: 'GET' }),
    
  post: <T>(endpoint: string, data?: any, options?: RequestInit) => 
    request<T>(endpoint, { ...options, method: 'POST', body: data ? JSON.stringify(data) : undefined }),
    
  put: <T>(endpoint: string, data: any, options?: RequestInit) => 
    request<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(data) }),
    
  delete: <T>(endpoint: string, options?: RequestInit) => 
    request<T>(endpoint, { ...options, method: 'DELETE' }),
};
