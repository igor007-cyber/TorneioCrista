import type { Config, Format, Gender, ManualStanding, Match, Phase, Sport, Tournament } from './types';

export interface Arrangement {
	/** Para 'grupos': cada grupo com seus times, na ordem/posição desejada. */
	groups?: string[][];
	/** Para 'corrido' e 'mata-mata': times em ordem de posição/chaveamento. */
	order?: string[];
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

let idCounter = 0;
export function uid(prefix = 'id'): string {
	idCounter++;
	return `${prefix}-${Date.now().toString(36)}-${idCounter}-${Math.floor(Math.random() * 1000)}`;
}

export function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function blankMatch(home: string, away: string): Match {
	return {
		id: uid('m'),
		home, away,
		homeScore: null, awayScore: null,
		homeSets:  null, awaySets:  null,
		wo: null,
		played: false,
	};
}

function nextPow2(n: number): number {
	let p = 1;
	while (p < n) p <<= 1;
	return p;
}

// ---------------------------------------------------------------------------
// Regras de pontuação por esporte
// ---------------------------------------------------------------------------

/** Retorna 'home' | 'away' | 'draw' | null (null = partida não jogada). */
export function matchWinner(m: Match, sport: Sport): 'home' | 'away' | 'draw' | null {
	if (!m.played) return null;

	if (sport === 'volei') {
		return (m.homeSets ?? 0) > (m.awaySets ?? 0) ? 'home' : 'away';
	}
	if (sport === 'basquete') {
		if (m.wo === 'home') return 'away';   // home faltou → away vence
		if (m.wo === 'away') return 'home';
		if ((m.homeScore ?? 0) > (m.awayScore ?? 0)) return 'home';
		if ((m.awayScore ?? 0) > (m.homeScore ?? 0)) return 'away';
		return 'draw'; // defensivo — basquete não admite empate
	}
	// futebol
	if ((m.homeScore ?? 0) > (m.awayScore ?? 0)) return 'home';
	if ((m.awayScore ?? 0) > (m.homeScore ?? 0)) return 'away';
	return 'draw';
}

/** Pontos atribuídos a um lado da partida conforme o regulamento de cada esporte. */
export function matchPoints(m: Match, side: 'home' | 'away', sport: Sport): number {
	if (!m.played) return 0;
	const winner = matchWinner(m, sport);

	if (sport === 'futebol') {
		if (winner === 'draw') return 1;
		return winner === side ? 3 : 0;
	}

	if (sport === 'basquete') {
		// W.O. do próprio lado = 0; adversário faltou = 1 (vitória); normal: 1/0.
		if (m.wo === side) return 0;
		if (m.wo && m.wo !== side) return 1;
		return winner === side ? 1 : 0;
	}

	// vôlei: melhor de 3 sets (vence quem faz 2). Pontuação por placar de sets:
	const isHome = side === 'home';
	const own = isHome ? (m.homeSets ?? 0) : (m.awaySets ?? 0);
	const opp = isHome ? (m.awaySets ?? 0) : (m.homeSets ?? 0);
	if (own === 2 && opp === 0) return 3;   // vitória 2x0
	if (own === 2 && opp === 1) return 2;   // vitória 2x1
	if (own === 1 && opp === 2) return 1;   // derrota 1x2
	return 0;                                // derrota 0x2
}

// ---------------------------------------------------------------------------
// Classificação (standings)
// ---------------------------------------------------------------------------

export interface StandingRow {
	team: string;
	played: number;
	wins: number;
	draws: number;
	losses: number;
	goalsFor: number;       // gols / pontos / sets pró
	goalsAgainst: number;   // gols / pontos / sets contra
	diff: number;           // saldo
	points: number;
}

export function calculateStandings(teams: string[], matches: Match[], sport: Sport): StandingRow[] {
	const rows = new Map<string, StandingRow>();
	for (const t of teams) {
		rows.set(t, {
			team: t, played: 0, wins: 0, draws: 0, losses: 0,
			goalsFor: 0, goalsAgainst: 0, diff: 0, points: 0,
		});
	}

	for (const m of matches) {
		if (!m.played) continue;
		const home = rows.get(m.home);
		const away = rows.get(m.away);
		// Credita cada lado que pertença a esta tabela de forma independente. Em
		// grupos normais ambos estão presentes; em jogos cruzados (basquete
		// masculino: Grupo A x Grupo B) só um dos times pertence à tabela do grupo.
		if (!home && !away) continue;

		const winner = matchWinner(m, sport);
		const hFor = sport === 'volei' ? (m.homeSets ?? 0) : (m.homeScore ?? 0);
		const aFor = sport === 'volei' ? (m.awaySets ?? 0) : (m.awayScore ?? 0);

		if (home) {
			home.played++;
			home.points += matchPoints(m, 'home', sport);
			if (winner === 'home')      home.wins++;
			else if (winner === 'away') home.losses++;
			else                        home.draws++;
			home.goalsFor += hFor; home.goalsAgainst += aFor;
			home.diff = home.goalsFor - home.goalsAgainst;
		}
		if (away) {
			away.played++;
			away.points += matchPoints(m, 'away', sport);
			if (winner === 'away')      away.wins++;
			else if (winner === 'home') away.losses++;
			else                        away.draws++;
			away.goalsFor += aFor; away.goalsAgainst += hFor;
			away.diff = away.goalsFor - away.goalsAgainst;
		}
	}

	return [...rows.values()].sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.wins   !== a.wins)   return b.wins   - a.wins;
		if (b.diff   !== a.diff)   return b.diff   - a.diff;
		if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
		return a.team.localeCompare(b.team);
	});
}

