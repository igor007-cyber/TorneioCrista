export const SESSION_KEY = 'copacrista:session';

export interface SessionData {
	name: string;
	email: string;
	loggedAt: number;
}

export function getSession(): SessionData | null {
	if (typeof localStorage === 'undefined') return null;

	const raw = localStorage.getItem(SESSION_KEY);
	if (!raw) return null;

	try {
		return JSON.parse(raw) as SessionData;
	} catch {
		localStorage.removeItem(SESSION_KEY);
		return null;
	}
}

export function saveSession(session: SessionData): void {
	localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
	localStorage.removeItem(SESSION_KEY);
}

export function requireSession(loginPath = '/login'): SessionData | null {
	const session = getSession();
	if (!session) {
		const next = `${window.location.pathname}${window.location.search}`;
		window.location.href = `${loginPath}?next=${encodeURIComponent(next)}`;
		return null;
	}
	return session;
}
