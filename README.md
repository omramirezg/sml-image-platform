# SmartMedia Labs — Plataforma de Procesamiento Inteligente de Imágenes

Plataforma serverless basada en eventos para carga, optimización y almacenamiento de imágenes, desplegada sobre AWS mediante Infrastructure as Code (CloudFormation).

> **Estado actual:** infraestructura base desplegada. Pendiente: funciones Lambda y conexión S3 trigger → Lambda de procesamiento.

---

## Arquitectura

```
Usuario
  │
  ▼
[S3 — sml-frontend]
  │  (sitio estático: http://sml-frontend.s3-website-us-east-1.amazonaws.com)
  │
  ▼
[API Gateway — sml-api]
  │  (https://bg7yhanxyg.execute-api.us-east-1.amazonaws.com/prod)
  │
  ├── POST /upload      ──► [Lambda — sml-generate-presigned-url]  ⚠️ PENDIENTE
  ├── GET  /history     ──► [Lambda — sml-get-history]             ⚠️ PENDIENTE
  └── GET  /status/{id} ──► [Lambda — sml-get-history]             ⚠️ PENDIENTE
         │                        │
         │                        └──► [DynamoDB — sml-image-metadata]  ✅
         │
         ▼
[S3 — sml-images-input]  ✅
  │  (acceso privado, CORS configurado)
  │
  │  (S3 Event Notification → trigger)  ⚠️ PENDIENTE (requiere Lambda)
  ▼
[Lambda — sml-process-image]  ⚠️ PENDIENTE
  │
  ├──► [S3 — sml-images-output]        ✅  (imagen optimizada, lectura pública)
  ├──► [DynamoDB — sml-image-metadata] ✅  (metadatos + estado)
  └──► [SNS — sml-image-notifications] ✅  (notificación URL procesada)
```

### Leyenda

| Símbolo | Significado |
|---|---|
| ✅ | Recurso desplegado y operativo |
| ⚠️ PENDIENTE | Recurso o integración por implementar |

---

## Recursos AWS

### Cuenta y región

| Campo | Valor |
|---|---|
| Account ID | `372123585270` |
| Región | `us-east-1` |

---

### S3 Buckets

| Bucket | ARN | Acceso | Estado |
|---|---|---|---|
| `sml-frontend` | `arn:aws:s3:::sml-frontend` | Lectura pública | ✅ |
| `sml-images-input` | `arn:aws:s3:::sml-images-input` | Privado + CORS | ✅ |
| `sml-images-output` | `arn:aws:s3:::sml-images-output` | Lectura pública (`s3:GetObject`) | ✅ |

**URL frontend:** `http://sml-frontend.s3-website-us-east-1.amazonaws.com`  
**URL patrón imagen procesada:** `https://sml-images-output.s3.us-east-1.amazonaws.com/{imageId}.jpg`

---

### DynamoDB

| Campo | Valor |
|---|---|
| Tabla | `sml-image-metadata` |
| ARN | `arn:aws:dynamodb:us-east-1:372123585270:table/sml-image-metadata` |
| Partition key | `imageId` (String) |
| Billing mode | `PAY_PER_REQUEST` |
| Deletion protection | Habilitada |
| Estado | ✅ |

**Esquema de item:**

```json
{
  "imageId":       "uuid-v4",
  "fileName":      "foto.jpg",
  "originalSize":  4523891,
  "processedSize": 845712,
  "status":        "PROCESSED",
  "outputUrl":     "https://sml-images-output.s3.us-east-1.amazonaws.com/uuid-v4.jpg",
  "createdAt":     "2026-05-10T15:30:00Z",
  "processedAt":   "2026-05-10T15:30:08Z"
}
```

**Estados válidos:** `PENDING` → `PROCESSING` → `PROCESSED` / `FAILED`

---

### SNS

| Campo | Valor |
|---|---|
| Topic | `sml-image-notifications` |
| ARN | `arn:aws:sns:us-east-1:372123585270:sml-image-notifications` |
| Tipo | Standard |
| Suscripción activa | `omaruzgonzalez@gmail.com` (EMAIL, confirmada) |
| Estado | ✅ |

---

### IAM Role (Lambdas)

| Campo | Valor |
|---|---|
| Role | `sml-lambda-execution-role` |
| ARN | `arn:aws:iam::372123585270:role/sml-lambda-execution-role` |
| Trusted entity | `lambda.amazonaws.com` |
| Estado | ✅ |

