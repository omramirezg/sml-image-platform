# SmartMedia Labs — Arquitectura

> Plataforma serverless de procesamiento de imágenes en AWS.
> Upload directo a S3 con restricciones nativas (CORS, size limit, content-type).
> Cuenta: 372123585270 · Región: us-east-1

---

## Diagrama end-to-end

```
                 ┌──────────────┐
                 │   USUARIO    │
                 │  Navegador   │
                 └──────┬───────┘
                        │
              ┌─────────┴─────────┐
              │                   │
        (1) cargar           (3) PUT directo
              │                   │
              ▼                   ▼
       ┌──────────────┐    ┌──────────────┐
       │ S3 frontend  │    │ S3 input     │
       │              │    │ (con CORS +  │
       │ (sitio web)  │    │  size limit) │
       └──────────────┘    └──────┬───────┘
                                  │
                          (4) trigger automático
                                  │
                                  ▼
                          ┌──────────────┐
                          │  LAMBDA 2    │
                          │              │
                          │ • crea DDB   │
                          │ • comprime   │
                          │ • sube out   │
                          │ • update DDB │
                          │ • notif SNS  │
                          └─────┬────────┘
                                │
            ┌───────────────────┼─────────────────┐
            ▼                   ▼                 ▼
      ┌──────────┐        ┌──────────┐      ┌──────────┐
      │ S3 output│        │ DynamoDB │      │   SNS    │
      └──────────┘        └────▲─────┘      └────┬─────┘
                               │                  │
                          (5) status?             │ email
                               │                  ▼
                          ┌────┴─────┐       (notif)
                          │ LAMBDA 3 │
                          └────▲─────┘
                               │
                          (6) GET /status
                               │
                          [User polling]

═════════════════════════════════════════════════════════════════════

 ┌──────── CI/CD e IaC ────────────┐     ┌─── Monitoreo y trazabilidad ───┐
 │                                  │     │                                 │
 │  ┌──────────┐   ┌──────────────┐ │     │  ┌──────────┐   ┌──────────┐  │
 │  │  GitHub  │──▶│CloudFormation│ │     │  │CloudWatch│   │CloudTrail│  │
 │  │  Actions │   │              │ │     │  │          │   │          │  │
 │  │          │   │  (IaC)       │ │     │  │  Logs +  │   │ Auditoría│  │
 │  │(Pipeline)│   │              │ │     │  │ Métricas │   │  cuenta  │  │
 │  └──────────┘   └──────┬───────┘ │     │  └──────────┘   └──────────┘  │
 │                        │         │     │                                 │
 └────────────────────────┼─────────┘     └─────────────────────────────────┘
                          │
                     Deploy infra
                          │
                          ▼
                  [AWS infraestructura arriba]
```

---

## Leyenda

| Paso / Sección | Acción                                                            |
|----------------|-------------------------------------------------------------------|
| (1)            | Cliente descarga el sitio web estático desde S3 frontend          |
| (3)            | Cliente sube imagen directo a S3 input vía PUT con UUID propio    |
| (4)            | S3 dispara automáticamente a Lambda 2 vía event notification      |
| (5)            | Lambda 3 lee estado actual desde DynamoDB                         |
| (6)            | Cliente hace polling con GET /status al API Gateway → Lambda 3    |
| email          | SNS distribuye notificación al correo suscrito                    |
| Deploy infra   | GitHub Actions ejecuta `aws cloudformation deploy`                |
| Monitoreo      | CloudWatch captura logs; CloudTrail audita acciones               |

---

## Componentes

| Servicio                  | Identificador                                       |
|---------------------------|-----------------------------------------------------|
| S3 Frontend               | `sml-frontend` (público lectura)                    |
| S3 Input                  | `sml-images-input` (privado, CORS + size limit)     |
| S3 Output                 | `sml-images-output` (público lectura)               |
| Lambda Processing         | `sml-process-image`                                 |
| Lambda Status/History     | `sml-get-status-history`                            |
| API Gateway               | `sml-api` (id `bg7yhanxyg`)                         |
| DynamoDB                  | `sml-image-metadata` (PK: imageId, on-demand)       |
| SNS Topic                 | `sml-image-notifications`                           |
| IAM Role                  | `sml-lambda-execution-role`                         |
| CloudFormation            | Stack `sml-api` (13 recursos de API Gateway)        |
| GitHub Actions            | Pipeline CI/CD (responsable: Andrés)                |
| CloudWatch                | Logs de Lambdas + métricas de billing               |
| CloudTrail                | Auditoría de toda la cuenta (90 días gratis)        |

---

## Restricciones aplicadas a S3 input

| Restricción            | Cómo se aplica                                       |
|------------------------|------------------------------------------------------|
| Solo tipo imagen       | Bucket policy con condición `s3:content-type`        |
| Tamaño máximo 10 MB    | Validación en Lambda 2 al recibir el objeto          |
| Solo desde el dominio  | CORS configuration con AllowedOrigins limitado       |
| Nombre único           | UUID generado en el frontend antes del PUT           |
| No sobrescribir        | Bucket policy denegando overwrite del mismo key      |

---

## Por qué no hay Lambda 1 (presigned URL)

Para el alcance del proyecto (sin autenticación, sin cuotas por usuario,
sin rate limiting fino), una Lambda intermedia para generar presigned URLs
agrega complejidad sin valor real.

Las restricciones de upload se aplican directamente al bucket S3.

Si en el futuro se necesitara autenticación, se reintroduciría un punto
de control intermedio: Lambda Authorizer en API Gateway, Cognito Identity
Pool con credenciales temporales STS, o una Lambda dedicada que valide
JWT antes de generar la URL firmada.
