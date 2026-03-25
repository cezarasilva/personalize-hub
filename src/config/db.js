const { Pool } = require('pg');

// Colocando o link direto com a sua senha real para testar
const linkDireto = "postgresql://postgres:paWIMBVHTtmk0KAX@db.xdopczsuuawbxrfryaes.supabase.co:5432/postgres";

const pool = new Pool({
    connectionString: linkDireto
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Erro ao conectar no banco de dados:', err.stack);
    }
    console.log('✅ Banco de dados conectado com sucesso, Rogério!');
    release();
});

module.exports = pool;