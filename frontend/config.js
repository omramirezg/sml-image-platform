// ============================================================
//  CONFIG
//  Edit these values once the backend teammate provides the
//  API Gateway URL. Set DEMO_MODE = true to simulate the full
//  flow in the browser without touching AWS.
// ============================================================

window.CONFIG = {
  // Set to true to simulate everything in the browser without hitting AWS
  DEMO_MODE: false,

  // API Gateway base URL
  API_URL: "https://bg7yhanxyg.execute-api.us-east-1.amazonaws.com/dev",

  // Backend endpoints (paths inside the API Gateway)
  ENDPOINTS: {
    PRESIGNED_URL: "/upload",      // POST -> { uploadUrl, imageId }  (or variants)
    HISTORY: "/history"            // GET  -> not yet implemented by the backend team
  },

  // Public URL of the output bucket
  OUTPUT_BUCKET_URL: "https://sml-images-output.s3.us-east-1.amazonaws.com",

  // Polling: how often to check if the processed image is ready
  POLL_INTERVAL_MS: 2000,
  POLL_TIMEOUT_MS: 60000
};
