# SmartMedia Labs — AWS Infrastructure Setup

> **Documento técnico de referencia.** Lista todos los recursos AWS desplegados para el proyecto, con sus ARNs reales, URLs públicas y comandos de verificación. Lee esto cuando necesites un nombre/ARN exacto para tu código.
>
> **Mantenedor:** Omar Ramírez (@omramirezg) — rol Infraestructura
> **Última actualización:** 2026-05-10
> **Estado:** Toda la infraestructura base desplegada. Pendiente: trigger S3→Lambda 2 (se configura cuando Lambda 2 exista).

---

## 1. Cuenta AWS

| Campo | Valor |
|---|---|
| **Account ID** | `372123585270` |
| **Región oficial** | `us-east-1` (N. Virginia) — todos los recursos van aquí |
| **Owner** | Omar Ramírez (omaruzgonzalez@gmail.com) |
| **Plan** | Free Plan nuevo, $120 USD créditos hasta 2026-08-09 |

> ⚠️ **CRÍTICO:** todos los recursos del proyecto deben estar en `us-east-1`. Si por error creas algo en otra región, el resto del stack no podrá referenciarlo.

---

## 2. IAM Users (1 por persona + 1 para CI/CD)

| Username | ARN | Permisos | Para quién |
|---|---|---|---|
| `sml-omar-dev` | `arn:aws:iam::372123585270:user/sml-omar-dev` | `AdministratorAccess` | Omar (infra) |
| `sml-juanpablo-dev` | `arn:aws:iam::372123585270:user/sml-juanpablo-dev` | `AdministratorAccess` | Juan Pablo (backend) |
| `sml-santiago-dev` | `arn:aws:iam::372123585270:user/sml-santiago-dev` | `AmazonS3FullAccess` | Santiago (frontend) |
| `sml-cicd-user` | `arn:aws:iam::372123585270:user/sml-cicd-user` | `AdministratorAccess` | GitHub Actions (Andrés) |

**Cómo configurar AWS CLI con tu user:**

```bash
aws configure
# AWS Access Key ID:     [pegar Key ID que te pasó Omar]
# AWS Secret Access Key: [pegar Secret que te pasó Omar]
# Default region:        us-east-1
# Default output:        json

# Verificar que funciona:
aws sts get-caller-identity
# Debe retornar tu user (sml-juanpablo-dev, sml-santiago-dev, etc.) y el Account 372123585270
```

---

## 3. S3 Buckets

### 3.1 `sml-images-input` — bucket privado, recibe uploads del usuario

| Campo | Valor |
|---|---|
| **Bucket name** | `sml-images-input` |
| **ARN** | `arn:aws:s3:::sml-images-input` |
| **Region** | `us-east-1` |
| **Public access** | 🔒 Bloqueado (privado) |
| **Versioning** | Disabled |
| **CORS** | ✅ Configurado (permite PUT/POST/GET desde cualquier origen) |

**Uso esperado:**
- Frontend solicita una **presigned URL** a Lambda 1 (`sml-generate-presigned-url`).
- Frontend hace `PUT` directo a este bucket usando esa URL.
- El upload dispara (futuro) un evento → Lambda 2 (`sml-process-image`).

**CORS aplicado:**

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

> ⚠️ El `AllowedOrigins: ["*"]` es temporal. Cuando el frontend tenga URL fija, hay que restringirlo al dominio específico.

---

### 3.2 `sml-images-output` — bucket público, contiene imágenes ya procesadas

| Campo | Valor |
|---|---|
| **Bucket name** | `sml-images-output` |
| **ARN** | `arn:aws:s3:::sml-images-output` |
| **Region** | `us-east-1` |
| **Public access** | 🌐 Lectura pública (`s3:GetObject` para `*`) |
| **URL pattern** | `https://sml-images-output.s3.us-east-1.amazonaws.com/{imageId}.jpg` |

**Uso esperado:**
- Lambda 2 escribe la imagen comprimida aquí.
- La URL pública se guarda en DynamoDB y se publica al SNS topic.

**Bucket policy aplicada:**

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

