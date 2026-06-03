const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const sharp = require('sharp');
const REGION = process.env.REGION || 'us-east-1';
const s3 = new S3Client({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const sns = new SNSClient({ region: REGION });
const OUTPUT_BUCKET = 'sml-images-output';
const DYNAMODB_TABLE = 'sml-image-metadata';
const SNS_TOPIC_ARN =
  'arn:aws:sns:us-east-1:372123585270:sml-image-notifications';
const streamToBuffer = async (stream) => {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};
// Handler: se dispara automaticamente cuando llega una imagen a sml-images-input
exports.handler = async (event) => {
console.log("Evento S3 recibido:", JSON.stringify(event, null, 2));
for (const record of event.Records) {
const bucket = record.s3.bucket.name;
const key = decodeURIComponent(record.s3.object.key.replace(/[+]/g, " "));
const imageId = key.split("/")[1]?.split("-")[0] || key;
console.log(`Procesando: ${key} del bucket ${bucket}`);
// TODO semana 2: implementar compresion con sharp
// TODO semana 2: guardar resultado en sml-images-output
// TODO semana 2: registrar metadatos en DynamoDB
// TODO semana 2: publicar notificacion en SNS
}
return { statusCode: 200, body: 'Evento procesado' };
};

