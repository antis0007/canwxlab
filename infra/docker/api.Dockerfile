FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY services/api/pyproject.toml /app/services/api/pyproject.toml
WORKDIR /app/services/api
RUN pip install --no-cache-dir -e .

WORKDIR /app
COPY services/api /app/services/api
COPY data/sample /app/data/sample

EXPOSE 8000
CMD ["uvicorn", "canwxlab_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