### 3.3 `sml-frontend` — hosting estático del frontend

| Campo | Valor |
|---|---|
| **Bucket name** | `sml-frontend` |
| **ARN** | `arn:aws:s3:::sml-frontend` |
| **Region** | `us-east-1` |
| **Public access** | 🌐 Lectura pública |
| **Static website hosting** | ✅ Habilitado |
| **Index document** | `index.html` |
| **Error document** | `index.html` (SPA fallback) |
| **URL pública** | `http://sml-frontend.s3-website-us-east-1.amazonaws.com` |

**Bucket policy aplicada:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublicReadOfFrontendAssets",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::sml-frontend/*"
    }
  ]
}
```

> 💡 **Nota para Andrés (CI/CD):** el deploy del frontend es:
> ```
> aws s3 sync ./frontend/dist s3://sml-frontend/ --delete
> ```
> Como este bucket está SEPARADO de `sml-images-output`, el `--delete` es seguro y no borra imágenes procesadas.

---

## 4. DynamoDB

### `sml-image-metadata`

| Campo | Valor |
|---|---|
| **Table name** | `sml-image-metadata` |
| **ARN** | `arn:aws:dynamodb:us-east-1:372123585270:table/sml-image-metadata` |
| **Status** | `ACTIVE` |
| **Partition key** | `imageId` (String) |
| **Sort key** | (ninguno) |
| **Billing mode** | `PAY_PER_REQUEST` (on-demand) |
| **Table class** | `STANDARD` |
| **Encryption** | AWS-owned key (default) |
| **Deletion protection** | ✅ Habilitada |

**Esquema sugerido para items** (DynamoDB es schemaless — solo el partition key es obligatorio, el resto se agrega por item):

```json
{
  "imageId": "uuid-v4-string",
  "fileName": "vacaciones.jpg",
  "originalSize": 4523891,
  "processedSize": 845712,
  "status": "PROCESSED",
  "outputUrl": "https://sml-images-output.s3.us-east-1.amazonaws.com/uuid-v4.jpg",
  "createdAt": "2026-05-10T15:30:00Z",
  "processedAt": "2026-05-10T15:30:08Z"
}
```

**Estados válidos para `status`:** `PENDING`, `PROCESSING`, `PROCESSED`, `FAILED`.

> 💡 **PAY_PER_REQUEST** significa que pagas solo por requests reales (~$0 con el tráfico del proyecto). No hay capacidad provisionada que se desperdicie.

---

## 5. SNS Topic

### `sml-image-notifications`

| Campo | Valor |
|---|---|
| **Topic name** | `sml-image-notifications` |
| **ARN** | `arn:aws:sns:us-east-1:372123585270:sml-image-notifications` |
| **Type** | Standard (no FIFO) |
| **Display name** | `SmartMedia Labs - Image Processing` |

**Suscripciones activas:**

| Protocol | Endpoint | Status |
|---|---|---|
| EMAIL | `omaruzgonzalez@gmail.com` | ✅ Confirmed |

**Cómo publicar desde Lambda (ejemplo Node.js):**

```javascript
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({ region: "us-east-1" });

await sns.send(new PublishCommand({
  TopicArn: "arn:aws:sns:us-east-1:372123585270:sml-image-notifications",
  Subject: "Imagen procesada",
  Message: JSON.stringify({ imageId, outputUrl })
}));
```

---

## 6. IAM Role para Lambdas

### `sml-lambda-execution-role` ⭐ (lo que necesita Juan Pablo)

| Campo | Valor |
|---|---|
| **Role name** | `sml-lambda-execution-role` |
| **ARN** | `arn:aws:iam::372123585270:role/sml-lambda-execution-role` |
| **Trusted entity** | `lambda.amazonaws.com` |
| **Maximum session duration** | 1 hour (default) |

**Trust policy:**

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

**Managed policies adjuntas (4):**

| Policy | Sirve para |
|---|---|
| `AWSLambdaBasicExecutionRole` | Logs en CloudWatch (CRÍTICO para debugging) |
| `AmazonS3FullAccess` | Leer de `sml-images-input`, escribir en `sml-images-output` |
| `AmazonDynamoDBFullAccess` | Escribir/leer items en `sml-image-metadata` |
| `AmazonSNSFullAccess` | Publicar al topic `sml-image-notifications` |

**Cómo asignar este rol al desplegar una Lambda (ejemplo):**

```bash
aws lambda create-function \
  --function-name sml-process-image \
  --runtime nodejs18.x \
  --role arn:aws:iam::372123585270:role/sml-lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --region us-east-1
