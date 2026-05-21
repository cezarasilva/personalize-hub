const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL não configurada no .env');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erro ao conectar no banco de dados:', err.message);
        return;
    }
    console.log('✅ Banco de dados conectado com sucesso!');
    release();
});

pool.on('error', (err) => {
    console.error('❌ Erro inesperado no pool do banco:', err.message);
});

module.exports = pool;
