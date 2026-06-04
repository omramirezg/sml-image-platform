window.CONFIG = {
  DEMO_MODE: false,

  // Inyectado por el pipeline CI/CD (deploy-frontend job)
  API_URL: "https://bg7yhanxyg.execute-api.us-east-1.amazonaws.com/prod",

  ENDPOINTS: {
    PRESIGNED_URL: "/upload",
    HISTORY: "/history"
  },

  OUTPUT_BUCKET_URL: "https://sml-images-output.s3.us-east-1.amazonaws.com",

  POLL_INTERVAL_MS: 2000,
  POLL_TIMEOUT_MS: 60000
};
