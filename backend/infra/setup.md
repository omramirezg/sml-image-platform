# Infraestructura AWS — SmartMedia Labs

Documento de referencia de la infraestructura desplegada y diseñada para el proyecto.
Última actualización: 2026-06-01.

**Versión arquitectónica:** v2 (simplificada post-feedback).

---

## 0. Resumen de la arquitectura

```
Cliente
   v
CloudFront (puerta de entrada unica)
   |__ /            -> S3 sml-frontend (assets estaticos)
   |__ /api/*       -> API Gateway sml-api
                          v
                       POST /upload
                          v
                       Lambda sml-generate-presigned-url
                          v
                       DynamoDB (status PENDING) + devuelve presigned URL

Cliente
   v
S3 sml-images-input (PUT directo con presigned URL)
   v
S3 ObjectCreated event (trigger automatico)
   v
Lambda sml-process-image
   |__ Sharp comprime imagen
   |__ PUT imagen optimizada -> S3 sml-images-output
   |__ UPDATE status COMPLETED + outputUrl -> DynamoDB
   |__ PUBLISH notificacion -> SNS sml-image-notifications
                                  v
                                Email al admin con la URL del resultado
```

**Patrones aplicados:**

- **Valet Key Pattern**: Lambda genera presigned URL temporal, el cliente sube directo a S3 sin pasar por backend.
- **Event-driven**: S3 dispara Lambda 2 automaticamente al recibir un archivo nuevo.
- **CloudFront como puerta unica**: dos origins (S3 frontend + API Gateway) detras del mismo dominio.
- **Notificacion via SNS**: desacopla la Lambda procesadora de cualquier canal de notificacion.

---

## 1. Cuenta AWS

| Campo | Valor |
|---|---|
| Account ID | `372123585270` |
| Región | `us-east-1` (N. Virginia) |
| Owner | Omar Ramírez (omaruzgonzalez@gmail.com) |

Todos los recursos del proyecto se despliegan en `us-east-1`.

---

## 2. IAM Users

| Username | ARN | Permisos | Asignado a |
|---|---|---|---|
| `sml-omar-dev` | `arn:aws:iam::372123585270:user/sml-omar-dev` | `AdministratorAccess` | Omar (infra) |
| `sml-juanpablo-dev` | `arn:aws:iam::372123585270:user/sml-juanpablo-dev` | `AdministratorAccess` | Juan Pablo (backend) |
| `sml-santiago-dev` | `arn:aws:iam::372123585270:user/sml-santiago-dev` | `AmazonS3FullAccess` | Santiago (frontend) |
| `sml-cicd-user` | `arn:aws:iam::372123585270:user/sml-cicd-user` | `AdministratorAccess` | GitHub Actions |

---

## 3. Buckets S3

### 3.1 sml-images-input

| Campo | Valor |
|---|---|
| Bucket | `sml-images-input` |
| ARN | `arn:aws:s3:::sml-images-input` |
| Región | `us-east-1` |
| Acceso público | Bloqueado |
| Versionado | Deshabilitado |
| CORS | Configurado (PUT/POST/GET) |
| Event notification | Dispara Lambda `sml-process-image` al recibir objeto nuevo |

**Flujo de uso:**

1. El frontend solicita una presigned URL a la Lambda `sml-generate-presigned-url` via API Gateway.
2. El frontend hace `PUT` directo al bucket usando la presigned URL.
3. El upload dispara automáticamente la Lambda `sml-process-image` (configuración pendiente).

CORS aplicado:

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

`AllowedOrigins: ["*"]` se restringirá al dominio del CloudFront cuando esté deployado.

---

### 3.2 sml-images-output

| Campo | Valor |
|---|---|
| Bucket | `sml-images-output` |
| ARN | `arn:aws:s3:::sml-images-output` |
| Región | `us-east-1` |
| Acceso público | Lectura (`s3:GetObject`) |
| URL pattern | `https://sml-images-output.s3.us-east-1.amazonaws.com/{imageId}.jpg` |

La Lambda `sml-process-image` escribe acá la versión optimizada. La URL pública se persiste en DynamoDB y se publica al topic SNS para que llegue por email al admin.

---

### 3.3 sml-frontend

| Campo | Valor |
|---|---|
| Bucket | `sml-frontend` |
| ARN | `arn:aws:s3:::sml-frontend` |
| Región | `us-east-1` |
| Acceso público | Bloqueado (acceso via CloudFront OAC) |
| Static website hosting | Deshabilitado (sirve via CloudFront) |

En la arquitectura v2, este bucket se sirve a través de **CloudFront con Origin Access Control (OAC)**, no como sitio web público directo. Esto da HTTPS centralizado y permite agregar AWS WAF en una sola capa.