```

---

## 7. Recursos pendientes (semana 2)

### 7.1 Trigger S3 → Lambda 2

Cuando Juan Pablo despliegue `sml-process-image`, Omar configurará:

```bash
# 1. Permitir a S3 invocar la Lambda
aws lambda add-permission \
  --function-name sml-process-image \
  --statement-id s3-trigger \
  --action lambda:InvokeFunction \
  --principal s3.amazonaws.com \
  --source-arn arn:aws:s3:::sml-images-input

# 2. Configurar el trigger en el bucket
aws s3api put-bucket-notification-configuration \
  --bucket sml-images-input \
  --notification-configuration file://s3-event.json
```

### 7.2 API Gateway

Lo crea Juan Pablo. Cuando exista, agregar aquí:
- API Gateway ID
- URL base (`https://{api-id}.execute-api.us-east-1.amazonaws.com/prod`)
- Endpoints: `POST /upload`, `GET /history`, `GET /status/{id}`

### 7.3 Lambda functions

Las despliega Juan Pablo. Cuando existan, agregar:
- `sml-generate-presigned-url` — ARN
- `sml-process-image` — ARN
- `sml-get-history` — ARN (para `GET /history`)

---

## 8. Comandos de verificación rápida

Si necesitas verificar que un recurso existe y está bien:

```bash
# Account
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

# IAM Users
aws iam list-users --query "Users[?starts_with(UserName,'sml-')].UserName"
```

---

## 9. Alertas de costos configuradas

Para que nadie se asuste con la facturación, hay 3 capas de protección:

| Capa | Recurso | Trigger |
|---|---|---|
| 1 | AWS Budget `sml-project-budget` | Notifica al 80% de $5 USD/mes |
| 2 | Cost Anomaly Detection `sml-anomaly-alerts` | Detecta gastos atípicos |
| 3 | CloudWatch alarm `sml-billing-alarm-1usd` | Email si el gasto supera $1 USD |
| 4 | SNS topic `sml-billing-alerts` | Recibe las alertas de costos |

Si alguno de estos dispara una alerta, **avisar al equipo inmediatamente**.

---

## 10. Cleanup pre-deadline (CRÍTICO)

**Antes del 2026-08-09**, borrar TODOS los recursos para evitar que la cuenta entre en modo pago:

```bash
# Borrar buckets (vaciarlos primero)
aws s3 rm s3://sml-images-input --recursive && aws s3api delete-bucket --bucket sml-images-input
aws s3 rm s3://sml-images-output --recursive && aws s3api delete-bucket --bucket sml-images-output
aws s3 rm s3://sml-frontend --recursive && aws s3api delete-bucket --bucket sml-frontend

# Deshabilitar deletion protection y borrar tabla
aws dynamodb update-table --table-name sml-image-metadata --no-deletion-protection-enabled
aws dynamodb delete-table --table-name sml-image-metadata

# Borrar topic SNS
aws sns delete-topic --topic-arn arn:aws:sns:us-east-1:372123585270:sml-image-notifications

# Borrar IAM Role (detach policies primero)
for policy in AWSLambdaBasicExecutionRole AmazonS3FullAccess AmazonDynamoDBFullAccess AmazonSNSFullAccess; do
  aws iam detach-role-policy --role-name sml-lambda-execution-role --policy-arn arn:aws:iam::aws:policy/$policy
done
aws iam delete-role --role-name sml-lambda-execution-role

# Borrar IAM users (después de borrar sus access keys y policies)
# (cada user requiere su propio cleanup — ver docs AWS)
```
