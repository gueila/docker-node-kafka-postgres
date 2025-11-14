# Práctica Docker: Microservicios con Outbox Pattern

## 📋 Descripción

Esta práctica implementa el **Outbox Pattern** con microservicios:
- **Producer API (Node.js + Express)**: Recibe requests, guarda eventos en BD y envía a Kafka
- **Consumer Service**: Lee de Kafka y procesa los mensajes
- **PostgreSQL**: Base de datos compartida
- **Kafka**: Message broker para comunicación asíncrona

## 🏗️ Arquitectura

```
Cliente 
   ↓ POST /messages
Producer API
   ↓ 1. INSERT en tabla 'eventos' (estado: P)
   ↓ 2. Enviar a Kafka
   ↓    ├─ Éxito → UPDATE estado: E
   ↓    └─ Error → UPDATE estado: X (reintento automático)
   ↓
Kafka (topic: messages)
   ↓
Consumer Service
   ↓ Lee de Kafka
   ↓ INSERT en tabla 'messages'
PostgreSQL
```

### Estados de eventos:
- **P** = Pendiente (aún no enviado a Kafka)
- **E** = Enviado (exitoso a Kafka)
- **X** = Error (falló, se reintentará)

## 🚀 Instalación

### Estructura de archivos

```
proyecto/
├── docker-compose.yml
├── producer-api/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       └── index.js
└── consumer-service/
    ├── Dockerfile
    ├── package.json
    └── index.js
```

### Crear la estructura

```bash
# Crear directorios
mkdir -p docker-practice/producer-api/src
mkdir -p docker-practice/consumer-service
cd docker-practice

# Copiar docker-compose.yml en la raíz
# Copiar producer-api/src/index.js
# Copiar consumer-service/index.js
```

### Crear Dockerfiles

**producer-api/Dockerfile**:
```dockerfile
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

**consumer-service/Dockerfile** (igual):
```dockerfile
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### Crear package.json para ambos servicios

Usa el mismo `package.json` que ya te proporcioné.

### .dockerignore en ambas carpetas

```
node_modules
npm-debug.log
.git
.gitignore
README.md
.env
.DS_Store
```

### Ejecutar el proyecto

```bash
docker-compose up --build
```

## 🧪 Probar la aplicación

### 1. Verificar servicios
```bash
# Producer API
curl http://localhost:3000/health

# Consumer Service
curl http://localhost:3001/health
```

### 2. Enviar un mensaje
```bash
curl -X POST http://localhost:3000/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Mi primer evento"}'
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "evento_id": 1,
  "estado": "E",
  "message": "Evento creado y enviado a Kafka exitosamente"
}
```

**Si Kafka falla:**
```json
{
  "success": true,
  "evento_id": 1,
  "estado": "X",
  "message": "Evento creado pero falló el envío a Kafka. Se reintentará automáticamente."
}
```

### 3. Ver eventos con su estado
```bash
curl http://localhost:3000/eventos
```

Verás algo como:
```json
{
  "count": 3,
  "eventos": [
    {
      "id": 1,
      "content": "Mi primer evento",
      "estado": "Enviado",
      "intentos": 0,
      "created_at": "2025-01-15T10:30:00.000Z"
    },
    {
      "id": 2,
      "content": "Evento con error",
      "estado": "Error",
      "intentos": 3,
      "error_message": "Connection timeout",
      "created_at": "2025-01-15T10:31:00.000Z"
    }
  ]
}
```

### 4. Ver mensajes procesados
```bash
curl http://localhost:3000/messages
```

### 5. Ver estadísticas
```bash
# Producer API stats
curl http://localhost:3000/stats

# Consumer Service stats
curl http://localhost:3001/stats
```

## 🔍 Probar el sistema de reintentos

### Simular fallo de Kafka

```bash
# 1. Detener Kafka temporalmente
docker-compose stop kafka

# 2. Enviar un mensaje (se marcará como 'X')
curl -X POST http://localhost:3000/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Este fallará"}'

# 3. Ver que está en estado X
curl http://localhost:3000/eventos

# 4. Reiniciar Kafka
docker-compose start kafka

# 5. Esperar 10 segundos (reintento automático)
# 6. Ver que ahora está en estado E
curl http://localhost:3000/eventos
```

## 📊 Comandos útiles

### Ver logs
```bash
# Producer API
docker-compose logs -f producer-api

# Consumer Service
docker-compose logs -f consumer-service

# Kafka
docker-compose logs -f kafka
```

