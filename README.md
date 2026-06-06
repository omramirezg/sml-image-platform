# SmartMedia Labs — Image Processing Platform

Plataforma serverless orientada a eventos para carga, optimización automática y almacenamiento de imágenes, desplegada sobre AWS con Infrastructure as Code.

**Demo en vivo:** [http://sml-frontend.s3-website-us-east-1.amazonaws.com](http://sml-frontend.s3-website-us-east-1.amazonaws.com)

---

## Cómo funciona

```
Usuario
  │
  ▼
CloudFront  ──(1a)──►  S3 sml-frontend       (sitio estático, origen privado)
  │
  └──(1b)──►  API Gateway  ──►  Lambda sml-generate-presigned-url
                                      │
                                      ├──► DynamoDB  (registro PENDING)
                                      └──► devuelve { uploadUrl, imageId, key }
                                                    │
                                                    ▼
                                       S3 sml-images-input  (PUT directo desde el navegador)
                                                    │
                                              ObjectCreated
                                              (jpg/jpeg/png/webp)
                                                    │
                                                    ▼
                                       Lambda sml-process-image
                                                    │
                                       ┌────────────┼────────────┐
                                       ▼            ▼            ▼
                                 S3 output      DynamoDB        SNS
                              (imagen .jpg   (estado →      (notificación
                              optimizada)    COMPLETED)      por email)
```

El frontend sondea `sml-images-output` cada 2 s hasta confirmar el archivo (máx. 120 s / 60 intentos).

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML · CSS · JavaScript (vanilla) |
| CDN | Amazon CloudFront |
| API | Amazon API Gateway (REST) |
| Cómputo | AWS Lambda · Node.js 18 |
| Procesamiento de imagen | Sharp (mozJPEG, calidad 70) |
| Almacenamiento | Amazon S3 (3 buckets) |
| Base de datos | Amazon DynamoDB |
| Notificaciones | Amazon SNS |
| IaC | AWS CloudFormation |
| CI/CD | GitHub Actions |

---

## Recursos AWS

**Cuenta:** `372123585270` · **Región:** `us-east-1`

### S3

| Bucket | Acceso | Propósito |
|---|---|---|
| `sml-frontend` | Privado (solo CloudFront) | Archivos estáticos del frontend |
| `sml-images-input` | Privado · URL pre-firmada | Imágenes originales subidas por el usuario |
| `sml-images-output` | Lectura pública | Imágenes optimizadas (siempre `.jpg`) |

### Lambda

| Función | Trigger | Memoria | Timeout | Descripción |
|---|---|---|---|---|
| `sml-generate-presigned-url` | `POST /upload` | 256 MB | 15 s | Genera URL pre-firmada de S3 (5 min) y registra metadata en DynamoDB |
| `sml-process-image` | S3 `ObjectCreated` en `sml-images-input` | 512 MB | 60 s | Comprime la imagen con Sharp, actualiza DynamoDB y publica a SNS |

> `sml-process-image` acepta jpg, jpeg, png y webp como entrada. La salida siempre es JPEG (los formatos con transparencia la pierden).

### API Gateway

URL base: `https://bg7yhanxyg.execute-api.us-east-1.amazonaws.com/prod`

| Método | Ruta | Estado |
|---|---|---|
| POST | `/upload` | Integrado con Lambda `sml-generate-presigned-url` |
| GET | `/history` | MOCK — pendiente de implementación |
| GET | `/status/{id}` | MOCK — pendiente de implementación |

### Otros recursos

| Recurso | Identificador |
|---|---|
| DynamoDB | `sml-image-metadata` (PK: `imageId`) |
| SNS | `sml-image-notifications` |
| IAM Role | `sml-lambda-execution-role` |
| CloudFormation stack | `sml-api` |

---

## Estructura del repositorio

```
sml-image-platform/
├── backend/
│   ├── infra/
│   │   ├── api-gateway.yaml        # CloudFormation — API Gateway
│   │   └── setup.md                # Referencia de infraestructura AWS
│   └── lambdas/
│       ├── generatePresignedUrl/   # Lambda: URL pre-firmada + DynamoDB
│       └── processImage/           # Lambda: compresión Sharp + DynamoDB + SNS
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── config.js                   # API_URL, OUTPUT_BUCKET_URL, DEMO_MODE
│   └── styles.css
├── .github/
│   └── workflows/
│       └── deploy.yml              # Pipeline CI/CD
└── README.md
```

---

## CI/CD

El pipeline de GitHub Actions (`deploy.yml`) se dispara en cada push a `main` (excepto cambios en documentación) y en deploys manuales.

**Orden de ejecución:**

```
deploy-lambdas ──► deploy-infra         ──► deploy-frontend
                   configure-s3-trigger
                   (ambos en paralelo)
```

| Job | Descripción |
|---|---|
| `deploy-lambdas` | Empaqueta y despliega ambas Lambdas (estrategia de matriz) |
| `deploy-infra` | Despliega el stack CloudFormation y fuerza redespliegue del stage `prod` |
| `configure-s3-trigger` | Configura la notificación S3 → Lambda con filtros por prefijo y sufijo (idempotente) |
| `deploy-frontend` | Lee `API_URL` del stack CloudFormation, la inyecta en `config.js` via `sed` y sincroniza a S3 |

**Secrets requeridos en GitHub:**

| Secret | Descripción |
|---|---|
| `AWS_ACCESS_KEY_ID` | Access key del usuario IAM `sml-cicd-user` |
| `AWS_SECRET_ACCESS_KEY` | Secret key del usuario IAM `sml-cicd-user` |

---

## Despliegue manual

```bash
# Stack CloudFormation (API Gateway)
aws cloudformation deploy \
  --template-file backend/infra/api-gateway.yaml \
  --stack-name sml-api \
  --region us-east-1

# Forzar redespliegue del stage prod (CloudFormation no lo hace automáticamente)
aws apigateway create-deployment \
  --rest-api-id bg7yhanxyg \
  --stage-name prod \
  --region us-east-1

# Lambda (ejecutar dentro del directorio de la función)
npm ci --omit=dev
zip -r function.zip . --exclude "*.test.js" "*.spec.js" ".env*" "coverage/*"
aws lambda update-function-code --function-name <nombre> --zip-file fileb://function.zip

# Frontend
aws s3 sync frontend/ s3://sml-frontend/ --delete
```

---

## Esquema DynamoDB

Tabla: `sml-image-metadata` · PK: `imageId` (String) · Billing: PAY_PER_REQUEST

```json
{
  "imageId":       "uuid-v4",
  "fileName":      "foto.jpg",
  "originalSize":  4523891,
  "processedSize": 845712,
  "status":        "COMPLETED",
  "outputUrl":     "https://sml-images-output.s3.us-east-1.amazonaws.com/uuid-v4.jpg",
  "createdAt":     "2026-05-10T15:30:00Z",
  "processedAt":   "2026-05-10T15:30:08Z"
}
```

**Estados:** `PENDING` → `COMPLETED` / `FAILED`

> En caso de error, `sml-process-image` escribe `status: "FAILED"` junto al campo `error` con el mensaje de la excepción.

---

## Cleanup

```bash
# S3
for bucket in sml-images-input sml-images-output sml-frontend; do
  aws s3 rm s3://$bucket --recursive
  aws s3api delete-bucket --bucket $bucket
done

# DynamoDB (desactivar protección antes de eliminar)
aws dynamodb update-table --table-name sml-image-metadata --no-deletion-protection-enabled
aws dynamodb delete-table --table-name sml-image-metadata

# SNS
aws sns delete-topic --topic-arn arn:aws:sns:us-east-1:372123585270:sml-image-notifications

# IAM Role
for policy in AWSLambdaBasicExecutionRole AmazonS3FullAccess AmazonDynamoDBFullAccess AmazonSNSFullAccess; do
  aws iam detach-role-policy --role-name sml-lambda-execution-role \
    --policy-arn arn:aws:iam::aws:policy/$policy
done
aws iam delete-role --role-name sml-lambda-execution-role

# CloudFormation
aws cloudformation delete-stack --stack-name sml-api
```
