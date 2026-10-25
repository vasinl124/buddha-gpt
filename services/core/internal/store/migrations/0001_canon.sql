create extension if not exists vector;
create extension if not exists pg_trgm;

-- The canon. `buddha sync` is the only writer.
create table suttas (
  id         text primary key,        -- 'mn10', 'sn56.11', 'dhp1-20': SuttaCentral-style IDs
  collection text not null,           -- 'MN', 'SN', 'Dhp'
  title_pi   text,
  title_en   text
);

create table paras (
  id       text primary key,          -- 'mn10#pi12', 'mn10#en7', 'mn10#en7-2'
  sutta_id text not null references suttas,
  lang     text not null,             -- 'pi' | 'en'
  ord      int not null,              -- paragraph number within the sutta
  part     smallint not null default 1, -- piece of a long paragraph
  source   text not null,             -- 'vri' | 'thanissaro'
  text     text not null,
  lex      text not null,             -- folded copy (no diacritics, lowercase) for trigram search
  hash     text not null              -- re-embed only when this changes
);
create index paras_sutta on paras (sutta_id);
create index paras_lex on paras using gin (lex gin_trgm_ops);

create table para_vecs (
  para_id text not null references paras on delete cascade,
  model   text not null,              -- vectors are kept per model, so a swap is re-embed then flip
  v       vector not null,
  primary key (para_id, model)
);
-- one HNSW index per production embedding model (other models fall back to a scan)
create index para_vecs_bge_m3 on para_vecs
  using hnsw ((v::vector(1024)) vector_cosine_ops) where model = 'baai/bge-m3';
