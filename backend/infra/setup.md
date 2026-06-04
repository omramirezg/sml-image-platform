# Infraestructura AWS — SmartMedia Labs

Documento de referencia de los recursos AWS desplegados para el proyecto.

---

## 1. Cuenta AWS

| Campo | Valor |
|---|---|
| Account ID | `372123585270` |
| Región | `us-east-1` (N. Virginia) |

Todos los recursos del proyecto se despliegan en `us-east-1`.

---

## 2. IAM Users

| Username | ARN | Permisos | Uso |
|---|---|---|---|
| `sml-omar-dev` | `arn:aws:iam::372123585270:user/sml-omar-dev` | `AdministratorAccess` | Infraestructura |
| `sml-juanpablo-dev` | `arn:aws:iam::372123585270:user/sml-juanpablo-dev` | `AdministratorAccess` | Backend |
| `sml-santiago-dev` | `arn:aws:iam::372123585270:user/sml-santiago-dev` | `AmazonS3FullAccess` | Frontend |
| `sml-cicd-user` | `arn:aws:iam::372123585270:user/sml-cicd-user` | `AdministratorAccess` | GitHub Actions |

```bash
aws configure
# AWS Access Key ID:     <key id entregado por separado>
# AWS Secret Access Key: <secret entregado por separado>
# Default region:        us-east-1
# Default output:        json

aws sts get-caller-identity
```

---

## 3. Buckets S3

### 3.1 sml-images-input

| Campo | Valor |
|---|---|
| Bucket | `sml-images-input` |
| ARN | `arn:aws:s3:::sml-images-input` |
| Acceso público | Bloqueado |
| Versionado | Deshabilitado |
| CORS | Configurado (PUT/POST/GET) |

Flujo: el frontend solicita una presigned URL → realiza `PUT` directo al bucket con la clave `uploads/{imageId}-{fileName}` → el upload dispara la Lambda `sml-process-image`.

CORS:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST", "GET"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

> `AllowedOrigins: ["*"]` debe restringirse al dominio CloudFront en ambientes productivos.

---

### 3.2 sml-images-output

| Campo | Valor |
|---|---|
| Bucket | `sml-images-output` |
| ARN | `arn:aws:s3:::sml-images-output` |
| Acceso público | Lectura (`s3:GetObject`) |
| URL patrón | `https://sml-images-output.s3.us-east-1.amazonaws.com/{imageId}.jpg` |

La Lambda `sml-process-image` escribe aquí las imágenes optimizadas en formato JPEG (siempre `.jpg`, independiente del formato de entrada). La URL pública se persiste en DynamoDB y se publica al topic SNS.

Bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublicReadOfProcessedImages",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::sml-images-output/*"
    }
  ]
}
```

---

### 3.3 sml-frontend

| Campo | Valor |
|---|---|
| Bucket | `sml-frontend` |
| ARN | `arn:aws:s3:::sml-frontend` |
| Acceso público | Bloqueado (origen privado de CloudFront) |
| Static website hosting | Deshabilitado |

El bucket es el **origen** de la distribución CloudFront. Los usuarios acceden al sitio únicamente a través de CloudFront, no directamente al bucket.

Comando de sync (CI/CD):

```bash
aws s3 sync frontend/ s3://sml-frontend/ --delete
```

---

## 4. DynamoDB

### Tabla `sml-image-metadata`

| Campo | Valor |
|---|---|
| ARN | `arn:aws:dynamodb:us-east-1:372123585270:table/sml-image-metadata` |
| Partition key | `imageId` (String) |
| Billing mode | `PAY_PER_REQUEST` |
| Deletion protection | Habilitada |

Esquema de item:

```json
{
  "imageId":       "uuid-v4-string",
  "fileName":      "foto.jpg",
  "originalSize":  4523891,
  "processedSize": 845712,
  "status":        "COMPLETED",
  "outputUrl":     "https://sml-images-output.s3.us-east-1.amazonaws.com/uuid-v4.jpg",
  "createdAt":     "2026-05-10T15:30:00Z",
  "processedAt":   "2026-05-10T15:30:08Z"
}
```

Estados válidos: `PENDING` → `COMPLETED` / `FAILED`

> En caso de error durante el procesamiento, la Lambda escribe `status: "FAILED"` junto al campo `error` con el mensaje de la excepción. No existe un estado intermedio `PROCESSING`.

---

## 5. SNS

### Topic `sml-image-notifications`

| Campo | Valor |
|---|---|
| ARN | `arn:aws:sns:us-east-1:372123585270:sml-image-notifications` |
| Tipo | Standard |

Suscripciones activas:

| Protocol | Endpoint | Status |
|---|---|---|
| EMAIL | `omaruzgonzalez@gmail.com` | Confirmed |

El mensaje publicado por `sml-process-image` incluye: `imageId`, `outputUrl`, `originalSize`, `processedSize` y `compressionRatio%`.

---

## 6. IAM Role para Lambdas

### Role `sml-lambda-execution-role`

| Campo | Valor |
|---|---|
| ARN | `arn:aws:iam::372123585270:role/sml-lambda-execution-role` |
| Trusted entity | `lambda.amazonaws.com` |

Políticas adjuntas:

| Policy | Propósito |
|---|---|
| `AWSLambdaBasicExecutionRole` | Logs en CloudWatch |
| `AmazonS3FullAccess` | Acceso a `sml-images-input` y `sml-images-output` |
| `AmazonDynamoDBFullAccess` | Operaciones sobre `sml-image-metadata` |
| `AmazonSNSFullAccess` | Publicación al topic `sml-image-notifications` |

---

## 7. API Gateway

| Campo | Valor |
|---|---|
| API ID | `bg7yhanxyg` |
| Stack CloudFormation | `sml-api` |
| Stage | `prod` |
| URL base | `https://bg7yhanxyg.execute-api.us-east-1.amazonaws.com/prod` |

