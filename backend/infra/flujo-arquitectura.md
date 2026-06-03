# Flujo de la Arquitectura — SmartMedia Labs

> Diagramas de la plataforma serverless de procesamiento de imágenes.
> Arquitectura **simplificada**: upload directo a S3 con restricciones nativas en el bucket.
> No hay Lambda intermedia para generar presigned URLs.

---

## Diagrama 1 — Flujo de Upload

El usuario sube la imagen directamente al bucket S3 input.
El bucket tiene restricciones de CORS, tamaño y tipo de archivo aplicadas a nivel S3.

```
                    ┌───────────────────┐
                    │   USUARIO         │
                    │   Navegador       │
                    └─────────┬─────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
         (1) cargar                    (2) PUT directo
              │                               │
              ▼                               ▼
       ┌──────────────┐              ┌──────────────────┐
       │ S3 frontend  │              │ S3 input         │
       │              │              │ (con CORS +      │
       │ sitio web    │              │  size limit)     │
       │ publico      │              │                  │
       └──────────────┘              └────────┬─────────┘
                                              │
                                       (3) trigger
                                          automatico
                                              │
                                              ▼
                                     ┌────────────────┐
                                     │ LAMBDA 2       │
                                     │ process-image  │
                                     │                │
                                     │ • crea DDB     │
                                     │ • comprime     │
                                     │ • sube output  │
                                     │ • update DDB   │
                                     │ • notif SNS    │
                                     └────────────────┘
```

---

## Diagrama 2 — Procesamiento (Lambda 2)

Lambda 2 se despierta automaticamente con el trigger de S3 y dispara
cuatro acciones en paralelo: persistencia, transformacion, almacenamiento
y notificacion.

```
                  ┌────────────────┐
                  │ LAMBDA 2       │
                  │ process-image  │
                  └─┬──┬──┬──┬─────┘
                    │  │  │  │
        ┌───────────┘  │  │  └───────────┐
        │              │  │              │
        ▼              ▼  ▼              ▼
 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │ S3 output    │ │ DynamoDB     │ │ SNS Topic    │
 │              │ │              │ │              │
 │ comprimidas  │ │ sml-image-   │ │ sml-image-   │
 │ publico      │ │ metadata     │ │ notifications│
 │ lectura      │ │              │ │              │
 └──────────────┘ └──────────────┘ └──────┬───────┘
                                          │
                                    (4) notifica
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │   Email      │
                                   │              │
                                   │ omar@gmail   │
                                   └──────────────┘
```

---

## Diagrama 3 — Consulta de Estado e Historial

El frontend hace polling cada N segundos para saber si la imagen
ya esta lista. Tambien usa el mismo endpoint Lambda para listar
el historial del usuario.

```
                  ┌───────────────────┐
                  │   USUARIO         │
                  │   Navegador       │
                  └─────────┬─────────┘
                            │
                     (5) GET /status
                            │
                            ▼
                  ┌──────────────────┐
                  │ API Gateway      │
                  │ sml-api          │
                  │                  │
                  │ GET /status/{id} │
                  │ GET /history     │
                  └────────┬─────────┘
                           │
                     (6) invoca
                           │
                           ▼
                  ┌────────────────┐
                  │ LAMBDA 3       │
                  │ status/history │
                  │                │
                  │ • lee DDB      │
                  │ • devuelve     │
                  │   JSON         │
                  └────────┬───────┘
                           │
                      (7) lee
                           │
                           ▼
                  ┌──────────────┐
                  │ DynamoDB     │
                  │              │
                  │ sml-image-   │
                  │ metadata     │
                  └──────────────┘
```

---

## Diagrama 4 — Descarga de Imagen Comprimida

Cuando el polling devuelve estado COMPLETED, el frontend recibe la URL
del bucket de output y el usuario descarga directamente sin pasar por
ninguna Lambda.

```
                  ┌───────────────────┐
                  │   USUARIO         │
                  │   Navegador       │
                  └─────────┬─────────┘
                            │
                     (8) GET imagen
                       (URL publica)
                            │
                            ▼
                  ┌──────────────────┐
                  │ S3 output        │
                  │                  │
                  │ sml-images-      │
                  │ output           │
                  │                  │
                  │ publico lectura  │
                  └──────────────────┘
```

---

## Diagrama 5 — Vista General Completa

Toda la arquitectura en un solo diagrama, mostrando los tres caminos
que sigue el usuario: cargar el sitio, subir imagen, consultar estado.

```
                          ┌───────────────────┐
                          │   USUARIO         │
                          │   Navegador       │
                          └─────────┬─────────┘
                                    │
       ┌────────────────────┬───────┴───────┬────────────────────┐
       │                    │               │                    │
   (1) cargar         (2) PUT imagen    (5) GET status    (8) GET imagen
       │                    │               │                    │
       ▼                    ▼               ▼                    ▼
 ┌──────────┐         ┌──────────┐   ┌──────────────┐    ┌──────────┐
 │ S3       │         │ S3       │   │ API Gateway  │    │ S3       │
 │ frontend │         │ input    │   │ sml-api      │    │ output   │
 │          │         │ (CORS +  │   │              │    │          │
 │ publico  │         │  size)   │   │ /status      │    │ publico  │
 └──────────┘         └────┬─────┘   │ /history     │    │ lectura  │
                           │         └──────┬───────┘    └──────────┘
                     (3) trigger            │
                           │           (6) invoca
                           ▼                │
                   ┌──────────────┐         ▼
                   │ LAMBDA 2     │  ┌──────────────┐
                   │ process-     │  │ LAMBDA 3     │
                   │ image        │  │ status /     │
                   │              │  │ history      │
                   │ • comprime   │  │              │
                   │ • persiste   │  │ • lee DDB    │
                   │ • notifica   │  └──────┬───────┘
                   └──┬──┬──┬─────┘         │
                      │  │  │               │
            ┌─────────┘  │  └─────────┐     │
            │            │            │     │
            ▼            ▼            ▼     ▼
      ┌──────────┐ ┌──────────┐  ┌──────────────┐
      │ S3 output│ │   SNS    │  │ DynamoDB     │
      │          │ │ image-   │  │ sml-image-   │
      │ comprim. │ │ notif    │  │ metadata     │
      └──────────┘ └────┬─────┘  │              │
                        │        │ PK: imageId  │
                  (4) email      │ on-demand    │
                        │        └──────────────┘
                        ▼
                  ┌──────────┐
                  │  Email   │
                  │   Omar   │
                  └──────────┘
```

