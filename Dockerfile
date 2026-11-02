# Teknons platform (core + sector modules). No npm dependencies: Node's built-in SQLite.
# MODULES picks the product: accounting (Teknons Compta, default), shop (Teknons POS), hotel (Teknons Hôtel), restaurant (Teknons Resto) or school (Teknons École). All include Compta.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data MODULES=school
COPY . .
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health >/dev/null || exit 1
# SEED_DEMO=1 fills an empty database with the demo company of the chosen product (for test servers only)
CMD ["sh", "-c", "if [ \"$SEED_DEMO\" = \"1\" ]; then case \"$MODULES\" in *shop*) node --no-warnings scripts/seed-shop.mjs ;; *hotel*) node --no-warnings scripts/seed-hotel.mjs ;; *restaurant*) node --no-warnings scripts/seed-resto.mjs ;; *school*) node --no-warnings scripts/seed-school.mjs ;; *) node --no-warnings scripts/seed-demo.mjs ;; esac; fi; exec node --no-warnings server.mjs"]
