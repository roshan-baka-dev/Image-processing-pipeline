const {
  RekognitionClient,
  DetectModerationLabelsCommand,
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

module.exports = { isImageSafeFromS3, detectModerationLabelsS3 };
