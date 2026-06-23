// Seed único: insumos (pré-cadastro) + produto "Livrinho de Colorir"
// (variações 10x15 e 20x14) com receita e tabela de preço por quantidade.
// Uso: node scripts/seed-livrinho-colorir.js
const pool = require('../src/config/db');

const round2 = (v) => Math.round(v * 100) / 100;

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ---- 1) Insumos (pré-cadastro: ainda não comprados) ----
        const papelFoto = await client.query(
            `INSERT INTO insumos (nome, unidade, custo_unitario, estoque_atual, estoque_minimo, status, observacao)
             VALUES ($1,$2,$3,0,0,'PRE_CADASTRO',$4) RETURNING id, custo_unitario`,
            ['Papel Fotográfico Glossy A4 120g Masterprint', 'folha', round2(28.90 / 100),
             'Pacote 100 folhas — R$ 28,90 (Masterprint)']
        );
        const papelSulfite = await client.query(
            `INSERT INTO insumos (nome, unidade, custo_unitario, estoque_atual, estoque_minimo, status, observacao)
             VALUES ($1,$2,$3,0,0,'PRE_CADASTRO',$4) RETURNING id, custo_unitario`,
            ['Papel Sulfite A4 Chamex 75g', 'folha', round2(38.61 / 500),
             'Pacote 500 folhas — R$ 38,61 (Chamex)']
        );
        const custoFoto = Number(papelFoto.rows[0].custo_unitario);
        const custoSulfite = Number(papelSulfite.rows[0].custo_unitario);
        const idFoto = papelFoto.rows[0].id;
        const idSulfite = papelSulfite.rows[0].id;

        // ---- 2) Produto ----
        const produto = await client.query(
            `INSERT INTO produtos (nome, categoria, descricao, status, tipo_oferta, status_fluxo, destino_final)
             VALUES ($1,$2,$3,'ATIVO','SOB_ENCOMENDA','ATIVO','ENTREGA') RETURNING id`,
            ['Livrinho de Colorir', 'Papelaria', 'Livrinho de colorir personalizado — capa em papel fotográfico e miolo em sulfite, impressão colorida.']
        );
        const produtoId = produto.rows[0].id;

        // ---- 3) Variações + receita + tabela de preço por quantidade ----
        // Receita (por unidade do livro):
        //  - 10x15: 1 folha fotográfica rende 2 capas -> 0,5 folha/capa. Produção mínima: 2 un.
        //  - 20x14: 1 folha fotográfica = 1 capa inteira. Produção mínima: 1 un.
        //  - Ambos: 3 folhas de sulfite no miolo (impresso aberto, dobrando vira 6 páginas internas).
        const variacoesDef = [
            {
                sku: 'LIV-COLOR-10X15', variacao: '10x15', qtdMinima: 2,
                qtdCapa: 0.5,
                precosQtd: [
                    [2, 4.00], [3, 5.90], [4, 7.80], [5, 9.50], [6, 11.20], [7, 12.80],
                    [8, 14.30], [9, 15.70], [10, 16.90], [20, 24.90], [30, 36.90],
                    [40, 48.90], [50, 59.90], [60, 72.90]
                ]
            },
            {
                sku: 'LIV-COLOR-20X14', variacao: '20x14', qtdMinima: 1,
                qtdCapa: 1,
                precosQtd: [
                    [1, 3.50], [2, 6.50], [3, 9.00], [4, 11.50], [5, 13.50], [6, 15.20],
                    [7, 16.70], [8, 18.00], [9, 19.00], [10, 19.90], [20, 29.90], [30, 42.90],
                    [40, 54.90], [50, 67.90], [60, 79.90]
                ]
            }
        ];

        const resultado = [];

        for (const def of variacoesDef) {
            const custoMaterial = round2(def.qtdCapa * custoFoto + 3 * custoSulfite);
            const custoUnitario = custoMaterial; // sem máquina/mão de obra ainda — qtd_produzida=1
            const precoVendaBase = round2(def.precosQtd[0][1] / def.precosQtd[0][0]); // /un da menor faixa

            const v = await client.query(
                `INSERT INTO produto_variacoes
                    (produto_id, sku, variacao, preco_venda, preco_repasse, custo_producao, estoque_central, qtd_minima)
                 VALUES ($1,$2,$3,$4,0,$5,0,$6) RETURNING id`,
                [produtoId, def.sku, def.variacao, precoVendaBase, custoUnitario, def.qtdMinima]
            );
            const variacaoId = v.rows[0].id;

            const itensPrecificacao = {
                materiais: [
                    { insumo_id: idFoto, nome: 'Papel Fotográfico Glossy A4 120g', quantidade: def.qtdCapa, unidade: 'folha', custo_unitario: custoFoto },
                    { insumo_id: idSulfite, nome: 'Papel Sulfite A4 Chamex 75g', quantidade: 3, unidade: 'folha', custo_unitario: custoSulfite }
                ],
                maquinas: [],
                mao_obra: []
            };

            await client.query(
                `INSERT INTO precificacoes (
                    produto_id, variacao_id, tipo_precificacao, canal_venda,
                    quantidade_produzida, unidade_precificacao,
                    custo_material, custo_maquina, custo_mao_obra,
                    custo_total, custo_total_producao, custo_unitario,
                    margem_percentual, taxa_canal_percentual, taxa_canal_fixa,
                    preco_sugerido, preco_sugerido_unitario, preco_venda_final, preco_final_unitario,
                    perdas_tipo, itens_precificacao_json
                 ) VALUES (
                    $1,$2,'UNIVERSAL','Venda direta',
                    1,'UNIDADE',
                    $3,0,0,
                    $3,$3,$4,
                    0,0,0,
                    $4,$4,$5,$5,
                    'VALOR',$6
                 )`,
                [produtoId, variacaoId, custoMaterial, custoUnitario, precoVendaBase, JSON.stringify(itensPrecificacao)]
            );

            for (const [quantidade, totalFaixa] of def.precosQtd) {
                const precoUnitario = round2(totalFaixa / quantidade);
                await client.query(
                    `INSERT INTO produto_variacao_precos_qtd (variacao_id, quantidade, preco_unitario) VALUES ($1,$2,$3)
                     ON CONFLICT (variacao_id, quantidade) DO UPDATE SET preco_unitario = EXCLUDED.preco_unitario`,
                    [variacaoId, quantidade, precoUnitario]
                );
            }

            resultado.push({ variacaoId, ...def, custoMaterial, custoUnitario, precoVendaBase });
        }

        await client.query('COMMIT');

        console.log('✅ Seed concluído.\n');
        console.log(`Insumo "Papel Fotográfico" id=${idFoto} custo/folha=R$ ${custoFoto.toFixed(4)}`);
        console.log(`Insumo "Papel Sulfite" id=${idSulfite} custo/folha=R$ ${custoSulfite.toFixed(4)}`);
        console.log(`Produto "Livrinho de Colorir" id=${produtoId}\n`);
        resultado.forEach(r => {
            console.log(`Variação ${r.variacao} (id=${r.variacaoId}, sku=${r.sku}, qtd_minima=${r.qtdMinima})`);
            console.log(`  custo material/un: R$ ${r.custoMaterial.toFixed(4)} | preco_venda base: R$ ${r.precoVendaBase.toFixed(2)}`);
            console.log(`  faixas cadastradas: ${r.precosQtd.length}`);
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Erro no seed:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
