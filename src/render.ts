import { renderScene as renderSnapshot, probeAsset as probeResource } from "@spatial-memory/scene-renderer";
export interface RenderResource { assetId?: string; url: string; kind: "model" | "image" | "video" | "audio"; animations?: unknown[]; contentHash?: string; name?: string | null }
export interface CameraView { name?: string; position?: [number, number, number]; target?: [number, number, number]; up?: [number, number, number]; fov?: number; near?: number; far?: number; fit?: boolean }
export interface RenderRequest { document: unknown; resources?: Record<string, RenderResource>; times: number[]; cameras?: (string | CameraView)[]; outputDir: string; options?: Record<string, unknown> }
export interface ProbeRequest { path?: string; url?: string; outputDir?: string; kind?: string }
export async function renderScene(request: RenderRequest): Promise<unknown> { return renderSnapshot(request); }
export async function probeAsset(request: ProbeRequest): Promise<unknown> { return probeResource(request); }