### Verificar BD
```bash
docker exec -it postgres_db psql -U admin -d myapp

# Ver eventos
SELECT id, content, procesado, intentos, created_at FROM eventos ORDER BY id DESC LIMIT 10;

# Ver mensajes procesados
SELECT m.id, m.content, m.evento_id, m.created_at 
FROM messages m 
ORDER BY m.id DESC LIMIT 10;

# Estadísticas
SELECT 
  procesado,
  COUNT(*) as cantidad,
  CASE 
    WHEN procesado = 'P' THEN 'Pendiente'
    WHEN procesado = 'E' THEN 'Enviado'
    WHEN procesado = 'X' THEN 'Error'
  END as descripcion
FROM eventos 
GROUP BY procesado;
```

### Verificar Kafka
```bash
# Ver mensajes en el topic
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic messages \
  --from-beginning

# Ver consumer groups
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --list

# Ver lag del consumer
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group message-processor-group \
  --describe
```

## 🎯 Ventajas del Outbox Pattern

### ✅ Ventajas:
1. **Garantía de entrega**: El evento se guarda en BD antes de enviarse
2. **Reintentos automáticos**: Si Kafka falla, se reintenta periódicamente
3. **Auditoría completa**: Sabes exactamente qué se envió y cuándo
4. **Resiliencia**: Si Kafka está caído, la API sigue funcionando
5. **Idempotencia**: Puedes reprocesar eventos sin duplicados
6. **Desacoplamiento**: Producer y Consumer son independientes

### ⚠️ Consideraciones:
1. Más complejidad que envío directo
2. Requiere job de limpieza de eventos antiguos
3. Necesita más espacio en BD

## 🔥 Escenarios de prueba

### Prueba 1: Flujo normal
```bash
# Enviar 5 mensajes
for i in {1..5}; do
  curl -X POST http://localhost:3000/messages \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"Mensaje $i\"}"
  sleep 1
done

# Verificar todos llegaron
curl http://localhost:3000/stats
curl http://localhost:3001/stats
```

### Prueba 2: Alta carga
```bash
# Enviar 100 mensajes simultáneos
for i in {1..100}; do
  curl -X POST http://localhost:3000/messages \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"Load test $i\"}" &
done

# Ver el LAG en Kafka
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group message-processor-group \
  --describe
```

### Prueba 3: Recuperación de fallos
```bash
# 1. Detener consumer
docker-compose stop consumer-service

# 2. Enviar mensajes
for i in {1..10}; do
  curl -X POST http://localhost:3000/messages \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"Queued message $i\"}"
done

# 3. Ver que están en Kafka pero no procesados
curl http://localhost:3000/messages  # Vacío o sin los últimos 10

# 4. Reiniciar consumer
docker-compose start consumer-service

# 5. Verificar que se procesaron todos
sleep 5
curl http://localhost:3000/messages
```

## 📚 Conceptos aplicados

- ✅ **Outbox Pattern**: Eventos en BD antes de Kafka
- ✅ **Event Sourcing**: Historial completo de eventos
- ✅ **Microservicios**: Producer y Consumer independientes
- ✅ **Idempotencia**: Reintentos seguros
- ✅ **Circuit Breaker**: Manejo de fallos de Kafka
- ✅ **At-least-once delivery**: Garantía de entrega

## 🎓 Ejercicios propuestos

1. Agregar un job que limpie eventos enviados hace más de 30 días
2. Implementar Dead Letter Queue para eventos que fallan 3+ veces
3. Agregar métricas con Prometheus
4. Crear un dashboard con Grafana
5. Implementar múltiples consumers para diferentes tipos de eventos
6. Agregar Redis para caché de eventos recientes
7. Implementar particionamiento de Kafka por tipo de evento

## 🐛 Troubleshooting

Ver la sección de troubleshooting del README anterior, más:

### Eventos quedan en estado X
```bash
# Ver eventos con error
curl http://localhost:3000/eventos | jq '.eventos[] | select(.estado == "Error")'

# Verificar logs del producer
docker-compose logs producer-api | grep "Error"

# Forzar reprocesamiento (reiniciar producer)
docker-compose restart producer-api
```

## 🔗 Referencias

- [Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Kafka Documentation](https://kafka.apache.org/documentation/)
- [Saga Pattern](https://microservices.io/patterns/data/saga.html)

```bash
docker-compose down -v
docker-compose up --build
```