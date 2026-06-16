// Tipos compartilhados entre a página de configuração e a de visualização.

export type Gender = 'masculino' | 'feminino';
export type Sport  = 'futebol' | 'basquete' | 'volei';
export type Format = 'grupos' | 'corrido' | 'mata-mata';

export interface Config {
	teams:  string[];
	gender: Gender;
	sport:  Sport;
	format: Format;
}

/**
 * Uma partida. Dependendo do esporte, diferentes campos são relevantes:
 *   - futebol:  homeScore / awayScore (gols)
 *   - basquete: homeScore / awayScore (pontos) + wo (W.O.)
 *   - volei:    homeSets  / awaySets  (0..3, um deles obrigatoriamente 3)
 */
export interface Match {
	id:          string;
	home:        string;          // nome do time ou placeholder ("Vencedor Quartas 1")
	away:        string;
	homeScore:   number | null;
	awayScore:   number | null;
	homeSets:    number | null;
	awaySets:    number | null;
	wo:          'home' | 'away' | null;
	played:      boolean;
	// Agendamento da partida (opcional). Formato ISO parcial "YYYY-MM-DDTHH:MM"
	// (o mesmo gerado pelo input type="datetime-local").
	dateTime?:  string | null;
	// Número da rodada dentro da fase (usado em grupos para agrupar jogos).
	round?:     number;
	// Para mata-mata: IDs das partidas pais (ganhador alimenta home/away desta).
	feedsFrom?: [string, string];
}

export type PhaseType = 'group' | 'round' | 'knockout' | 'standings';

/**
 * Override manual da classificação de um time. Cada campo é opcional: quando
 * preenchido, substitui o valor calculado automaticamente; quando ausente,
 * mantém o automático. Permite ao organizador ajustar a tabela à mão.
 */
export interface ManualStanding {
	points?: number;
	played?: number;
	wins?:   number;
	draws?:  number;
	losses?: number;
	diff?:   number;   // saldo (SG/SP/SS)
}

export interface Phase {
	id:      string;
	name:    string;              // "Grupo A", "Rodada 3", "Semifinal", "Classificação Geral"
	type:    PhaseType;
	teams:   string[];            // times envolvidos (vazio para knockout de rounds futuros)
	matches: Match[];
	status:  'pending' | 'in-progress' | 'completed';
	// Overrides manuais da classificação, por nome do time. Opcional.
	manualStandings?: Record<string, ManualStanding>;
}

export interface Tournament {
	id:        string;
	name:      string;           // rótulo derivado da config (editável futuramente)
	config:    Config;
	phases:    Phase[];
	champion:  string | null;
	createdAt: number;
}
