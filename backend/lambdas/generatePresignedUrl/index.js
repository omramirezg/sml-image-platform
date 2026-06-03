const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
// Cliente S3 — usa la region de la variable de entorno
const s3 = new S3Client({ region: process.env.REGION || 'us-east-1' });
const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.REGION || 'us-east-1'
  })
);
// Handler: funcion principal que ejecuta AWS Lambda
exports.handler = async (event) => {
// Leer el body del request (viene como string, hay que parsearlo)
const body = JSON.parse(event.body || "{}");
const { fileName, fileType } = body;
// Validar que vengan los datos necesarios
if (!fileName || !fileType) {
return {
statusCode: 400,
headers: corsHeaders(),
body: JSON.stringify({ error: "fileName y fileType son requeridos" }),
};
}
// Generar un ID unico para esta imagen
const imageId = uuidv4();
const key = `uploads/${imageId}-${fileName}`;
// Crear el comando de subida a S3
const command = new PutObjectCommand({
Bucket: process.env.INPUT_BUCKET,
Key: key,
ContentType: fileType,
});
// Generar la URL firmada (valida por 5 minutos)
await dynamo.send(
  new PutCommand({
    TableName: 'sml-image-metadata',
    Item: {
      imageId,
      fileName,
      status: 'PENDING',
      createdAt: new Date().toISOString()
    }
  })
);
const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
return {
statusCode: 200,
headers: corsHeaders(),
body: JSON.stringify({ uploadUrl, imageId, key }),
};
};
// Funcion auxiliar: headers CORS para que el navegador acepte la respuesta
function corsHeaders() {
return {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'Content-Type',
'Content-Type': 'application/json',
};
}
