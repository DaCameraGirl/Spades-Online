create extension if not exists pgcrypto;

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  screen_name text not null,
  email text not null,
  password_hash text not null,
  elo_rating integer not null default 1500,
  highest_rating integer not null default 1500,
  wins integer not null default 0,
  losses integer not null default 0,
  games_played integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists players_screen_name_lower_idx on players (lower(screen_name));
create unique index if not exists players_email_lower_idx on players (lower(email));

create table if not exists sessions (
  token text primary key,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sessions_player_id_idx on sessions (player_id);

create table if not exists rated_matches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  team_a_player1 uuid not null references players(id),
  team_a_player2 uuid not null references players(id),
  team_b_player1 uuid not null references players(id),
  team_b_player2 uuid not null references players(id),
  winning_team text not null check (winning_team in ('A', 'B')),
  team_a_rating_before numeric not null,
  team_b_rating_before numeric not null,
  delta integer not null,
  played_at timestamptz not null default now()
);

create unique index if not exists rated_matches_idempotency_key_idx on rated_matches (idempotency_key);
