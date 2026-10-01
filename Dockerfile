FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY cardiotwin/ ./cardiotwin/
COPY scripts/ ./scripts/
COPY config/ ./config/
RUN pip install --no-cache-dir .
COPY --from=frontend /build/dist ./frontend/dist
RUN useradd --create-home appuser && mkdir -p data artifacts && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["python", "-m", "scripts.run_demo", "--host", "0.0.0.0"]
