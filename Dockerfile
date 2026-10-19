# ========================================================
# CDKeysPerú - Dockerfile para Bot de Pedidos
# Imagen optimizada y ultra ligera basada en Alpine Linux
# ========================================================

FROM node:20-alpine

# Instalar utilidades básicas y zona horaria
RUN apk add --no-cache tzdata curl wget
ENV TZ=America/Lima

# Definir directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production && npm cache clean --force

# Copiar código fuente
COPY src/ ./src/

# Crear directorio de persistencia para datos locales
RUN mkdir -p /app/data && chown -R node:node /app

# Usar usuario no root para seguridad
USER node

# Exponer puerto HTTP
EXPOSE 3005

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3005/health || exit 1

# Comando de inicio
CMD ["node", "src/index.js"]
