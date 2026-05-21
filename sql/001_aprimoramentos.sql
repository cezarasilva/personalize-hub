-- =========================================================
-- PERSONALIZE HUB V3 - REMESSAS + FINANCEIRO + ASSINATURA
-- Seguro para rodar no Supabase SQL Editor.
-- Não apaga dados. Não usa DROP. Não usa DELETE.
-- =========================================================

BEGIN;

-- =========================================================
-- 1. HISTÓRICO DE MOVIMENTAÇÕES
-- =========================================================
CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
    id SERIAL PRIMARY KEY,
    produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
    variacao_id INTEGER REFERENCES produto_variacoes(id) ON DELETE SET NULL,
    parceiro_id INTEGER REFERENCES parceiros(id) ON DELETE SET NULL,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    tipo VARCHAR(60) NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 0,
    estoque_origem VARCHAR(80),
    estoque_destino VARCHAR(80),
    referencia_tipo VARCHAR(60),
    referencia_id INTEGER,
    observacao TEXT,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS variacao_id INTEGER REFERENCES produto_variacoes(id) ON DELETE SET NULL;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS parceiro_id INTEGER REFERENCES parceiros(id) ON DELETE SET NULL;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS tipo VARCHAR(60);
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS quantidade INTEGER DEFAULT 0;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS estoque_origem VARCHAR(80);
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS estoque_destino VARCHAR(80);
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS referencia_tipo VARCHAR(60);
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS referencia_id INTEGER;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS observacao TEXT;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- =========================================================
-- 2. REMESSAS COM HISTÓRICO REAL
-- =========================================================
CREATE TABLE IF NOT EXISTS remessas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(80),
    parceiro_id INTEGER REFERENCES parceiros(id) ON DELETE SET NULL,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    status VARCHAR(30) DEFAULT 'ENVIADA',
    observacao TEXT,
    termo_guarda TEXT,
    status_assinatura VARCHAR(30) DEFAULT 'PENDENTE',
    assinada_por VARCHAR(160),
    documento_assinatura VARCHAR(60),
    data_assinatura TIMESTAMP,
    data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_estorno TIMESTAMP,
    motivo_estorno TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE remessas ADD COLUMN IF NOT EXISTS codigo VARCHAR(80);
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS parceiro_id INTEGER REFERENCES parceiros(id) ON DELETE SET NULL;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'ENVIADA';
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS observacao TEXT;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS termo_guarda TEXT;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS status_assinatura VARCHAR(30) DEFAULT 'PENDENTE';
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS assinada_por VARCHAR(160);
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS documento_assinatura VARCHAR(60);
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS data_assinatura TIMESTAMP;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS data_estorno TIMESTAMP;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS motivo_estorno TEXT;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE remessas ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- =========================================================
-- 3. ITENS DA REMESSA
-- Mantém compatibilidade com a V2 e adiciona snapshots completos.
-- =========================================================
CREATE TABLE IF NOT EXISTS remessa_itens (
    id SERIAL PRIMARY KEY,
    remessa_id INTEGER REFERENCES remessas(id) ON DELETE CASCADE,
    produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
    variacao_id INTEGER REFERENCES produto_variacoes(id) ON DELETE SET NULL,
    produto_nome_snapshot VARCHAR(255),
    variacao_snapshot VARCHAR(100),
    sku_snapshot VARCHAR(100),
    imagem_url_snapshot TEXT,
    quantidade INTEGER,
    quantidade_enviada INTEGER DEFAULT 0,
    quantidade_estornada INTEGER NOT NULL DEFAULT 0,
    preco_repasse_snapshot NUMERIC(10,2) DEFAULT 0,
    preco_venda_snapshot NUMERIC(10,2) DEFAULT 0,
    preco_repasse_unitario NUMERIC(10,2) DEFAULT 0,
    valor_total_original NUMERIC(10,2) DEFAULT 0,
    valor_total_estornado NUMERIC(10,2) DEFAULT 0,
    valor_total_saldo NUMERIC(10,2) DEFAULT 0,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS remessa_id INTEGER REFERENCES remessas(id) ON DELETE CASCADE;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS variacao_id INTEGER REFERENCES produto_variacoes(id) ON DELETE SET NULL;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS produto_nome_snapshot VARCHAR(255);
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS variacao_snapshot VARCHAR(100);
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS sku_snapshot VARCHAR(100);
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS imagem_url_snapshot TEXT;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS quantidade INTEGER;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS quantidade_enviada INTEGER DEFAULT 0;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS quantidade_estornada INTEGER NOT NULL DEFAULT 0;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS preco_repasse_snapshot NUMERIC(10,2) DEFAULT 0;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS preco_venda_snapshot NUMERIC(10,2) DEFAULT 0;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS preco_repasse_unitario NUMERIC(10,2) DEFAULT 0;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS valor_total_original NUMERIC(10,2) DEFAULT 0;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS valor_total_estornado NUMERIC(10,2) DEFAULT 0;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS valor_total_saldo NUMERIC(10,2) DEFAULT 0;
ALTER TABLE remessa_itens ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Backfill seguro para alinhar versões antigas/novas.
UPDATE remessa_itens
SET quantidade_enviada = COALESCE(NULLIF(quantidade_enviada, 0), quantidade, 0)
WHERE quantidade_enviada IS NULL OR quantidade_enviada = 0;

UPDATE remessa_itens
SET quantidade = COALESCE(quantidade, quantidade_enviada, 0)
WHERE quantidade IS NULL;

UPDATE remessa_itens
SET preco_repasse_unitario = COALESCE(NULLIF(preco_repasse_unitario, 0), preco_repasse_snapshot, 0)
WHERE preco_repasse_unitario IS NULL OR preco_repasse_unitario = 0;

UPDATE remessa_itens
SET preco_repasse_snapshot = COALESCE(NULLIF(preco_repasse_snapshot, 0), preco_repasse_unitario, 0)
WHERE preco_repasse_snapshot IS NULL OR preco_repasse_snapshot = 0;

UPDATE remessa_itens ri
SET produto_nome_snapshot = COALESCE(ri.produto_nome_snapshot, p.nome),
    imagem_url_snapshot = COALESCE(ri.imagem_url_snapshot, p.imagem_url)
FROM produtos p
WHERE p.id = ri.produto_id;

UPDATE remessa_itens ri
SET variacao_snapshot = COALESCE(ri.variacao_snapshot, pv.variacao),
    sku_snapshot = COALESCE(ri.sku_snapshot, pv.sku)
FROM produto_variacoes pv
WHERE pv.id = ri.variacao_id;

UPDATE remessa_itens
SET valor_total_original = COALESCE(NULLIF(valor_total_original, 0), COALESCE(quantidade_enviada, quantidade, 0) * COALESCE(preco_repasse_unitario, preco_repasse_snapshot, 0)),
    valor_total_estornado = COALESCE(NULLIF(valor_total_estornado, 0), COALESCE(quantidade_estornada, 0) * COALESCE(preco_repasse_unitario, preco_repasse_snapshot, 0)),
    valor_total_saldo = COALESCE(NULLIF(valor_total_saldo, 0), (COALESCE(quantidade_enviada, quantidade, 0) - COALESCE(quantidade_estornada, 0)) * COALESCE(preco_repasse_unitario, preco_repasse_snapshot, 0));

-- =========================================================
-- 4. ASSINATURA DIGITAL DA REMESSA
-- Assinatura eletrônica simples para controle interno.
-- =========================================================
CREATE TABLE IF NOT EXISTS remessa_assinaturas (
    id SERIAL PRIMARY KEY,
    remessa_id INTEGER REFERENCES remessas(id) ON DELETE CASCADE,
    parceiro_id INTEGER REFERENCES parceiros(id) ON DELETE SET NULL,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    nome_responsavel VARCHAR(160) NOT NULL,
    documento_responsavel VARCHAR(60),
    assinatura_base64 TEXT NOT NULL,
    ip_assinatura VARCHAR(80),
    user_agent TEXT,
    data_assinatura TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS remessa_id INTEGER REFERENCES remessas(id) ON DELETE CASCADE;
ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS parceiro_id INTEGER REFERENCES parceiros(id) ON DELETE SET NULL;
ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS nome_responsavel VARCHAR(160);
ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS documento_responsavel VARCHAR(60);
ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS assinatura_base64 TEXT;
ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS ip_assinatura VARCHAR(80);
ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE remessa_assinaturas ADD COLUMN IF NOT EXISTS data_assinatura TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- =========================================================
-- 5. FINANCEIRO V3 - FECHAMENTO DE REPASSES
-- Usa a tabela existente financeiro_repasses e adiciona metadados.
-- =========================================================
ALTER TABLE financeiro_repasses ADD COLUMN IF NOT EXISTS data_pagamento TIMESTAMP;
ALTER TABLE financeiro_repasses ADD COLUMN IF NOT EXISTS fechado_em TIMESTAMP;
ALTER TABLE financeiro_repasses ADD COLUMN IF NOT EXISTS usuario_fechamento_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE financeiro_repasses ADD COLUMN IF NOT EXISTS usuario_pagamento_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE financeiro_repasses ADD COLUMN IF NOT EXISTS observacao TEXT;
ALTER TABLE financeiro_repasses ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- =========================================================
-- 6. ÍNDICES
-- =========================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_remessas_codigo_unique ON remessas(codigo) WHERE codigo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_remessas_parceiro_id ON remessas(parceiro_id);
CREATE INDEX IF NOT EXISTS idx_remessas_usuario_id ON remessas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_remessas_status ON remessas(status);
CREATE INDEX IF NOT EXISTS idx_remessas_status_assinatura ON remessas(status_assinatura);
CREATE INDEX IF NOT EXISTS idx_remessas_data_envio ON remessas(data_envio);
CREATE INDEX IF NOT EXISTS idx_remessa_itens_remessa_id ON remessa_itens(remessa_id);
CREATE INDEX IF NOT EXISTS idx_remessa_itens_produto_id ON remessa_itens(produto_id);
CREATE INDEX IF NOT EXISTS idx_remessa_itens_variacao_id ON remessa_itens(variacao_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_remessa_id ON remessa_assinaturas(remessa_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_parceiro_id ON remessa_assinaturas(parceiro_id);
CREATE INDEX IF NOT EXISTS idx_financeiro_parceiro_mes ON financeiro_repasses(parceiro_id, mes_referencia);
CREATE INDEX IF NOT EXISTS idx_financeiro_status ON financeiro_repasses(status_pagamento);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_data_hora ON movimentacoes_estoque(data_hora);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_parceiro_id ON movimentacoes_estoque(parceiro_id);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_variacao_id ON movimentacoes_estoque(variacao_id);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_tipo ON movimentacoes_estoque(tipo);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_referencia ON movimentacoes_estoque(referencia_tipo, referencia_id);

COMMIT;

-- Conferência rápida após rodar:
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('movimentacoes_estoque','remessas','remessa_itens','remessa_assinaturas','financeiro_repasses') ORDER BY table_name;