/**
 * Classificação com overrides manuais aplicados por cima do cálculo automático.
 * Para cada time, os campos definidos em `manual` substituem os calculados; o
 * restante permanece automático. Reordena considerando os valores efetivos.
 */
export function effectiveStandings(
	teams: string[],
	matches: Match[],
	sport: Sport,
	manual?: Record<string, ManualStanding>,
): StandingRow[] {
	const rows = calculateStandings(teams, matches, sport);
	if (!manual) return rows;

	for (const r of rows) {
		const m = manual[r.team];
		if (!m) continue;
		if (m.points != null) r.points = m.points;
		if (m.played != null) r.played = m.played;
		if (m.wins   != null) r.wins   = m.wins;
		if (m.draws  != null) r.draws  = m.draws;
		if (m.losses != null) r.losses = m.losses;
		if (m.diff   != null) r.diff   = m.diff;
	}

	return rows.sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.wins   !== a.wins)   return b.wins   - a.wins;
		if (b.diff   !== a.diff)   return b.diff   - a.diff;
		if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
		return a.team.localeCompare(b.team);
	});
}

// ---------------------------------------------------------------------------
// Geração — formato "Campeonato Corrido" (round-robin)
// ---------------------------------------------------------------------------

/** Calendário round-robin pelo método do círculo. Retorna rodadas como pares de times. */
function roundRobinRounds(teams: string[]): string[][][] {
	const t = [...teams];
	const withBye = t.length % 2 !== 0;
	if (withBye) t.push('__BYE__');

	const n = t.length;
	const rounds: string[][][] = [];

	for (let r = 0; r < n - 1; r++) {
		const pairs: string[][] = [];
		for (let i = 0; i < n / 2; i++) {
			const a = t[i];
			const b = t[n - 1 - i];
			if (a === '__BYE__' || b === '__BYE__') continue;
			// Alterna mando para distribuir mais uniformemente.
			pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
		}
		rounds.push(pairs);
		// Rotação: primeiro fixo, demais giram.
		const fixed = t[0];
		const rest = t.slice(1);
		rest.unshift(rest.pop()!);
		t.splice(0, t.length, fixed, ...rest);
	}
	return rounds;
}

