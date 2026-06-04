const STATUS_PARCEIRO = Object.freeze({
    ATIVO:    'ATIVO',
    PENDENTE: 'PENDENTE',
    INATIVO:  'INATIVO',
});

const STATUS_SOLICITACAO = Object.freeze({
    ABERTA:              'ABERTA',
    EM_ANALISE:          'EM_ANALISE',
    AGUARDANDO_ORCAMENTO:'AGUARDANDO_ORCAMENTO',
    AGUARDANDO_APROVACAO:'AGUARDANDO_APROVACAO',
    APROVADA:            'APROVADA',
    EM_PRODUCAO:         'EM_PRODUCAO',
    CONCLUIDA:           'CONCLUIDA',
    CANCELADA:           'CANCELADA',
    RECUSADA:            'RECUSADA',
});

const STATUS_ASSINATURA = Object.freeze({
    TESTE_GRATIS: 'TESTE_GRATIS',
    ATIVA:        'ATIVA',
    PENDENTE:     'PENDENTE',
    SUSPENSA:     'SUSPENSA',
    CANCELADA:    'CANCELADA',
});

const STATUS_PAGAMENTO = Object.freeze({
    PENDENTE:  'PENDENTE',
    PAGO:      'PAGO',
    CANCELADO: 'CANCELADO',
});

const STATUS_REMESSA = Object.freeze({
    ENVIADA:   'ENVIADA',
    ESTORNADA: 'ESTORNADA',
});

const STATUS_ASSINATURA_PEDIDO = Object.freeze({
    PENDENTE: 'PENDENTE',
    ASSINADA: 'ASSINADA',
});

const PERFIS = Object.freeze({
    ADMIN:    'ADMIN',
    PARCEIRO: 'PARCEIRO',
});

const STATUS_PRODUTO = Object.freeze({
    ATIVO:   'ATIVO',
    INATIVO: 'INATIVO',
});

const STATUS_LEAD = Object.freeze({
    NOVO:       'NOVO',
    EM_CONTATO: 'EM_CONTATO',
    NEGOCIANDO: 'NEGOCIANDO',
    FECHADO:    'FECHADO',
    PERDIDO:    'PERDIDO',
});

module.exports = {
    STATUS_PARCEIRO,
    STATUS_SOLICITACAO,
    STATUS_ASSINATURA,
    STATUS_PAGAMENTO,
    STATUS_REMESSA,
    STATUS_ASSINATURA_PEDIDO,
    PERFIS,
    STATUS_PRODUTO,
    STATUS_LEAD,
};