**Políticas adjuntas:**

| Política | Alcance |
|---|---|
| `AWSLambdaBasicExecutionRole` | Logs en CloudWatch |
| `AmazonS3FullAccess` | Buckets `sml-images-input` / `sml-images-output` |
| `AmazonDynamoDBFullAccess` | Tabla `sml-image-metadata` |
| `AmazonSNSFullAccess` | Topic `sml-image-notifications` |

---

### API Gateway

| Campo | Valor |
|---|---|
| Stack | `sml-api` |
| API ID | `bg7yhanxyg` |
| Stage | `prod` |
| URL base | `https://bg7yhanxyg.execute-api.us-east-1.amazonaws.com/prod` |
| Estado | ✅ (endpoints activos con integración MOCK — pendiente conectar Lambdas) |

**Endpoints:**

| Method | Path | Integración actual | Integración final |
|---|---|---|---|
| POST | `/upload` | MOCK | `sml-generate-presigned-url` ⚠️ |
| GET | `/history` | MOCK | `sml-get-history` ⚠️ |
| GET | `/status/{id}` | MOCK | `sml-get-history` ⚠️ |

CORS (OPTIONS preflight) habilitado en los tres endpoints.

---

### Lambda Functions

| Función | Runtime | Trigger | Estado |
|---|---|---|---|
| `sml-generate-presigned-url` | Node.js 18.x | API Gateway `POST /upload` | ⚠️ PENDIENTE |
| `sml-process-image` | Node.js 18.x | S3 event (`sml-images-input`) | ⚠️ PENDIENTE |
| `sml-get-history` | Node.js 18.x | API Gateway `GET /history`, `GET /status/{id}` | ⚠️ PENDIENTE |

---

## Estructura del repositorio

```
smartmedia-labs/
├── backend/
│   ├── infra/
│   │   └── api-gateway.yaml              # CloudFormation — API Gateway (stack sml-api) ✅
│   ├── sml-generate-presigned-url/
│   │   └── index.js                      # Lambda: genera presigned URL
│   ├── sml-process-image/
│   │   └── index.js                      # Lambda: comprime y optimiza imagen
│   └── sml-get-history/
│       └── index.js                      # Lambda: consulta DynamoDB
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── .github/
│   └── workflows/
│       └── deploy.yml                    # Pipeline CI/CD (GitHub Actions)
└── README.md
```

---

## Pipeline CI/CD

Definido en `.github/workflows/deploy.yml` usando **GitHub Actions**.  
Las credenciales de despliegue corresponden al usuario IAM `sml-cicd-user`.



### Secrets requeridos en GitHub

| Secret | Descripción |
|---|---|
| `AWS_ACCESS_KEY_ID` | Access key de `sml-cicd-user` |
| `AWS_SECRET_ACCESS_KEY` | Secret key de `sml-cicd-user` |

---

## Despliegue manual

### Actualizar stack API Gateway

```bash
aws cloudformation deploy \
  --template-file backend/infra/api-gateway.yaml \
  --stack-name sml-api \
  --region us-east-1
```

### Sincronizar frontend

```bash
aws s3 sync ./frontend/dist s3://sml-frontend/ --delete
```

### Configurar trigger S3 → Lambda (ejecutar una vez desplegada `sml-process-image`)

```bash
aws lambda add-permission \
  --function-name sml-process-image \
  --statement-id s3-trigger \
  --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn arn:aws:s3:::sml-images-input

aws s3api put-bucket-notification-configuration \
  --bucket sml-images-input \
  --notification-configuration file://s3-event.json
```

---

## Verificación de recursos

```bash
# Identidad activa
aws sts get-caller-identity

# Buckets
aws s3 ls | grep sml-

# DynamoDB
aws dynamodb describe-table \
  --table-name sml-image-metadata \
  --query "Table.{Status:TableStatus,ARN:TableArn}"

# SNS
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:372123585270:sml-image-notifications

# IAM Role
aws iam list-attached-role-policies --role-name sml-lambda-execution-role

# API Gateway
aws apigateway get-rest-api --rest-api-id bg7yhanxyg --region us-east-1
```

# Stack API Gateway
aws cloudformation delete-stack --stack-name sml-api
```