function generateRoundRobin(teams: string[]): Phase[] {
	const rounds = roundRobinRounds(teams);

	// Phase "standings" global no topo + uma phase por rodada.
	const standingsPhase: Phase = {
		id: uid('phase'),
		name: 'Classificação Geral',
		type: 'standings',
		teams,
		matches: [],    // as partidas vivem nas phases de rodada
		status: 'pending',
	};

	const roundPhases: Phase[] = rounds.map((matches, i) => ({
		id: uid('phase'),
		name: `Rodada ${i + 1}`,
		type: 'round',
		teams,
		matches: matches.map(([h, a]) => blankMatch(h, a)),
		status: 'pending',
	}));

	return [standingsPhase, ...roundPhases];
}

// ---------------------------------------------------------------------------
// Geração — formato "Fase de Grupos"
// ---------------------------------------------------------------------------

export function chooseGroupCount(n: number): number {
	// Meta: grupos de ~4 times, tamanho mínimo 3.
	// 3–5 → 1 grupo; 6–7 → 2; 8–9 → 2 (de 4) ou 3 (de 3); usaremos arredondamento.
	if (n <= 5) return 1;
	return Math.max(1, Math.round(n / 4));
}

/** Distribuição automática (fallback): embaralha e reparte em grupos (~4 por grupo). */
function autoGroups(teams: string[]): string[][] {
	const shuffled = shuffle(teams);
	const groupCount = chooseGroupCount(shuffled.length);
	const bucket: string[][] = Array.from({ length: groupCount }, () => []);
	shuffled.forEach((t, i) => bucket[i % groupCount].push(t));
	return bucket;
}

/** Monta as fases de grupo a partir de uma divisão já pronta (manual ou automática). */
function generateGroups(groups: string[][]): Phase[] {
	return groups.map((gTeams, i) => {
		const rounds = roundRobinRounds(gTeams);
		const matches: Match[] = [];
		rounds.forEach((r, rIdx) => r.forEach(([h, a]) => {
			const m = blankMatch(h, a);
			m.round = rIdx + 1;
			matches.push(m);
		}));
		return {
			id: uid('group'),
			name: `Grupo ${String.fromCharCode(65 + i)}`,
			type: 'group' as const,
			teams: gTeams,
			matches,
			status: 'pending' as const,
		};
	});
}

/**
 * Categorias que usam o calendário de grupos reduzido (ver regras abaixo):
 * futsal feminino, vôlei masculino e basquete feminino.
 */
function usesReducedGroups(config: Config): boolean {
	return (config.sport === 'futebol'  && config.gender === 'feminino')
		|| (config.sport === 'volei'    && config.gender === 'masculino')
		|| (config.sport === 'basquete' && config.gender === 'feminino');
}

/**
 * Confrontos (por posição dentro do grupo) do calendário REDUZIDO conforme o
 * regulamento dessas categorias. Cada time joga 2 partidas.
 *   - Grupo de 5: 1x2, 3x4 (rodada 1), 1x5, 2x3 (rodada 2) e 4x5 (rodada 3).
 *   - Grupo de 4: 1x2, 3x4 (rodada 1) e 1x3, 2x4 (rodada 2).
 *   - Grupo de 3: todos contra todos — 1x2, 1x3, 2x3.
 * Retorna null para tamanhos diferentes (cai no round-robin padrão).
 */
function reducedGroupPairs(size: number): Array<[number, number]> | null {
	if (size === 5) return [[0, 1], [2, 3], [0, 4], [1, 2], [3, 4]];
	if (size === 4) return [[0, 1], [2, 3], [0, 2], [1, 3]];
	if (size === 3) return [[0, 1], [0, 2], [1, 2]];
	return null;
}

