-- ============================================================================
-- CopaCrista — esquema inicial do banco
-- ----------------------------------------------------------------------------
-- Modelagem baseada na lógica do app (src/lib/types.ts):
--
--   Tournament { id, name, config{teams,gender,sport,format}, phases[], champion, createdAt }
--     Phase     { id, name, type, teams[], matches[], status }
--       Match   { id, home, away, scores..., wo, played, dateTime, round, feedsFrom }
--
-- O app sempre lê/grava um torneio INTEIRO de uma vez (saveTournament substitui
-- o objeto completo). A classificação e o chaveamento são CALCULADOS no cliente
-- a partir das partidas — nada disso é persistido de forma derivada.
--
-- Por isso o desenho é híbrido:
--   * Metadados consultáveis (esporte, formato, gênero, campeão) viram colunas.
--   * A árvore aninhada de fases + partidas fica em uma coluna JSONB (`phases`),
--     pois é sempre manipulada em bloco e tem referências internas (feedsFrom).
-- ============================================================================

create table if not exists public.tournaments (
    id          text        primary key,                 -- id gerado pelo app ("t-...")
    name        text        not null,
    gender      text        not null check (gender in ('masculino', 'feminino')),
    sport       text        not null check (sport  in ('futebol', 'basquete', 'volei')),
    format      text        not null check (format in ('grupos', 'corrido', 'mata-mata')),
    teams       jsonb       not null default '[]'::jsonb, -- string[] de nomes dos times
    phases      jsonb       not null default '[]'::jsonb, -- Phase[] (com matches[] aninhadas)
    champion    text,                                     -- nome do campeão ou null
    created_at  bigint      not null,                     -- espelha Tournament.createdAt (epoch ms)
    updated_at  timestamptz not null default now()        -- housekeeping do banco
);

-- Índices úteis para listagens/filtros futuros.
create index if not exists tournaments_created_at_idx on public.tournaments (created_at desc);
create index if not exists tournaments_sport_idx      on public.tournaments (sport);

-- ----------------------------------------------------------------------------
-- Atualiza updated_at automaticamente em cada UPDATE.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists tournaments_set_updated_at on public.tournaments;
create trigger tournaments_set_updated_at
    before update on public.tournaments
    for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
-- ATENÇÃO: o app hoje não usa autenticação real do Supabase (o "login" é apenas
-- uma trava no navegador via localStorage). Para o app funcionar com a chave
-- ANON, estas políticas liberam acesso total às roles anon/authenticated.
--
-- Isso significa que QUALQUER pessoa com a chave anon (que é pública no front)
-- pode ler/gravar os torneios. É o mesmo nível de segurança do sistema atual.
-- Para proteger de verdade, troque por Supabase Auth + políticas restritivas.
-- ----------------------------------------------------------------------------
alter table public.tournaments enable row level security;

drop policy if exists tournaments_anon_all on public.tournaments;
create policy tournaments_anon_all
    on public.tournaments
    for all
    to anon, authenticated
    using (true)
    with check (true);
