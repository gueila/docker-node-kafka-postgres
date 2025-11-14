const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');

const app = express();
app.use(express.json());

// Configuración de PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'admin123',
  database: process.env.DB_NAME || 'myapp',
});

// Configuración de Kafka
const kafka = new Kafka({
  clientId: 'api-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const producer = kafka.producer();

// Inicializar base de datos
async function initDB() {
  try {
    // Tabla de EVENTOS (Outbox Pattern)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS eventos (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        procesado CHAR(1) DEFAULT 'P' CHECK (procesado IN ('P', 'E', 'X')),
        intentos INT DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Tabla de MENSAJES (destino final)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Agregar columna evento_id si no existe (migración segura)
    await pool.query(`
      DO $ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='messages' AND column_name='evento_id'
        ) THEN
          ALTER TABLE messages ADD COLUMN evento_id INT REFERENCES eventos(id);
        END IF;
      END $;
    `);
    
    console.log('✅ Tablas creadas o ya existen');
    console.log('   - eventos: Almacena eventos antes de enviar a Kafka');
    console.log('   - messages: Almacena mensajes procesados por el consumer');
  } catch (err) {
    console.error('❌ Error creando tablas:', err);
  }
}

// Inicializar Kafka con reintentos
async function initKafka() {
  const maxRetries = 10;
  const retryDelay = 5000;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`🔄 Intentando conectar producer a Kafka (${i + 1}/${maxRetries})...`);
      await producer.connect();
      console.log('✅ Producer de Kafka conectado');
      return;
    } catch (err) {
      console.error(`❌ Error conectando producer (${i + 1}):`, err.message);
      
      if (i < maxRetries - 1) {
        console.log(`⏳ Reintentando en ${retryDelay / 1000} segundos...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error('❌ No se pudo conectar producer después de todos los intentos');
        throw err;
      }
    }
  }
}

// Procesador de eventos pendientes (reintenta enviar a Kafka)
async function processarEventosPendientes() {
  try {
    const result = await pool.query(`
      SELECT id, content 
      FROM eventos 
      WHERE procesado IN ('P', 'X') AND intentos < 3
      ORDER BY created_at ASC
      LIMIT 10
    `);

    for (const evento of result.rows) {
      try {
        await producer.send({
          topic: 'messages',
          messages: [{ 
            value: JSON.stringify({
              evento_id: evento.id,
              content: evento.content,
              timestamp: new Date().toISOString()
            })
          }],
        });

        await pool.query(`
          UPDATE eventos 
          SET procesado = 'E', 
              updated_at = CURRENT_TIMESTAMP,
              error_message = NULL
          WHERE id = $1
        `, [evento.id]);

        console.log(`✅ Evento ${evento.id} enviado a Kafka exitosamente`);
      } catch (err) {
        await pool.query(`
          UPDATE eventos 
          SET procesado = 'X', 
              intentos = intentos + 1,
              error_message = $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [err.message, evento.id]);

        console.error(`❌ Error enviando evento ${evento.id} a Kafka:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Error procesando eventos pendientes:', err);
  }
}

// Rutas de la API
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API de Eventos (Outbox Pattern)',
    architecture: 'Producer API → Eventos → Kafka → Consumer Service → Messages',
    endpoints: {
      'GET /eventos': 'Ver todos los eventos y su estado',
      'GET /messages': 'Ver mensajes procesados (desde consumer)',
      'POST /messages': 'Crear evento y enviar a Kafka (body: {content: "texto"})',
      'GET /stats': 'Estadísticas de eventos'
    }
  });
});

// Ver eventos con su estado
app.get('/eventos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        content,
        CASE 
          WHEN procesado = 'P' THEN 'Pendiente'
          WHEN procesado = 'E' THEN 'Enviado'
          WHEN procesado = 'X' THEN 'Error'
        END as estado,
        intentos,
        error_message,
        created_at,
        updated_at
      FROM eventos 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    
    res.json({ 
      count: result.rows.length,
      eventos: result.rows 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ver mensajes procesados
app.get('/messages', async (req, res) => {
  try {
    // Verificar si la columna evento_id existe
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='messages' AND column_name='evento_id'
    `);
    
    let result;
    if (columnCheck.rows.length > 0) {
      // Si existe evento_id, hacer join
      result = await pool.query(`
        SELECT 
          m.id,
          m.content,
          m.evento_id,
          m.created_at,
          e.procesado as evento_estado
        FROM messages m
        LEFT JOIN eventos e ON m.evento_id = e.id
        ORDER BY m.created_at DESC 
        LIMIT 100
      `);
    } else {
      // Si no existe, query simple
      result = await pool.query(`
        SELECT * FROM messages 
        ORDER BY created_at DESC 
        LIMIT 100
      `);
    }
    
    res.json({ 
      count: result.rows.length,
      messages: result.rows 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estadísticas
app.get('/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_eventos,
        COUNT(*) FILTER (WHERE procesado = 'P') as pendientes,
        COUNT(*) FILTER (WHERE procesado = 'E') as enviados,
        COUNT(*) FILTER (WHERE procesado = 'X') as errores,
        (SELECT COUNT(*) FROM messages) as mensajes_procesados
      FROM eventos
    `);
    
    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear evento y enviar a Kafka
app.post('/messages', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'El campo content es requerido' });
    }

    await client.query('BEGIN');

    // 1. Guardar en tabla de eventos (estado inicial: P = Pendiente)
    const eventoResult = await client.query(`
      INSERT INTO eventos (content, procesado) 
      VALUES ($1, 'P') 
      RETURNING id, content, procesado, created_at
    `, [content]);

    const evento = eventoResult.rows[0];
    console.log(`📝 Evento ${evento.id} creado en BD`);

    // 2. Intentar enviar a Kafka
    try {
      await producer.send({
        topic: 'messages',
        messages: [{ 
          value: JSON.stringify({
            evento_id: evento.id,
            content: content,
            timestamp: new Date().toISOString()
          })
        }],
      });

      // 3. Si se envía exitosamente, actualizar a 'E' (Enviado)
      await client.query(`
        UPDATE eventos 
        SET procesado = 'E', updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [evento.id]);

      await client.query('COMMIT');

      console.log(`✅ Evento ${evento.id} enviado a Kafka`);

      res.json({ 
        success: true,
        evento_id: evento.id,
        estado: 'E',
        message: 'Evento creado y enviado a Kafka exitosamente'
      });

    } catch (kafkaError) {
      // 4. Si falla Kafka, marcar como 'X' (Error)
      await client.query(`
        UPDATE eventos 
        SET procesado = 'X', 
            intentos = 1,
            error_message = $1,
            updated_at = CURRENT_TIMESTAMP 
        WHERE id = $2
      `, [kafkaError.message, evento.id]);

      await client.query('COMMIT');

      console.error(`❌ Error enviando evento ${evento.id} a Kafka:`, kafkaError.message);

      res.status(202).json({ 
        success: true,
        evento_id: evento.id,
        estado: 'X',
        message: 'Evento creado pero falló el envío a Kafka. Se reintentará automáticamente.',
        error: kafkaError.message
      });
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en transacción:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    service: 'producer-api',
    database: 'unknown',
    kafka_producer: 'unknown'
  };

  try {
    await pool.query('SELECT 1');
    health.database = 'connected';
  } catch (err) {
    health.database = 'disconnected';
    health.status = 'unhealthy';
  }

  try {
    health.kafka_producer = 'connected';
  } catch (err) {
    health.kafka_producer = 'disconnected';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;

async function start() {
  await initDB();
  await initKafka();
  
  // Procesar eventos pendientes cada 10 segundos
  setInterval(processarEventosPendientes, 10000);
  
  app.listen(PORT, () => {
    console.log(`🎯 Producer API corriendo en http://localhost:${PORT}`);
    console.log(`📊 Arquitectura: Outbox Pattern implementado`);
  });
}

start().catch(console.error);

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
  await producer.disconnect();
  await pool.end();
  process.exit(0);
});