/** Monta as fases de grupo com o calendário reduzido. */
function generateReducedGroups(groups: string[][]): Phase[] {
	return groups.map((gTeams, i) => {
		const pairs = reducedGroupPairs(gTeams.length);
		const matches: Match[] = [];

		if (pairs) {
			// Grupos de 4/5 → 2 jogos por rodada; grupo de 3 → 1 jogo por rodada.
			const perRound = gTeams.length === 3 ? 1 : 2;
			pairs.forEach(([a, b], idx) => {
				const m = blankMatch(gTeams[a], gTeams[b]);
				m.round = Math.floor(idx / perRound) + 1;
				matches.push(m);
			});
		} else {
			// Tamanho fora do previsto: round-robin completo (fallback).
			const rounds = roundRobinRounds(gTeams);
			rounds.forEach((r, rIdx) => r.forEach(([h, a]) => {
				const m = blankMatch(h, a);
				m.round = rIdx + 1;
				matches.push(m);
			}));
		}

		return {
			id: uid('group'),
			name: `Grupo ${String.fromCharCode(65 + i)}`,
			type: 'group' as const,
			teams: gTeams,
			matches,
			status: 'pending' as const,
		};
	});
}

// ---------------------------------------------------------------------------
// Geração — formato "Mata-Mata" (single elimination bracket)
// ---------------------------------------------------------------------------

function knockoutPhaseName(roundIndex: number, totalRounds: number): string {
	const fromEnd = totalRounds - roundIndex - 1;
	if (fromEnd === 0) return 'Final';
	if (fromEnd === 1) return 'Semifinal';
	if (fromEnd === 2) return 'Quartas de Final';
	if (fromEnd === 3) return 'Oitavas de Final';
	if (fromEnd === 4) return '16 avos de Final';
	return `Rodada ${roundIndex + 1}`;
}

/**
 * Constrói um chaveamento eliminatório a partir de um vetor de times.
 * Times em excesso (para chegar na próxima potência de 2) recebem BYE na primeira rodada,
 * atribuído aos primeiros "seeds" para dar avanço direto.
 */
function buildKnockoutBracket(teamsInOrder: string[]): Phase[] {
	const n = teamsInOrder.length;
	if (n < 2) return [];

	const P = nextPow2(n);
	const byes = P - n;
	const totalRounds = Math.log2(P);

	// Monta as "vagas" da primeira rodada: cabeças de chave ganham BYE.
	const slots: (string | null)[] = [];
	let idx = 0;
	for (let pair = 0; pair < P / 2; pair++) {
		if (pair < byes) {
			slots.push(teamsInOrder[idx++]);
			slots.push(null);                 // BYE
		} else {
			slots.push(teamsInOrder[idx++]);
			slots.push(teamsInOrder[idx++]);
		}
	}

	type Ref = { team?: string | null; matchId?: string };
	let refs: Ref[] = slots.map(s => ({ team: s ?? undefined }));

	const phases: Phase[] = [];

	for (let r = 0; r < totalRounds; r++) {
		const matches: Match[] = [];
		const nextRefs: Ref[] = [];
		const phaseName = knockoutPhaseName(r, totalRounds);

		for (let i = 0; i < refs.length; i += 2) {
			const A = refs[i];
			const B = refs[i + 1];
			const aEmpty = !A.team && !A.matchId;
			const bEmpty = !B.team && !B.matchId;

			if (aEmpty && bEmpty) { nextRefs.push({}); continue; }
			if (aEmpty) { nextRefs.push(B); continue; }
			if (bEmpty) { nextRefs.push(A); continue; }

			const homeLabel = A.team ?? `Vencedor ${phases[phases.length - 1]?.name ?? ''} #${Math.floor(i / 2) * 2 + 1}`;
			const awayLabel = B.team ?? `Vencedor ${phases[phases.length - 1]?.name ?? ''} #${Math.floor(i / 2) * 2 + 2}`;
			const m: Match = blankMatch(homeLabel, awayLabel);
			m.feedsFrom = [A.matchId ?? '', B.matchId ?? ''];
			matches.push(m);
			nextRefs.push({ matchId: m.id });
		}

		phases.push({
			id: uid('phase'),
			name: phaseName,
			type: 'knockout',
			teams: [],
			matches,
			status: 'pending',
		});
		refs = nextRefs;
	}
	return phases;
}