---

## Diagrama 6 — Componentes Transversales

Servicios que no estan en el flujo principal pero soportan todo el sistema.

```
═══════════════════════════════════════════════════════════════════════
                     SEGURIDAD Y GOBERNANZA
═══════════════════════════════════════════════════════════════════════

 ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
 │ IAM Role            │  │ CloudFormation      │  │ IAM Users           │
 │ lambda-execution-   │  │                     │  │                     │
 │ role                │  │ Stack: sml-api      │  │ • sml-omar-dev      │
 │                     │  │                     │  │ • sml-juanpablo-dev │
 │ • S3 Full           │  │ • Template YAML     │  │ • sml-santiago-dev  │
 │ • DynamoDB Full     │  │ • Versionado Git    │  │ • sml-cicd-user     │
 │ • SNS Full          │  │ • Rollback auto     │  │                     │
 │ • CloudWatch Logs   │  │ • Cross-stack refs  │  │ Menor privilegio    │
 │                     │  │                     │  │ aplicado            │
 │ Asumido por las     │  │ Crea: 13 recursos   │  │                     │
 │ 2 Lambdas           │  │ de API Gateway      │  │                     │
 └─────────────────────┘  └─────────────────────┘  └─────────────────────┘


═══════════════════════════════════════════════════════════════════════
                     MONITOREO Y PROTECCION DE COSTOS
═══════════════════════════════════════════════════════════════════════

 ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
 │ CloudWatch          │  │ CloudTrail          │  │ Proteccion Costos   │
 │                     │  │                     │  │ (4 capas)           │
 │ • Logs Lambda 2     │  │ • Auditoria de      │  │                     │
 │ • Logs Lambda 3     │  │   toda la cuenta    │  │ 1. Billing Pref     │
 │ • Metricas billing  │  │ • 90 dias gratis    │  │ 2. AWS Budget $3    │
 │ • Alarmas custom    │  │ • Quien hizo que    │  │ 3. Anomaly ML $1    │
 │                     │  │ • Cuando, desde IP  │  │ 4. CloudWatch $1    │
 └─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

---

## Notas sobre la arquitectura simplificada

### Por que NO hay Lambda 1 (presigned URL generator)

Decision del diseno post-feedback de la profesora:
para el alcance del proyecto (sin autenticacion, sin cuotas, sin
rate limiting por usuario), una Lambda intermedia para generar
presigned URLs agrega complejidad sin valor real.

Las restricciones de upload se aplican directamente al bucket
S3 sml-images-input:

| Restriccion          | Configuracion en S3                       |
|----------------------|-------------------------------------------|
| Solo imagenes        | Bucket policy con condicion content-type  |
| Maximo 10 MB         | Validacion en Lambda 2 (post-upload)      |
| Solo desde dominio   | CORS config con AllowedOrigins limitado   |
| Nombre unico         | UUID generado en el frontend antes de PUT |
| No sobrescribir      | Bucket policy denegando overwrite         |

### Que pasa si en el futuro se necesita autenticacion

Se reintroduciria un punto de control intermedio. Opciones:

1. Lambda Authorizer en API Gateway (valida JWT antes de cada request)
2. Cognito Identity Pool (frontend recibe credenciales temporales STS)
3. Lambda intermedia tipo Lambda 1 que valide y genere presigned URL

Para el proyecto actual ninguna de las tres es necesaria.

---

## Resumen rapido

### Componentes desplegados

| Servicio                  | Nombre / ARN                                        |
|---------------------------|-----------------------------------------------------|
| S3 Frontend               | sml-frontend                                        |
| S3 Input                  | sml-images-input                                    |
| S3 Output                 | sml-images-output                                   |
| Lambda Processing         | sml-process-image                                   |
| Lambda Status/History     | sml-get-status-history                              |
| API Gateway               | sml-api (id: bg7yhanxyg)                            |
| DynamoDB                  | sml-image-metadata                                  |
| SNS Topic                 | sml-image-notifications                             |
| IAM Role                  | sml-lambda-execution-role                           |

### Flujo en 8 pasos

| #  | Accion                                                          |
|----|-----------------------------------------------------------------|
| 1  | Cliente carga sitio web desde S3 frontend                       |
| 2  | Cliente sube imagen directo a S3 input via PUT con UUID         |
| 3  | S3 dispara automaticamente a Lambda 2 (process-image)           |
| 4  | Lambda 2 comprime, persiste y notifica (cuatro acciones)        |
| 5  | Cliente hace polling con GET /status al API Gateway             |
| 6  | API Gateway invoca a Lambda 3 (status/history)                  |
| 7  | Lambda 3 lee DynamoDB y devuelve estado                         |
| 8  | Cuando esta COMPLETED, cliente descarga de S3 output            |
