# Infraestructura AWS — SmartMedia Labs

Documento de referencia de los recursos AWS desplegados para el proyecto.
Última actualización: 2026-05-10.

Estado actual: infraestructura base desplegada. Pendiente: trigger S3 → Lambda 2 (se configura cuando Lambda 2 exista).

---

## 1. Cuenta AWS

| Campo | Valor |
|---|---|
| Account ID | `372123585270` |
| Región | `us-east-1` (N. Virginia) |
| Owner | Omar Ramírez (omaruzgonzalez@gmail.com) |

Todos los recursos del proyecto se despliegan en `us-east-1`. Cualquier recurso creado en otra región no podrá ser referenciado por el resto del stack.

---

## 2. IAM Users

| Username | ARN | Permisos | Asignado a |
|---|---|---|---|
| `sml-omar-dev` | `arn:aws:iam::372123585270:user/sml-omar-dev` | `AdministratorAccess` | Omar (infra) |
| `sml-juanpablo-dev` | `arn:aws:iam::372123585270:user/sml-juanpablo-dev` | `AdministratorAccess` | Juan Pablo (backend) |
| `sml-santiago-dev` | `arn:aws:iam::372123585270:user/sml-santiago-dev` | `AmazonS3FullAccess` | Santiago (frontend) |
| `sml-cicd-user` | `arn:aws:iam::372123585270:user/sml-cicd-user` | `AdministratorAccess` | GitHub Actions |

Configuración del CLI:

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
| Región | `us-east-1` |
| Acceso público | Bloqueado |
| Versionado | Deshabilitado |
| CORS | Configurado (PUT/POST/GET) |

Flujo de uso:

- El frontend solicita una presigned URL a la Lambda `sml-generate-presigned-url`.
- El frontend hace `PUT` directo al bucket usando la presigned URL.
- El upload dispara (cuando exista el trigger) la Lambda `sml-process-image`.

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

`AllowedOrigins: ["*"]` se restringirá al dominio del frontend cuando esté deployado.

---

### 3.2 sml-images-output

| Campo | Valor |
|---|---|
| Bucket | `sml-images-output` |
| ARN | `arn:aws:s3:::sml-images-output` |
| Región | `us-east-1` |
| Acceso público | Lectura (`s3:GetObject`) |
| URL pattern | `https://sml-images-output.s3.us-east-1.amazonaws.com/{imageId}.jpg` |

Flujo de uso:

- La Lambda `sml-process-image` escribe la imagen procesada.
- La URL pública se persiste en DynamoDB y se publica al topic SNS.

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
| Región | `us-east-1` |
| Acceso público | Lectura |
| Static website hosting | Habilitado |
| Index document | `index.html` |
| Error document | `index.html` |
| URL pública | `http://sml-frontend.s3-website-us-east-1.amazonaws.com` |

Bucket policy:

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

Comando de deploy del frontend:

```bash
aws s3 sync ./frontend/dist s3://sml-frontend/ --delete
```

Este bucket está separado de `sml-images-output`, por lo que el flag `--delete` no afecta imágenes procesadas.

---

## 4. DynamoDB

### Tabla `sml-image-metadata`

| Campo | Valor |
|---|---|
| Nombre | `sml-image-metadata` |
| ARN | `arn:aws:dynamodb:us-east-1:372123585270:table/sml-image-metadata` |
| Estado | `ACTIVE` |
| Partition key | `imageId` (String) |
| Sort key | (ninguno) |
| Billing mode | `PAY_PER_REQUEST` |
| Table class | `STANDARD` |
| Encryption | AWS-owned key |
| Deletion protection | Habilitada |

Esquema sugerido para items:

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

Estados válidos para `status`: `PENDING`, `PROCESSING`, `PROCESSED`, `FAILED`.

---

## 5. SNS Topic

### Topic `sml-image-notifications`

| Campo | Valor |
|---|---|
| Nombre | `sml-image-notifications` |
| ARN | `arn:aws:sns:us-east-1:372123585270:sml-image-notifications` |
| Tipo | Standard |
| Display name | `SmartMedia Labs - Image Processing` |

Suscripciones activas:

| Protocol | Endpoint | Status |
|---|---|---|
| EMAIL | `omaruzgonzalez@gmail.com` | Confirmed |

Ejemplo de publicación desde Lambda (Node.js):

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

### Role `sml-lambda-execution-role`

| Campo | Valor |
|---|---|
| Nombre | `sml-lambda-execution-role` |
| ARN | `arn:aws:iam::372123585270:role/sml-lambda-execution-role` |
| Trusted entity | `lambda.amazonaws.com` |
| Maximum session duration | 1 hora |

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

Ejemplo de uso al desplegar una Lambda:

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

## 7. Recursos pendientes

### 7.1 Trigger S3 → Lambda 2

Se configurará cuando la Lambda `sml-process-image` esté desplegada:

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

### 7.2 API Gateway

Pendiente de despliegue. Cuando exista, registrar:

- API Gateway ID
- URL base (`https://{api-id}.execute-api.us-east-1.amazonaws.com/prod`)
- Endpoints: `POST /upload`, `GET /history`, `GET /status/{id}`

### 7.3 Lambda functions

Pendientes de despliegue. Cuando existan, registrar:

- `sml-generate-presigned-url` — ARN
- `sml-process-image` — ARN
- `sml-get-history` — ARN

---

## 8. Comandos de verificación

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

# IAM Users
aws iam list-users --query "Users[?starts_with(UserName,'sml-')].UserName"
```

---

## 9. Alertas de costos

| Recurso | Función |
|---|---|
| AWS Budget `sml-project-budget` | Notifica al 80% de $5 USD/mes |
| Cost Anomaly Detection `sml-anomaly-alerts` | Detecta gastos atípicos |
| CloudWatch alarm `sml-billing-alarm-1usd` | Notifica si el gasto supera $1 USD |
| SNS topic `sml-billing-alerts` | Canal de envío de las alertas |

---

## 10. Cleanup

Comandos para borrar la infraestructura cuando el proyecto termine:

```bash
# S3 (vaciar antes de borrar)
aws s3 rm s3://sml-images-input --recursive && aws s3api delete-bucket --bucket sml-images-input
aws s3 rm s3://sml-images-output --recursive && aws s3api delete-bucket --bucket sml-images-output
aws s3 rm s3://sml-frontend --recursive && aws s3api delete-bucket --bucket sml-frontend

# DynamoDB
aws dynamodb update-table --table-name sml-image-metadata --no-deletion-protection-enabled
aws dynamodb delete-table --table-name sml-image-metadata

# SNS
aws sns delete-topic --topic-arn arn:aws:sns:us-east-1:372123585270:sml-image-notifications

# IAM Role (detach antes de borrar)
for policy in AWSLambdaBasicExecutionRole AmazonS3FullAccess AmazonDynamoDBFullAccess AmazonSNSFullAccess; do
  aws iam detach-role-policy --role-name sml-lambda-execution-role --policy-arn arn:aws:iam::aws:policy/$policy
done
aws iam delete-role --role-name sml-lambda-execution-role
```
