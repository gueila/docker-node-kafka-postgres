const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');

const app = express();

// Configuración de PostgreSQL (misma BD)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'admin123',
  database: process.env.DB_NAME || 'myapp',
});

// Configuración de Kafka
const kafka = new Kafka({
  clientId: 'consumer-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const consumer = kafka.consumer({ groupId: 'message-processor-group' });

let messagesProcessed = 0;
let messagesErrors = 0;

// Inicializar Kafka Consumer
async function initKafka() {
  const maxRetries = 10;
  const retryDelay = 5000;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`🔄 Intentando conectar consumer a Kafka (${i + 1}/${maxRetries})...`);
      
      await consumer.connect();
      await consumer.subscribe({ topic: 'messages', fromBeginning: false });
      
      // Consumir mensajes
      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const data = JSON.parse(message.value.toString());
            console.log(`📨 Mensaje recibido de Kafka:`, data);
            
            // Guardar en tabla messages
            const result = await pool.query(
              'INSERT INTO messages (content, evento_id) VALUES ($1, $2) RETURNING id',
              [data.content, data.evento_id]
            );
            
            messagesProcessed++;
            console.log(`✅ Mensaje ${result.rows[0].id} guardado en PostgreSQL (evento_id: ${data.evento_id})`);
            
          } catch (err) {
            messagesErrors++;
            console.error('❌ Error procesando mensaje:', err);
          }
        },
      });
      
      console.log('✅ Consumer de Kafka conectado y escuchando mensajes...');
      return;
      
    } catch (err) {
      console.error(`❌ Error conectando consumer (${i + 1}):`, err.message);
      
      if (i < maxRetries - 1) {
        console.log(`⏳ Reintentando en ${retryDelay / 1000} segundos...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error('❌ No se pudo conectar consumer después de todos los intentos');
        throw err;
      }
    }
  }
}

// API simple para monitoreo
app.get('/', (req, res) => {
  res.json({ 
    message: '🎧 Consumer Service',
    role: 'Lee mensajes de Kafka y los guarda en la tabla messages',
    stats: {
      messages_processed: messagesProcessed,
      messages_errors: messagesErrors
    }
  });
});

app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    service: 'consumer-service',
    database: 'unknown',
    kafka_consumer: 'unknown',
    stats: {
      processed: messagesProcessed,
      errors: messagesErrors
    }
  };

  try {
    await pool.query('SELECT 1');
    health.database = 'connected';
  } catch (err) {
    health.database = 'disconnected';
    health.status = 'unhealthy';
  }

  health.kafka_consumer = 'connected';

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/stats', (req, res) => {
  res.json({
    messages_processed: messagesProcessed,
    messages_errors: messagesErrors,
    uptime: process.uptime()
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;

async function start() {
  await initKafka();
  
  app.listen(PORT, () => {
    console.log(`🎧 Consumer Service corriendo en http://localhost:${PORT}`);
    console.log(`📊 Esperando mensajes de Kafka...`);
  });
}

start().catch(console.error);

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
  console.log('🛑 Cerrando consumer...');
  await consumer.disconnect();
  await pool.end();
  process.exit(0);
});