// ---------------------------------------------------------------------------
// Fachada pública — geração inicial
// ---------------------------------------------------------------------------

export function generateTournament(config: Config, arrangement?: Arrangement): Tournament {
	let phases: Phase[];
	if (config.format === 'corrido')
		phases = generateRoundRobin(arrangement?.order ?? shuffle(config.teams));
	else if (config.format === 'mata-mata')
		phases = buildKnockoutBracket(arrangement?.order ?? shuffle(config.teams));
	else if (usesReducedGroups(config))
		// Futsal feminino / vôlei masculino: calendário de grupos reduzido
		// (grupo de 4 = 4 jogos; de 3 = 3 jogos).
		phases = generateReducedGroups(arrangement?.groups ?? autoGroups(config.teams));
	else
		phases = generateGroups(arrangement?.groups ?? autoGroups(config.teams));

	const name = `Campeonato ${GENDER_LABEL[config.gender]} de ${SPORT_LABEL[config.sport]}`;

	const t: Tournament = {
		id:   't-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000),
		name,
		config,
		phases,
		champion: null,
		createdAt: Date.now(),
	};
	return updateTournament(t);
}

// ---------------------------------------------------------------------------
// Atualização — recalcula status, propaga vencedores, define campeão
// ---------------------------------------------------------------------------

/**
 * Gera (ou regenera) as fases eliminatórias de um torneio de grupos a partir
 * dos classificados (1º e 2º de cada grupo, com cruzamento 1A×2B / 1B×2A).
 */
function buildKnockoutFromGroupQualifiers(groups: Phase[], sport: Sport): Phase[] {
	const top2: Array<[string, string]> = groups.map(g => {
		const s = calculateStandings(g.teams, g.matches, sport);
		return [s[0]?.team ?? '', s[1]?.team ?? ''];
	});

	// Ordem dos classificados na chave (cruzamento adjacente entre grupos):
	// pares (G0,G1): 1A,2B,1B,2A | pares (G2,G3): 1C,2D,1D,2C | ...
	const ordered: string[] = [];
	for (let i = 0; i < top2.length; i += 2) {
		const a = top2[i];
		const b = top2[i + 1];
		if (a && b) {
			ordered.push(a[0], b[1], b[0], a[1]);
		} else if (a) {
			ordered.push(a[0], a[1]);
		}
	}
	return buildKnockoutBracket(ordered);
}

