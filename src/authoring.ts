import * as authoring from "@spatial-memory/scene-authoring";
import { CliError, object } from "./errors.js";

export { authoring };
export function result(value: unknown): Record<string, unknown> {
  const data = object(value);
  if (data.ok !== true) throw new CliError("场景编排校验失败", 2, data);
  return data;
}
export function parseDocument(value: unknown): ReturnType<typeof authoring.createDocument> {
  const checked = result(authoring.validate(value));
  return checked.document as ReturnType<typeof authoring.createDocument>;
}
export function parseSceneText(text: string): ReturnType<typeof authoring.createDocument> {
  try { return parseDocument(JSON.parse(text)); }
  catch (error) { if (error instanceof CliError) throw error; throw new CliError(`场景 JSON 无效: ${(error as Error).message}`); }
}
