FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

RUN pip3 install --no-cache-dir -r requirements.txt

EXPOSE 8000

# Bind to 0.0.0.0 as required by the problem statement
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]