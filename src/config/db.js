const { Pool } = require('pg');
require('dotenv').config();

// Agora ele vai puxar o link verde e seguro lá das configurações do Render (ou do seu .env local)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Obrigatório para a nuvem não barrar a conexão
    }
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Erro ao conectar no banco de dados:', err.stack);
    }
    console.log('✅ Banco de dados conectado com sucesso na Nuvem!');
    release();
});

module.exports = pool;