export function updateTournament(t: Tournament): Tournament {
	// 1) Status de cada fase.
	for (const phase of t.phases) {
		if (phase.type === 'standings') { phase.status = 'pending'; continue; }
		const played = phase.matches.filter(m => m.played).length;
		const total  = phase.matches.length;
		if (total === 0)          phase.status = 'pending';
		else if (played === 0)    phase.status = 'pending';
		else if (played === total) phase.status = 'completed';
		else                       phase.status = 'in-progress';
	}

	// 2) Em formato "grupos": gerar mata-mata quando todos os grupos estiverem concluídos.
	if (t.config.format === 'grupos') {
		const groups    = t.phases.filter(p => p.type === 'group');
		const knockouts = t.phases.filter(p => p.type === 'knockout');
		const allDone   = groups.length > 0 && groups.every(g => g.status === 'completed');

		if (allDone && knockouts.length === 0 && groups.length >= 2) {
			const ko = buildKnockoutFromGroupQualifiers(groups, t.config.sport);
			t.phases.push(...ko);
		}
	}

	// 3) Propagar vencedores no mata-mata (preenche home/away conforme as partidas
	//    anteriores vão sendo resolvidas).
	const byId = new Map<string, Match>();
	for (const p of t.phases) for (const m of p.matches) byId.set(m.id, m);

	for (const phase of t.phases) {
		if (phase.type !== 'knockout') continue;
		for (const m of phase.matches) {
			if (!m.feedsFrom) continue;
			const [aId, bId] = m.feedsFrom;
			const aMatch = aId ? byId.get(aId) : null;
			const bMatch = bId ? byId.get(bId) : null;

			// Partida da primeira rodada — home/away já contêm os times reais.
			if (!aMatch && !bMatch) continue;

			if (aMatch) {
				if (aMatch.played) {
					const w = matchWinner(aMatch, t.config.sport);
					m.home = w === 'home' ? aMatch.home : aMatch.away;
				} else {
					m.home = 'Vencedor (a definir)';
				}
			}
			if (bMatch) {
				if (bMatch.played) {
					const w = matchWinner(bMatch, t.config.sport);
					m.away = w === 'home' ? bMatch.home : bMatch.away;
				} else {
					m.away = 'Vencedor (a definir)';
				}
			}

			// Cascata: se algum pai voltou a ficar indefinido, a partida filha
			// deixa de valer e seus placares são apagados.
			const aUnready = aMatch && !aMatch.played;
			const bUnready = bMatch && !bMatch.played;
			if (aUnready || bUnready) {
				m.played = false;
				m.homeScore = null; m.awayScore = null;
				m.homeSets  = null; m.awaySets  = null;
				m.wo = null;
			}
		}
	}

	// 4) Campeão.
	t.champion = null;

	if (t.config.format === 'corrido') {
		const rounds = t.phases.filter(p => p.type === 'round');
		if (rounds.length > 0 && rounds.every(p => p.status === 'completed')) {
			const allMatches = rounds.flatMap(p => p.matches);
			const standings  = calculateStandings(t.config.teams, allMatches, t.config.sport);
			if (standings.length > 0) t.champion = standings[0].team;
		}
	} else {
		const ko = t.phases.filter(p => p.type === 'knockout');
		if (ko.length > 0) {
			const finalPhase = ko[ko.length - 1];
			const finalMatch = finalPhase.matches[finalPhase.matches.length - 1];
			if (finalMatch?.played) {
				const w = matchWinner(finalMatch, t.config.sport);
				t.champion = w === 'home' ? finalMatch.home : finalMatch.away;
			}
		} else if (t.config.format === 'grupos') {
			// Grupo único: campeão é o líder quando todos os jogos terminarem.
			const groups = t.phases.filter(p => p.type === 'group');
			if (groups.length === 1 && groups[0].status === 'completed') {
				const s = calculateStandings(groups[0].teams, groups[0].matches, t.config.sport);
				if (s[0]) t.champion = s[0].team;
			}
		}
	}

	return t;
}

// ---------------------------------------------------------------------------
// Helpers de exibição
// ---------------------------------------------------------------------------

export const SPORT_LABEL: Record<Sport, string>  = { futebol: 'Futsal', basquete: 'Basquete', volei: 'Vôlei' };
export const FORMAT_LABEL: Record<Format, string> = { grupos: 'Fase de Grupos', corrido: 'Campeonato Corrido', 'mata-mata': 'Mata-Mata' };
export const GENDER_LABEL: Record<Gender, string> = { masculino: 'Masculino', feminino: 'Feminino' };

/** Rótulo da coluna de saldo conforme esporte. */
export function diffLabel(sport: Sport): string {
	if (sport === 'futebol')  return 'SG';
	if (sport === 'basquete') return 'SP';
	return 'SS';
}
export function diffTitle(sport: Sport): string {
	if (sport === 'futebol')  return 'Saldo de Gols';
	if (sport === 'basquete') return 'Saldo de Pontos';
	return 'Saldo de Sets';
}