Comando de deploy del frontend:

```bash
aws s3 sync ./frontend/dist s3://sml-frontend/ --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

---

## 4. CloudFront

### Distribution

| Campo | Valor |
|---|---|
| Origin 1 | S3 `sml-frontend` (assets estaticos) |
| Origin 2 | API Gateway `sml-api` (calls al backend) |
| Routing | `/api/*` → API Gateway; resto → S3 frontend |
| Cache (S3) | TTL 24h, gzip/brotli habilitado |
| Cache (API) | Sin cache (DefaultTTL 0) |
| HTTPS | Forzado (redirect-to-https) |
| Price Class | PriceClass_100 (US, Canada, Europa) |
| OAC | Sí, para acceder a S3 sin exposición pública |

**Plantilla CloudFormation:** `backend/infra/cloudfront.yaml`

**Deploy:**

```bash
aws cloudformation deploy \
  --template-file backend/infra/cloudfront.yaml \
  --stack-name sml-cloudfront \
  --region us-east-1 \
  --capabilities CAPABILITY_IAM
```

**Estado:** Plantilla preparada en el repo. Pendiente de primer deploy a AWS.

---

## 5. DynamoDB

### Tabla `sml-image-metadata`

| Campo | Valor |
|---|---|
| Nombre | `sml-image-metadata` |
| ARN | `arn:aws:dynamodb:us-east-1:372123585270:table/sml-image-metadata` |
| Estado | `ACTIVE` |
| Partition key | `imageId` (String) |
| Sort key | (ninguno) |
| Billing mode | `PAY_PER_REQUEST` |
| Encryption | AWS-owned key |
| Deletion protection | Habilitada |

Esquema sugerido para items:

```json
{
  "imageId": "uuid-v4-string",
  "fileName": "vacaciones.jpg",
  "originalSize": 4523891,
  "processedSize": 845712,
  "status": "COMPLETED",
  "outputUrl": "https://sml-images-output.s3.us-east-1.amazonaws.com/uuid-v4.jpg",
  "createdAt": "2026-06-01T15:30:00Z",
  "processedAt": "2026-06-01T15:30:08Z"
}
```

Estados válidos para `status`: `PENDING` (Lambda 1 al recibir solicitud), `COMPLETED` (Lambda 2 al terminar), `FAILED` (Lambda 2 en error).

---

## 6. SNS Topic

### Topic `sml-image-notifications`

| Campo | Valor |
|---|---|
| Nombre | `sml-image-notifications` |
| ARN | `arn:aws:sns:us-east-1:372123585270:sml-image-notifications` |
| Tipo | Standard |

Suscripciones activas:

| Protocol | Endpoint | Status |
|---|---|---|
| EMAIL | `omaruzgonzalez@gmail.com` | Confirmed |

Lambda `sml-process-image` publica al topic al terminar el procesamiento. SNS distribuye el mensaje al email del admin con la URL del resultado.

Ejemplo de publicación (Node.js):

```javascript
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({ region: "us-east-1" });

await sns.send(new PublishCommand({
  TopicArn: "arn:aws:sns:us-east-1:372123585270:sml-image-notifications",
  Subject: "Imagen procesada",
  Message: JSON.stringify({
    imageId,
    outputUrl,
    originalSize,
    processedSize,
    compressionRatio: `${Math.round((1 - processedSize/originalSize) * 100)}%`
  })
}));
```

---

## 7. IAM Role para Lambdas

### Role `sml-lambda-execution-role`

| Campo | Valor |
|---|---|
| Nombre | `sml-lambda-execution-role` |
| ARN | `arn:aws:iam::372123585270:role/sml-lambda-execution-role` |
| Trusted entity | `lambda.amazonaws.com` |
| Maximum session duration | 1 hora |

Asumido por las **2 Lambdas** del proyecto:
- `sml-generate-presigned-url`
- `sml-process-image`

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["sts:AssumeRole"],
      "Principal": {
        "Service": ["lambda.amazonaws.com"]
      }
    }
  ]
}
```

Managed policies adjuntas:

| Policy | Para |
|---|---|
| `AWSLambdaBasicExecutionRole` | Logs en CloudWatch |
| `AmazonS3FullAccess` | Acceso a `sml-images-input` y `sml-images-output` |
| `AmazonDynamoDBFullAccess` | Operaciones sobre `sml-image-metadata` |
| `AmazonSNSFullAccess` | Publicación al topic `sml-image-notifications` |

---

## 8. Funciones Lambda

Arquitectura v2 usa **2 funciones Lambda** (en v1 había 3 con polling de estado, ahora se usa notificación email).

### 8.1 sml-generate-presigned-url

| Campo | Valor |
|---|---|
| Nombre | `sml-generate-presigned-url` |
| ARN | `arn:aws:lambda:us-east-1:372123585270:function:sml-generate-presigned-url` |
| Runtime | `nodejs18.x` |
| Handler | `index.handler` |
| Role | `sml-lambda-execution-role` |
| Trigger | API Gateway POST /upload |
| Timeout | 30s |
| Memory | 128 MB |

**Responsabilidad:**
1. Recibe la solicitud de upload (fileName, fileType).
2. Genera un UUID único como `imageId`.
3. Crea registro en DynamoDB con `status: "PENDING"`.
4. Genera presigned URL firmada localmente con AWS SDK (válida 15 minutos).
5. Devuelve `{ uploadUrl, imageId }` al cliente.

### 8.2 sml-process-image

| Campo | Valor |
|---|---|
| Nombre | `sml-process-image` |
| Runtime | `nodejs18.x` |
| Handler | `index.handler` |
| Role | `sml-lambda-execution-role` |
| Trigger | S3 ObjectCreated en bucket `sml-images-input` |
| Timeout | 60s |
| Memory | 512 MB (recomendado para Sharp) |

**Responsabilidad:**
1. Triggered automáticamente cuando llega objeto nuevo a `sml-images-input`.
2. Descarga la imagen original.
3. Comprime con la librería [Sharp](https://sharp.pixelplumbing.com/).
4. Sube versión optimizada a `sml-images-output`.
5. Actualiza DynamoDB: `status: "COMPLETED"` + `outputUrl`.
6. Publica notificación al topic SNS con la URL del resultado.

**Dependencias en package.json:**

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/client-dynamodb": "^3.x",
    "@aws-sdk/client-sns": "^3.x",
    "sharp": "^0.33.x"
  }
}
```

**Importante con Sharp en Lambda:** Sharp tiene binarios nativos. Para que funcione en Lambda (Amazon Linux 2), se debe instalar con:

```bash
npm install --os=linux --cpu=x64 sharp
```

O usar un Lambda Layer pre-compilado.

---

## 9. API Gateway

### sml-api (REST)

Desplegada con CloudFormation (template `backend/infra/api-gateway.yaml`, stack `sml-api`).

| Campo | Valor |
|---|---|
| API ID | `bg7yhanxyg` |
| Stack name | `sml-api` |
| Stage | `prod` |
| URL base | `https://bg7yhanxyg.execute-api.us-east-1.amazonaws.com/prod` |
| Tipo | REST API Regional |
| Auth | NONE (publico, sin autenticacion en MVP) |

Endpoints:

| Method | Path | Integration | Lambda invocada |
|---|---|---|---|
| POST | `/upload` | AWS_PROXY | `sml-generate-presigned-url` |
| OPTIONS | `/upload` | MOCK | (CORS preflight) |

**Nota:** En la versión v1 había también `/history` y `/status/{id}`. En v2 se eliminaron porque la notificación al usuario es por email vía SNS (sin polling).

Para redeployar después de cambios:

```bash
aws cloudformation deploy \
  --template-file backend/infra/api-gateway.yaml \
  --stack-name sml-api \
  --region us-east-1 \
  --parameter-overrides GeneratePresignedUrlLambdaArn=arn:aws:lambda:us-east-1:372123585270:function:sml-generate-presigned-url
```

---

## 10. Configuración del trigger S3 → Lambda 2

Comando para configurar el trigger cuando Lambda 2 esté desplegada:

```bash
# 1. Dar permiso a S3 para invocar la Lambda
aws lambda add-permission \
  --function-name sml-process-image \
  --statement-id s3-trigger \
  --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn arn:aws:s3:::sml-images-input

# 2. Configurar el notification en el bucket
cat > /tmp/s3-event.json <<EOF
{
  "LambdaFunctionConfigurations": [
    {
      "Id": "ProcessImageOnUpload",
      "LambdaFunctionArn": "arn:aws:lambda:us-east-1:372123585270:function:sml-process-image",
      "Events": ["s3:ObjectCreated:*"]
    }
  ]
}
EOF

aws s3api put-bucket-notification-configuration \
  --bucket sml-images-input \
  --notification-configuration file:///tmp/s3-event.json
```

---

## 11. Estado de despliegue

| Componente | Estado | Notas |
|---|---|---|
| IAM Users (4) | ✅ Desplegado | Vía AWS CLI |
| IAM Role `sml-lambda-execution-role` | ✅ Desplegado | Vía AWS CLI |
| S3 `sml-frontend` | ✅ Desplegado | Bucket creado, política a actualizar para OAC |
| S3 `sml-images-input` | ✅ Desplegado | CORS configurado, trigger S3→Lambda pendiente |
| S3 `sml-images-output` | ✅ Desplegado | Pública de lectura |
| DynamoDB `sml-image-metadata` | ✅ Desplegado | On-demand, deletion protection ON |
| SNS Topic `sml-image-notifications` | ✅ Desplegado | Email confirmado |
| API Gateway `sml-api` | ✅ Desplegado | Template actualizado a Lambda integration (re-deploy pendiente) |
| Lambda `sml-generate-presigned-url` | ✅ Desplegada | Por Juan Pablo |
| Lambda `sml-process-image` | ⏳ Pendiente | Por Juan Pablo |
| **CloudFront** | ⏳ Pendiente | Template listo en `cloudfront.yaml`, sin deploy |
| Trigger S3 → Lambda 2 | ⏳ Pendiente | Se configura cuando Lambda 2 esté lista |

---

## 12. Próximos pasos

1. **Juan Pablo**: terminar despliegue de `sml-process-image`.
2. **Omar**: deployar CloudFront (`aws cloudformation deploy --template-file cloudfront.yaml ...`).
3. **Omar**: actualizar bucket policy de `sml-frontend` para que solo acepte requests desde CloudFront (OAC).
4. **Omar**: configurar trigger S3 → Lambda 2 una vez Lambda 2 esté desplegada.
5. **Omar**: re-deployar API Gateway con el nuevo template (Lambda integration en lugar de MOCK).
6. **Andrés**: pipeline CI/CD con GitHub Actions usando `sml-cicd-user`.
7. **Equipo**: restringir CORS de `sml-images-input` al dominio CloudFront.

---

## 13. Comandos de verificación

```bash
# Identidad
aws sts get-caller-identity

# S3
aws s3 ls | grep sml-

# DynamoDB
aws dynamodb describe-table --table-name sml-image-metadata --query "Table.{Status:TableStatus,ARN:TableArn}"

# SNS
aws sns list-topics --query "Topics[?contains(TopicArn,'sml-image-notifications')]"
aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:us-east-1:372123585270:sml-image-notifications

# IAM Role
aws iam get-role --role-name sml-lambda-execution-role --query "Role.Arn"
aws iam list-attached-role-policies --role-name sml-lambda-execution-role

# Lambdas
aws lambda list-functions --query "Functions[?starts_with(FunctionName,'sml-')].FunctionName"

# CloudFormation stacks
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[?starts_with(StackName,'sml-')]"
```

---

## 14. Alertas de costos (4 capas)

| Capa | Recurso | Threshold | Función |
|---|---|---|---|
| 1 | Billing preferences | N/A | Habilita métrica EstimatedCharges en CloudWatch |
| 2 | AWS Budget `sml-project-budget` | $3 USD/mes | Notifica al 80%, 100%, 120% |
| 3 | Cost Anomaly Detection `sml-anomaly-alerts` | $1 USD anómalo | ML detecta desviaciones de patrón |
| 4 | CloudWatch alarm `sml-billing-alarm-1usd` | $1 USD acumulado | Publica al topic SNS de billing |

---

## 15. Cleanup

Comandos para borrar la infraestructura cuando el proyecto termine:

```bash
# CloudFormation stacks (orden importante: dependencias)
aws cloudformation delete-stack --stack-name sml-cloudfront
aws cloudformation wait stack-delete-complete --stack-name sml-cloudfront
aws cloudformation delete-stack --stack-name sml-api
aws cloudformation wait stack-delete-complete --stack-name sml-api

# Lambdas (las que no esten en CloudFormation)
aws lambda delete-function --function-name sml-generate-presigned-url
aws lambda delete-function --function-name sml-process-image

# S3 (vaciar antes de borrar)
aws s3 rm s3://sml-images-input --recursive && aws s3api delete-bucket --bucket sml-images-input
aws s3 rm s3://sml-images-output --recursive && aws s3api delete-bucket --bucket sml-images-output
aws s3 rm s3://sml-frontend --recursive && aws s3api delete-bucket --bucket sml-frontend

# DynamoDB
aws dynamodb update-table --table-name sml-image-metadata --no-deletion-protection-enabled
aws dynamodb delete-table --table-name sml-image-metadata

# SNS
aws sns delete-topic --topic-arn arn:aws:sns:us-east-1:372123585270:sml-image-notifications

# IAM Role
for policy in AWSLambdaBasicExecutionRole AmazonS3FullAccess AmazonDynamoDBFullAccess AmazonSNSFullAccess; do
  aws iam detach-role-policy --role-name sml-lambda-execution-role --policy-arn arn:aws:iam::aws:policy/$policy
done
aws iam delete-role --role-name sml-lambda-execution-role
```
