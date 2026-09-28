FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /var/lib/tat/uploads && chown -R node:node /var/lib/tat
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
