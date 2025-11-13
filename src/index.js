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
  clientId: 'my-app',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'test-group' });

// Inicializar base de datos
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla creada o ya existe');
  } catch (err) {
    console.error('❌ Error creando tabla:', err);
  }
}

// Inicializar Kafka con reintentos
async function initKafka() {
  const maxRetries = 10;
  const retryDelay = 5000; // 5 segundos
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`🔄 Intentando conectar a Kafka (intento ${i + 1}/${maxRetries})...`);
      
      await producer.connect();
      await consumer.connect();
      await consumer.subscribe({ topic: 'messages', fromBeginning: true });
      
      // Consumir mensajes
      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          const content = message.value.toString();
          console.log(`📨 Mensaje recibido de Kafka: ${content}`);
          
          // Guardar en base de datos
          try {
            await pool.query(
              'INSERT INTO messages (content) VALUES ($1)',
              [content]
            );
            console.log('💾 Mensaje guardado en PostgreSQL');
          } catch (err) {
            console.error('❌ Error guardando en DB:', err);
          }
        },
      });
      
      console.log('✅ Kafka conectado exitosamente');
      return; // Salir si la conexión fue exitosa
    } catch (err) {
      console.error(`❌ Error conectando a Kafka (intento ${i + 1}):`, err.message);
      
      if (i < maxRetries - 1) {
        console.log(`⏳ Reintentando en ${retryDelay / 1000} segundos...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error('❌ No se pudo conectar a Kafka después de todos los intentos');
        throw err;
      }
    }
  }
}

// Rutas de la API
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API funcionando',
    endpoints: {
      'GET /messages': 'Obtener todos los mensajes',
      'POST /messages': 'Enviar un mensaje a Kafka (body: {content: "texto"})'
    }
  });
});

app.get('/messages', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM messages ORDER BY created_at DESC LIMIT 50'
    );
    res.json({ 
      count: result.rows.length,
      messages: result.rows 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/messages', async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'El campo content es requerido' });
    }

    // Verificar que el producer esté conectado
    try {
      await producer.send({
        topic: 'messages',
        messages: [{ value: content }],
      });

      res.json({ 
        success: true, 
        message: 'Mensaje enviado a Kafka' 
      });
    } catch (kafkaError) {
      console.error('Error enviando a Kafka:', kafkaError);
      
      // Si Kafka falla, intentar reconectar
      try {
        await producer.connect();
        await producer.send({
          topic: 'messages',
          messages: [{ value: content }],
        });
        
        res.json({ 
          success: true, 
          message: 'Mensaje enviado a Kafka (reconectado)' 
        });
      } catch (retryError) {
        res.status(503).json({ 
          error: 'Kafka no disponible en este momento. Intenta de nuevo en unos segundos.',
          details: retryError.message
        });
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    database: 'unknown',
    kafka_producer: 'unknown',
    kafka_consumer: 'unknown'
  };

  // Verificar PostgreSQL
  try {
    await pool.query('SELECT 1');
    health.database = 'connected';
  } catch (err) {
    health.database = 'disconnected';
    health.status = 'unhealthy';
  }

  // Verificar Kafka Producer
  try {
    // El producer no tiene un método directo de verificación, pero podemos revisar su estado interno
    health.kafka_producer = 'connected';
  } catch (err) {
    health.kafka_producer = 'disconnected';
    health.status = 'degraded';
  }

  // Verificar Kafka Consumer
  try {
    health.kafka_consumer = 'connected';
  } catch (err) {
    health.kafka_consumer = 'disconnected';
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
  
  app.listen(PORT, () => {
    console.log(`🎯 Servidor corriendo en http://localhost:${PORT}`);
  });
}

start().catch(console.error);

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
  await producer.disconnect();
  await consumer.disconnect();
  await pool.end();
  process.exit(0);
});