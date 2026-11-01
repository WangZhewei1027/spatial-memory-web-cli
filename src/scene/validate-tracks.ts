import { COMPOSITION_LIMITS, TRANSFORM_CHANNELS } from "./protocol.js";
import { IssueList, rejectUnknownKeys, requireObject, requireBoolean, requireNumberTuple, requireNumberInRange } from "./validate-utils.js";

export function validateTracks(issues: IssueList, path: string, raw: unknown, duration: number | null): number {
  const tracks = requireObject(issues, path, raw);
  if (!tracks) return 0;
  rejectUnknownKeys(issues, path, tracks, TRANSFORM_CHANNELS);
  let count = 0;
  for (const [channel, frames] of Object.entries(tracks)) {
    if (!Array.isArray(frames) || !frames.length) { issues.error(`${path}.${channel}`, "必须是非空关键帧数组"); continue; }
    count += frames.length;
    if (frames.length > COMPOSITION_LIMITS.maxKeyframes) { issues.error(path, "关键帧过多"); continue; }
    let previous = -1;
    for (const [i, rawFrame] of frames.entries()) {
      const p = `${path}.${channel}[${i}]`;
      const frame = requireObject(issues, p, rawFrame);
      if (!frame) continue;
      rejectUnknownKeys(issues, p, frame, ["time", "value", "handles", "connectedRight"]);
      if (requireNumberInRange(issues, `${p}.time`, frame.time, { min: 0, max: duration ?? 600 })) {
        if (frame.time <= previous) issues.error(`${p}.time`, "关键帧必须按时间递增且不能重叠");
        previous = frame.time;
      }
      requireNumberInRange(issues, `${p}.value`, frame.value, channel.startsWith("scale") ? { exclusiveMin: 0, max: 100 } : { min: -100, max: 100 });
      const handles = requireNumberTuple(issues, `${p}.handles`, frame.handles, 4);
      // Bounded handles keep interpolated transforms inside the validated endpoint range.
      if (handles?.some((v) => v < 0 || v > 1)) issues.error(`${p}.handles`, "缓动控制点必须在 0 到 1 之间");
      requireBoolean(issues, `${p}.connectedRight`, frame.connectedRight);
    }
  }
  return count;
}
