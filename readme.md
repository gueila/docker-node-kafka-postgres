# Práctica Docker: Node.js + Express + Kafka + PostgreSQL

## 📋 Descripción

Esta práctica demuestra la integración de:
- **Node.js con Express**: API REST
- **PostgreSQL**: Base de datos relacional
- **Kafka**: Sistema de mensajería distribuida
- **Docker Compose**: Orquestación de contenedores

## 🏗️ Arquitectura

```
Cliente → Express API → Kafka → Consumer → PostgreSQL
```

1. El usuario envía un mensaje via POST a `/messages`
2. El mensaje se publica en Kafka (topic: "messages")
3. El consumer de Kafka procesa el mensaje
4. El mensaje se guarda en PostgreSQL
5. Se puede consultar via GET `/messages`

## 🚀 Instalación

### Estructura de archivos

```
proyecto/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── .dockerignore
└── src/
    └── index.js
```

### Crear archivo .dockerignore

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

1. **Clonar o crear la estructura de archivos**

2. **Iniciar todos los servicios:**
```bash
docker-compose up --build
```

3. **En modo detached (segundo plano):**
```bash
docker-compose up -d --build
```

## 🧪 Probar la aplicación

### 1. Verificar que todo está funcionando
```bash
curl http://localhost:3000/health
```

### 2. Ver la página principal
```bash
curl http://localhost:3000/
```

### 3. Enviar un mensaje (se enviará a Kafka)
```bash
curl -X POST http://localhost:3000/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hola desde Kafka!"}'
```

### 4. Obtener todos los mensajes (desde PostgreSQL)
```bash
curl http://localhost:3000/messages
```

## 📊 Comandos útiles

### Ver logs de todos los servicios
```bash
docker-compose logs -f
```

### Ver logs de un servicio específico
```bash
docker-compose logs -f app
docker-compose logs -f kafka
docker-compose logs -f postgres
```

### Detener los servicios
```bash
docker-compose down
```

### Detener y eliminar volúmenes
```bash
docker-compose down -v
```

### Reconstruir un servicio específico
```bash
docker-compose up -d --build app
```

## 🔍 Verificar servicios

### PostgreSQL
```bash
docker exec -it postgres_db psql -U admin -d myapp
```

Dentro de psql:
```sql
\dt                          -- Ver tablas
SELECT * FROM messages;      -- Ver mensajes
\q                           -- Salir
```

### Kafka
Ver los topics:
```bash
docker exec -it kafka kafka-topics --list --bootstrap-server localhost:9092
```

## 📝 Ejercicios propuestos

1. **Añadir un nuevo campo** a la tabla messages (ej: author, type)
2. **Crear un nuevo endpoint** GET `/messages/:id`
3. **Agregar validaciones** más robustas
4. **Implementar paginación** en GET `/messages`
5. **Crear otro topic de Kafka** para diferentes tipos de mensajes
6. **Añadir Redis** para caché
7. **Implementar autenticación** básica

## 🐛 Troubleshooting

### "The producer is disconnected"
Este error ocurre cuando Kafka aún no está listo. Soluciones:

1. **Espera 30-60 segundos** después de `docker-compose up` antes de enviar mensajes
2. **Verifica el estado de Kafka:**
```bash
docker-compose logs kafka | grep "started"
```

3. **Verifica el health check:**
```bash
curl http://localhost:3000/health
```

4. **Si persiste, reinicia solo la app:**
```bash
docker-compose restart app
```

### Kafka no conecta
Espera 30-60 segundos después de `docker-compose up`. Kafka tarda en inicializarse. El código ahora reintenta automáticamente 10 veces con intervalos de 5 segundos.

### Error de conexión a PostgreSQL
Verifica que el contenedor esté corriendo:
```bash
docker ps | grep postgres
```

### Puerto 3000 ya en uso
Cambia el puerto en docker-compose.yml:
```yaml
ports:
  - "3001:3000"  # Usa 3001 en lugar de 3000
```

## 📚 Tecnologías

- **Node.js**: v18
- **Express**: v4.18
- **PostgreSQL**: v15
- **Kafka**: v7.5 (Confluent)
- **Docker**: v3.8

## 🎯 Conceptos aprendidos

- ✅ Orquestación de múltiples contenedores
- ✅ Comunicación entre servicios
- ✅ Uso de volúmenes para persistencia
- ✅ Redes de Docker
- ✅ Variables de entorno
- ✅ Sistema de mensajería asíncrona
- ✅ Integración de base de datos

## 🔗 Referencias

- [Docker Compose](https://docs.docker.com/compose/)
- [KafkaJS](https://kafka.js.org/)
- [node-postgres](https://node-postgres.com/)
- [Express](https://expressjs.com/)