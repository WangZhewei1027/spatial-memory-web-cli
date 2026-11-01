/** Web HTTP contract snapshot; no dependency on the server repository. */
/** Phone-account identity after the coordinated production account migration. */
export const PHONE_EMAIL_DOMAIN = "phone.spatialmemory.local";
export const ALL_UPLOAD_TYPES = [
  "image", "video", "audio", "document", "link", "text", "anchor", "model",
] as const;

export const UPLOAD_SOURCE_MAX_MB: Record<string, number> = { image: 32, audio: 32, anchor: 32, video: 512, model: 5, document: 5 };
