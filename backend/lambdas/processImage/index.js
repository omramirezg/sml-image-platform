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
try {

  const originalObject = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  const originalBuffer = await streamToBuffer(
    originalObject.Body
  );

  const originalSize = originalBuffer.length;

  const optimizedBuffer = await sharp(originalBuffer)
    .jpeg({
      quality: 70,
      mozjpeg: true
    })
    .toBuffer();

  const processedSize = optimizedBuffer.length;

  const outputKey = `${imageId}.jpg`;

  await s3.send(
    new PutObjectCommand({
      Bucket: OUTPUT_BUCKET,
      Key: outputKey,
      Body: optimizedBuffer,
      ContentType: 'image/jpeg'
    })
  );

  const outputUrl =
    `https://${OUTPUT_BUCKET}.s3.us-east-1.amazonaws.com/${outputKey}`;

 await dynamo.send(
  new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      imageId,
      fileName: key.split('/').pop(),
      originalSize,
      processedSize,
      status: 'COMPLETED',
      outputUrl,
      createdAt: new Date().toISOString(),
      processedAt: new Date().toISOString()
    }
  })
);

  const compressionRatio =
    Math.round(
      (1 - processedSize / originalSize) * 100
    );

  await sns.send(
    new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Subject: 'Imagen procesada',
      Message: JSON.stringify({
        imageId,
        outputUrl,
        originalSize,
        processedSize,
        compressionRatio: `${compressionRatio}%`
      })
    })
  );

  console.log(`Imagen ${imageId} procesada`);

} catch (error) {

  console.error(error);

  await dynamo.send(
  new PutCommand({
    TableName: DYNAMODB_TABLE,
    Item: {
      imageId,
      status: 'FAILED',
      error: error.message,
      createdAt: new Date().toISOString(),
      processedAt: new Date().toISOString()
    }
  })
);
}
}
return { statusCode: 200, body: 'Evento procesado' };
};

