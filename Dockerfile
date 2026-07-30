# ---- Frontend build stage ----
FROM node:20-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# ---- Backend runtime ----
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=frontend-build /app/dist ./dist

RUN cd backend && python manage.py collectstatic --noinput

EXPOSE 8000
CMD bash -c "cd backend && python manage.py migrate && python manage.py seed_demo && gunicorn config.wsgi --bind 0.0.0.0:${PORT:-8000}"
