-- ============================================================================
-- CopaCrista — usuários de login (sem cadastro público, só login)
-- ----------------------------------------------------------------------------
-- Não existe tela de cadastro: os usuários são inseridos manualmente aqui.
-- A senha é guardada com HASH bcrypt (extensão pgcrypto) — nunca em texto puro.
-- A tabela fica protegida por RLS sem nenhuma política para a chave anon, então
-- o front NÃO consegue ler os hashes. O login é validado pela função
-- verify_login(), que compara a senha internamente e só devolve e-mail + role.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.app_users (
    id            uuid        primary key default gen_random_uuid(),
    email         text        unique not null,
    password_hash text        not null,
    role          text        not null default 'admin',
    created_at    timestamptz not null default now()
);

-- RLS habilitado e SEM políticas para anon/authenticated => acesso direto negado.
-- (Os hashes ficam inacessíveis pelo front; só a função verify_login lê a tabela.)
alter table public.app_users enable row level security;

-- ----------------------------------------------------------------------------
-- Usuário admin. A senha é hasheada com bcrypt no momento do INSERT.
-- on conflict: se já existir, atualiza a senha/role (idempotente).
-- ----------------------------------------------------------------------------
insert into public.app_users (email, password_hash, role)
values (
    'admin@gmail.com',
    crypt('copacrista@pib#1653#igor', gen_salt('bf')),
    'admin'
)
on conflict (email) do update
    set password_hash = excluded.password_hash,
        role          = excluded.role;

-- ----------------------------------------------------------------------------
-- Função de verificação de login (SECURITY DEFINER).
-- Compara a senha enviada com o hash guardado, sem expor o hash ao cliente.
-- Retorna a linha (email, role) quando as credenciais batem; vazio caso contrário.
-- ----------------------------------------------------------------------------
create or replace function public.verify_login(p_email text, p_password text)
returns table (email text, role text)
language sql
security definer
set search_path = public, extensions
as $$
    select u.email, u.role
    from public.app_users u
    where u.email = lower(p_email)
      and u.password_hash = crypt(p_password, u.password_hash);
$$;

-- O front (chave anon) pode chamar a função, mas não a tabela.
grant execute on function public.verify_login(text, text) to anon, authenticated;
