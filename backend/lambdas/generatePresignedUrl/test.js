// test.js — prueba local de la Lambda (no se sube a AWS)
process.env.INPUT_BUCKET = 'sml-images-input';
process.env.REGION = 'us-east-1';
const { handler } = require('./index');
// Simula el evento que API Gateway envia a la Lambda
const mockEvent = {
body: JSON.stringify({
fileName: 'foto-prueba.jpg',
fileType: 'image/jpeg',
}),
};
// Ejecutar y mostrar el resultado
handler(mockEvent).then(result => {
console.log("Status:", result.statusCode);
console.log("Body:", JSON.parse(result.body));
}).catch(err => {
console.error("Error:", err.message);
});

