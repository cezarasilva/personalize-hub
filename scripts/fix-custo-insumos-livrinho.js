// Correção: o seed anterior arredondou custo_unitario dos insumos para 2
// casas decimais (a coluna suporta 4). Corrige os insumos e recalcula o
// custo de receita das variações do Livrinho de Colorir.
const pool = require('../src/config/db');

const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const custoFoto = round4(28.90 / 100);     // 0.289
        const custoSulfite = round4(38.61 / 500);  // 0.07722

        await client.query(`UPDATE insumos SET custo_unitario = $1 WHERE nome = 'Papel Fotográfico Glossy A4 120g Masterprint'`, [custoFoto]);
        await client.query(`UPDATE insumos SET custo_unitario = $1 WHERE nome = 'Papel Sulfite A4 Chamex 75g'`, [custoSulfite]);

        const variacoes = await client.query(
            `SELECT id, variacao FROM produto_variacoes WHERE sku IN ('LIV-COLOR-10X15','LIV-COLOR-20X14')`
        );

        for (const v of variacoes.rows) {
            const qtdCapa = v.variacao === '10x15' ? 0.5 : 1;
            const custoMaterial = round2(qtdCapa * custoFoto + 3 * custoSulfite);

            await client.query(`UPDATE produto_variacoes SET custo_producao = $1 WHERE id = $2`, [custoMaterial, v.id]);
            await client.query(
                `UPDATE precificacoes
                 SET custo_material = $1, custo_total = $1, custo_total_producao = $1, custo_unitario = $1,
                     preco_sugerido = $1, preco_sugerido_unitario = $1, preco_venda_final = $1, preco_final_unitario = $1,
                     itens_precificacao_json = jsonb_set(
                         jsonb_set(itens_precificacao_json::jsonb, '{materiais,0,custo_unitario}', to_jsonb($2::numeric)),
                         '{materiais,1,custo_unitario}', to_jsonb($3::numeric)
                     )::text
                 WHERE variacao_id = $4`,
                [custoMaterial, custoFoto, custoSulfite, v.id]
            );
            console.log(`Variação ${v.variacao} (id=${v.id}) -> custo corrigido: R$ ${custoMaterial.toFixed(4)}`);
        }

        await client.query('COMMIT');
        console.log(`\n✅ Corrigido. custoFoto=R$ ${custoFoto} custoSulfite=R$ ${custoSulfite}`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Erro:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