Endpoints:

| Method | Path | Integración |
|---|---|---|
| POST | `/upload` | Lambda `sml-generate-presigned-url` (AWS_PROXY) |
| GET | `/history` | MOCK (pendiente de implementación) |
| GET | `/status/{id}` | MOCK (pendiente de implementación) |
| OPTIONS | `*` | MOCK (preflight CORS) |

> CloudFormation **no** redesplega el stage automáticamente al actualizar integraciones. Siempre ejecutar `aws apigateway create-deployment` después de cambios en el template.

Para redesplegar después de cambios:

```bash
aws cloudformation deploy \
  --template-file backend/infra/api-gateway.yaml \
  --stack-name sml-api \
  --region us-east-1

# Forzar actualización del stage prod
aws apigateway create-deployment \
  --rest-api-id bg7yhanxyg \
  --stage-name prod \
  --region us-east-1
```

---

## 8. Lambda Functions

| Función | Runtime | Memoria | Timeout | Trigger | Directorio |
|---|---|---|---|---|---|
| `sml-generate-presigned-url` | Node.js 18.x | 256 MB | 15 s | API Gateway `POST /upload` | `backend/lambdas/generatePresignedUrl/` |
| `sml-process-image` | Node.js 18.x | 512 MB | 60 s | S3 `ObjectCreated` en `sml-images-input` | `backend/lambdas/processImage/` |

El trigger S3 de `sml-process-image` usa prefijo `uploads/` con filtros de sufijo separados para `jpg`, `jpeg`, `png` y `webp`.

> El ARN del topic SNS y el nombre del bucket de salida están **hard-codeados** en `processImage/index.js`. Actualizar el fuente si los nombres de los recursos cambian.

---

## 9. Comandos de verificación

```bash
# Identidad
aws sts get-caller-identity

# S3
aws s3 ls | grep sml-

# DynamoDB
aws dynamodb describe-table --table-name sml-image-metadata \
  --query "Table.{Status:TableStatus,ARN:TableArn}"

# SNS
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:372123585270:sml-image-notifications

# IAM Role
aws iam list-attached-role-policies --role-name sml-lambda-execution-role

# API Gateway
aws apigateway get-rest-api --rest-api-id bg7yhanxyg --region us-east-1

# Lambdas
aws lambda list-functions --query "Functions[?starts_with(FunctionName,'sml-')].FunctionName"
```

---

## 10. Alertas de costos

| Recurso | Función |
|---|---|
| AWS Budget `sml-project-budget` | Notifica al 80% de $5 USD/mes |
| Cost Anomaly Detection `sml-anomaly-alerts` | Detecta gastos atípicos |
| CloudWatch alarm `sml-billing-alarm-1usd` | Notifica si el gasto supera $1 USD |
| SNS topic `sml-billing-alerts` | Canal de envío de las alertas |

---

## 11. Cleanup

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
