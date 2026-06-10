const {
  RekognitionClient,
  DetectModerationLabelsCommand,
  DetectLabelsCommand,
} = require('@aws-sdk/client-rekognition');

const rekClient = new RekognitionClient({ region: process.env.AWS_REGION });
const MIN_CONF = Number(process.env.REKOGNITION_MIN_CONFIDENCE || 75);

async function detectModerationLabelsS3(bucket, key) {
  const cmd = new DetectModerationLabelsCommand({
    Image: { S3Object: { Bucket: bucket, Name: key } },
    MinConfidence: MIN_CONF,
  });
  const res = await rekClient.send(cmd);
  return res?.ModerationLabels || [];
}

// Detects general objects, scenes, and concepts in the image.
// Returns label name strings e.g. ["Dog", "Outdoor", "Park", "Running", "Grass"]
// Used for building captions for vector search — completely separate from
// moderation labels which are only non-empty for unsafe content.
async function detectGeneralLabelsS3(bucket, key, maxLabels = 15) {
  const cmd = new DetectLabelsCommand({
    Image: { S3Object: { Bucket: bucket, Name: key } },
    MaxLabels: maxLabels,
    MinConfidence: 70,
  });
  const res = await rekClient.send(cmd);
  return (res?.Labels || []).map((l) => l.Name);
}

function isLabelBlocked(label, blockedList = []) {
  const name = (label?.Name || '').toLowerCase();
  const parent = (label?.ParentName || '').toLowerCase();
  return blockedList.some(
    (b) => name.includes(b.toLowerCase()) || parent.includes(b.toLowerCase()),
  );
}

async function isImageSafeFromS3(bucket, key, { blockedCategories } = {}) {
  const defaults = [
    'Explicit Nudity',
    'Nudity',
    'Sexual Activity',
    'Suggestive',
  ];
  const blockedList = blockedCategories || defaults;
  const labels = await detectModerationLabelsS3(bucket, key);
  const blocked = labels.filter((l) => isLabelBlocked(l, blockedList));
  return { safe: blocked.length === 0, labels, blocked };
}

module.exports = { isImageSafeFromS3, detectModerationLabelsS3, detectGeneralLabelsS3 };

