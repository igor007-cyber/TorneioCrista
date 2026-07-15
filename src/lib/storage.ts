// Persistência dos torneios.
//
// Fonte da verdade = tabela `tournaments` no Supabase (compartilhada entre todos
// os navegadores/dispositivos e exibida na página pública). O que a tela lê é uma
// LISTA VIVA em memória, semeada pelo cache do localStorage e substituída pelo
// que vem do banco. Nada que exista só na memória é re-enviado (evita que um
// navegador ressuscite ou propague torneios que não estão no Supabase).
//
// O localStorage é só um acelerador de primeira pintura + fallback offline. Ele
// pode falhar (aba anônima, quota) e o app precisa seguir funcionando: por isso
// a renderização NUNCA depende de a gravação do cache ter dado certo.
//
// Fluxo:
//   * leitura  → as páginas chamam loadTournaments()/loadTournament() (async) na
//     inicialização para buscar do banco e atualizar a lista viva; durante a
//     renderização usam listTournaments()/getTournament() (sync), que leem a memória.
//   * gravação → saveTournament() grava no cache na hora e espelha no banco
//     (upsert) de forma assíncrona/debounced. Use saveTournamentRemote() quando
//     precisar aguardar a confirmação do banco (ex.: criação de um torneio novo).

import type { Tournament } from './types';
import { supabase } from './supabase';

const KEY      = 'copacrista:tournaments:v1';
const OLD_KEY  = 'copacrista:tournament:v1';   // formato antigo (torneio único)
const TOMB_KEY = 'copacrista:tombstones:v1';   // ids de torneios excluídos (lápides)

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
// Estado em memória — o que a tela realmente lê
// ---------------------------------------------------------------------------
// O localStorage pode estar INDISPONÍVEL PARA ESCRITA (aba anônima do Safari/iOS,
// quota estourada, storage bloqueado por política do navegador). Nesses casos
// writeCache() falha silenciosamente. Se a renderização lesse direto do
// localStorage, os torneios vindos do banco nunca chegariam à tela — a página
// pública mostraria "nenhum torneio" mesmo com o banco respondendo certo.
//
// Por isso a lista viva fica em memória: é ela que listTournaments()/getTournament()
// devolvem. O localStorage é só um cache de pintura rápida no primeiro render e
// um fallback de leitura offline; se ele falhar, o app continua funcionando.

let memory: Tournament[] | null = null;

/** Lista viva. Na primeira chamada, semeia com o cache (pintura imediata). */
function state(): Tournament[] {
	if (memory === null) memory = readCache();
	return memory;
}

/** Atualiza a lista viva e tenta espelhá-la no cache (best-effort). */
function setState(list: Tournament[]): void {
	memory = list;
	writeCache(list);
}

// ---------------------------------------------------------------------------
// Lápides (tombstones) — ids de torneios excluídos
// ---------------------------------------------------------------------------
// A sincronização re-sobe para o banco qualquer torneio que exista só no cache
// (para recuperar itens criados offline). Sem um registro do que foi apagado,
// isso RESSUSCITA torneios excluídos: some da tela, mas volta no próximo load.
// As lápides marcam ids removidos para que nunca sejam re-enviados e para forçar
// a exclusão no banco caso reapareçam (ex.: re-subidos por outro dispositivo).

// Como o cache, as lápides vivem em memória e apenas espelham no localStorage —
// assim a exclusão continua valendo na sessão mesmo sem storage gravável.
let tombs: Set<string> | null = null;

function readTombstones(): Set<string> {
	if (tombs) return tombs;
	try {
		const raw = localStorage.getItem(TOMB_KEY);
		const arr = raw ? JSON.parse(raw) : [];
		tombs = new Set(Array.isArray(arr) ? arr : []);
	} catch {
		tombs = new Set();
	}
	return tombs;
}

function writeTombstones(ids: Set<string>): void {
	tombs = ids;
	try { localStorage.setItem(TOMB_KEY, JSON.stringify([...ids])); } catch {}
}

function addTombstone(id: string): void {
	const ids = readTombstones();
	ids.add(id);
	writeTombstones(ids);
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
	const tomb = readTombstones();
	return state().filter(t => !tomb.has(t.id));
}

export function getTournament(id: string): Tournament | null {
	if (readTombstones().has(id)) return null;
	return state().find(t => t.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Carregamento do banco (assíncrono) — chamado na inicialização das páginas
// ---------------------------------------------------------------------------

/**
 * Busca todos os torneios no Supabase — que é a ÚNICA fonte da verdade — e
 * substitui o cache local pelo resultado.
 *
 * O localStorage é apenas um cache de pintura rápida (e fallback de LEITURA
 * quando o banco está indisponível). Ele NUNCA é re-enviado ao banco: se um
 * torneio não está no Supabase, ele não aparece. Torneios novos entram no banco
 * na hora da criação (saveTournamentRemote), não por sincronização de cache —
 * assim um navegador nunca ressuscita nem propaga o que só existe na sua memória.
 */
export async function loadTournaments(): Promise<Tournament[]> {
	const { data, error } = await supabase
		.from('tournaments')
		.select('*')
		.order('created_at', { ascending: false });

	if (error) {
		console.error('[storage] falha ao carregar torneios do banco:', error.message);
		return listTournaments(); // fallback offline — mantém o que já está em memória
	}

	const tomb      = readTombstones();
	const remoteAll = (data ?? []).map(row => rowToTournament(row as Row));

	// Se um torneio excluído reaparecer no banco (ex.: re-subido por outro
	// dispositivo com cache antigo), força a remoção de novo e o mantém fora.
	for (const t of remoteAll) {
		if (tomb.has(t.id)) void supabase.from('tournaments').delete().eq('id', t.id);
	}

	// Banco = fonte da verdade. A lista viva passa a refletir exatamente o remoto.
	const remote = remoteAll
		.filter(t => !tomb.has(t.id))
		.sort((a, b) => b.createdAt - a.createdAt);

	setState(remote);
	return remote;
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
	const list = state().filter(x => x.id !== t.id);
	list.unshift(t);
	setState(list);
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
	// 1) Lista viva (+ cache) imediata — mantém a UI responsiva e síncrona.
	const list = [...state()];
	const idx  = list.findIndex(x => x.id === t.id);
	if (idx >= 0) list[idx] = t;
	else          list.unshift(t);
	setState(list);

	// 2) Espelha no banco (debounced, fire-and-forget).
	scheduleRemoteSave(t);
}

export function deleteTournament(id: string): void {
	// Lista viva + cache + lápide (impede que a sincronização o ressuscite).
	setState(state().filter(t => t.id !== id));
	addTombstone(id);

	// Cancela qualquer gravação pendente que pudesse re-subir este torneio.
	const prev = pendingSaves.get(id);
	if (prev) { clearTimeout(prev); pendingSaves.delete(id); }

	// Banco. Se falhar agora, a lápide garante nova tentativa no próximo load.
	void supabase.from('tournaments').delete().eq('id', id).then(({ error }) => {
		if (error) console.error('[storage] falha ao excluir torneio no banco:', error.message);
	});
}
