-- Phase 4.3 — Missing indexes for performance
-- Safe to run multiple times (IF NOT EXISTS)

CREATE INDEX IF NOT EXISTS idx_produto_imagens_produto_id
    ON produto_imagens(produto_id);

CREATE INDEX IF NOT EXISTS idx_consignacoes_estoque_parceiro_id
    ON consignacoes_estoque(parceiro_id);

CREATE INDEX IF NOT EXISTS idx_consignacoes_estoque_variacao_id
    ON consignacoes_estoque(variacao_id);

CREATE INDEX IF NOT EXISTS idx_remessa_itens_remessa_id
    ON remessa_itens(remessa_id);

CREATE INDEX IF NOT EXISTS idx_catalogo_pedidos_parceiro_status
    ON catalogo_pedidos(parceiro_id, status);

CREATE INDEX IF NOT EXISTS idx_vendas_parceiro_data
    ON vendas(parceiro_id, data_venda);

CREATE INDEX IF NOT EXISTS idx_financeiro_repasses_mes_parceiro
    ON financeiro_repasses(mes_referencia, parceiro_id);

CREATE INDEX IF NOT EXISTS idx_logs_auditoria_usuario
    ON logs_auditoria(usuario_id);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_produto
    ON movimentacoes_estoque(produto_id, variacao_id);

CREATE INDEX IF NOT EXISTS idx_usuarios_parceiro_id
    ON usuarios(parceiro_id);

COMMENT ON INDEX idx_produto_imagens_produto_id IS 'Acelera busca de galeria por produto';
COMMENT ON INDEX idx_consignacoes_estoque_parceiro_id IS 'Acelera estoque consignado por parceiro';
COMMENT ON INDEX idx_remessa_itens_remessa_id IS 'Acelera listagem de itens por remessa';
COMMENT ON INDEX idx_catalogo_pedidos_parceiro_status IS 'Acelera kanban de leads por parceiro';
COMMENT ON INDEX idx_vendas_parceiro_data IS 'Acelera relatórios financeiros e dashboard';
