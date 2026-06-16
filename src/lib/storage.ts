// Persistência dos torneios.
//
// Fonte da verdade = tabela `tournaments` no Supabase (compartilhada entre todos
// os navegadores/dispositivos e exibida na página pública). O localStorage é
// mantido apenas como CACHE síncrono: a renderização lê dele de forma imediata
// (sem await) e ele também serve de fallback quando o banco está indisponível.
//
// Fluxo:
//   * leitura  → as páginas chamam loadTournaments()/loadTournament() (async) na
//     inicialização para buscar do banco e atualizar o cache; durante a renderização
//     usam listTournaments()/getTournament() (sync), que leem o cache.
//   * gravação → saveTournament() grava no cache na hora e espelha no banco
//     (upsert) de forma assíncrona/debounced. Use saveTournamentRemote() quando
//     precisar aguardar a confirmação do banco (ex.: criação de um torneio novo).

import type { Tournament } from './types';
import { supabase } from './supabase';

const KEY      = 'copacrista:tournaments:v1';
const OLD_KEY  = 'copacrista:tournament:v1';   // formato antigo (torneio único)

// ---------------------------------------------------------------------------
// Cache local (síncrono)
// ---------------------------------------------------------------------------

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

function readCache(): Tournament[] {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const list = JSON.parse(raw);
			return Array.isArray(list) ? list : [];
		}
		// Sem registros no novo formato — tenta migrar.
		const migrated = migrateOld();
		if (migrated) {
			writeCache(migrated);
			return migrated;
		}
		return [];
	} catch {
		return [];
	}
}

function writeCache(list: Tournament[]): void {
	try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

// ---------------------------------------------------------------------------
// Mapeamento entre a linha do banco e o objeto Tournament
// ---------------------------------------------------------------------------

interface Row {
	id: string;
	name: string;
	gender: Tournament['config']['gender'];
	sport: Tournament['config']['sport'];
	format: Tournament['config']['format'];
	teams: string[];
	phases: Tournament['phases'];
	champion: string | null;
	created_at: number;
}

function rowToTournament(r: Row): Tournament {
	return {
		id: r.id,
		name: r.name,
		config: {
			teams:  r.teams  ?? [],
			gender: r.gender,
			sport:  r.sport,
			format: r.format,
		},
		phases:   r.phases ?? [],
		champion: r.champion ?? null,
		createdAt: Number(r.created_at),
	};
}

function tournamentToRow(t: Tournament): Row {
	return {
		id:         t.id,
		name:       t.name,
		gender:     t.config.gender,
		sport:      t.config.sport,
		format:     t.config.format,
		teams:      t.config.teams,
		phases:     t.phases,
		champion:   t.champion,
		created_at: t.createdAt,
	};
}

// ---------------------------------------------------------------------------
// Leitura síncrona (cache) — usada durante a renderização
// ---------------------------------------------------------------------------

export function listTournaments(): Tournament[] {
	return readCache();
}

export function getTournament(id: string): Tournament | null {
	return readCache().find(t => t.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Carregamento do banco (assíncrono) — chamado na inicialização das páginas
// ---------------------------------------------------------------------------

/**
 * Busca todos os torneios no Supabase e MESCLA com o cache local (sem destruir).
 *
 * Importante: torneios que só existem localmente (criados antes do banco virar a
 * fonte da verdade, ou enquanto offline) são empurrados PARA o banco e mantidos
 * na lista — assim nada some da tela ao sincronizar.
 */
export async function loadTournaments(): Promise<Tournament[]> {
	const local = readCache();

	const { data, error } = await supabase
		.from('tournaments')
		.select('*')
		.order('created_at', { ascending: false });

	if (error) {
		console.error('[storage] falha ao carregar torneios do banco:', error.message);
		return local; // fallback offline — NÃO sobrescreve o cache
	}

	const remote    = (data ?? []).map(row => rowToTournament(row as Row));
	const remoteIds = new Set(remote.map(t => t.id));

	// Torneios presentes só no navegador → sobe pro banco (recupera/migra) e mantém.
	const localOnly = local.filter(t => !remoteIds.has(t.id));
	for (const t of localOnly) void saveTournamentRemote(t);

	const merged = [...remote, ...localOnly].sort((a, b) => b.createdAt - a.createdAt);
	writeCache(merged);
	return merged;
}

/** Busca um torneio específico no banco e atualiza o cache local. */
export async function loadTournament(id: string): Promise<Tournament | null> {
	const { data, error } = await supabase
		.from('tournaments')
		.select('*')
		.eq('id', id)
		.maybeSingle();

	if (error) {
		console.error('[storage] falha ao carregar torneio do banco:', error.message);
		return getTournament(id); // fallback offline
	}
	if (!data) return null;

	const t = rowToTournament(data as Row);
	const list = readCache().filter(x => x.id !== t.id);
	list.unshift(t);
	writeCache(list);
	return t;
}

// ---------------------------------------------------------------------------
// Gravação — cache imediato + espelho no banco
// ---------------------------------------------------------------------------

/** Faz o upsert do torneio no banco. Resolve para true em sucesso. */
export async function saveTournamentRemote(t: Tournament): Promise<boolean> {
	const { error } = await supabase
		.from('tournaments')
		.upsert(tournamentToRow(t), { onConflict: 'id' });

	if (error) {
		console.error('[storage] falha ao salvar torneio no banco:', error.message);
		return false;
	}
	return true;
}

// Coalesce gravações rápidas (vários renders seguidos) em um único upsert por torneio.
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRemoteSave(t: Tournament): void {
	const prev = pendingSaves.get(t.id);
	if (prev) clearTimeout(prev);
	pendingSaves.set(t.id, setTimeout(() => {
		pendingSaves.delete(t.id);
		void saveTournamentRemote(t);
	}, 400));
}

/** Insere ou atualiza o torneio pela sua id. Mais recentes ficam no topo. */
export function saveTournament(t: Tournament): void {
	// 1) Cache local imediato — mantém a UI responsiva e síncrona.
	const list = readCache();
	const idx  = list.findIndex(x => x.id === t.id);
	if (idx >= 0) list[idx] = t;
	else          list.unshift(t);
	writeCache(list);

	// 2) Espelha no banco (debounced, fire-and-forget).
	scheduleRemoteSave(t);
}

export function deleteTournament(id: string): void {
	// Cache local.
	writeCache(readCache().filter(t => t.id !== id));

	// Banco.
	const prev = pendingSaves.get(id);
	if (prev) { clearTimeout(prev); pendingSaves.delete(id); }
	void supabase.from('tournaments').delete().eq('id', id).then(({ error }) => {
		if (error) console.error('[storage] falha ao excluir torneio no banco:', error.message);
	});
}
