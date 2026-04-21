// Persistência local — o sistema guarda uma LISTA de torneios, cada um
// identificado por id. Migra automaticamente do formato antigo (torneio único).

import type { Tournament } from './types';

const KEY      = 'copacrista:tournaments:v1';
const OLD_KEY  = 'copacrista:tournament:v1';   // formato antigo (torneio único)

function migrateOld(): Tournament[] | null {
	try {
		const raw = localStorage.getItem(OLD_KEY);
		if (!raw) return null;
		const old = JSON.parse(raw);
		if (!old || typeof old !== 'object') return null;
		// Garante campos novos.
		if (!old.id)   old.id   = 't-' + Date.now().toString(36);
		if (!old.name) old.name = 'Torneio importado';
		localStorage.removeItem(OLD_KEY);
		return [old as Tournament];
	} catch {
		return null;
	}
}

export function listTournaments(): Tournament[] {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const list = JSON.parse(raw);
			return Array.isArray(list) ? list : [];
		}
		// Sem registros no novo formato — tenta migrar.
		const migrated = migrateOld();
		if (migrated) {
			localStorage.setItem(KEY, JSON.stringify(migrated));
			return migrated;
		}
		return [];
	} catch {
		return [];
	}
}

export function getTournament(id: string): Tournament | null {
	return listTournaments().find(t => t.id === id) ?? null;
}

/** Insere ou atualiza o torneio pela sua id. Mais recentes ficam no topo. */
export function saveTournament(t: Tournament): void {
	try {
		const list = listTournaments();
		const idx  = list.findIndex(x => x.id === t.id);
		if (idx >= 0) list[idx] = t;
		else          list.unshift(t);
		localStorage.setItem(KEY, JSON.stringify(list));
	} catch {}
}

export function deleteTournament(id: string): void {
	try {
		const list = listTournaments().filter(t => t.id !== id);
		localStorage.setItem(KEY, JSON.stringify(list));
	} catch {}
}
