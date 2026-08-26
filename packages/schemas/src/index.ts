/**
 * 共通スキーマ置き場 (スタブ)
 * 将来 Zod スキーマをここに集約し、Frontend / Backend (Pydantic) で共有する
 * PROJECT_SPEC.md: Character / Persona / World / State / Scenario 等
 */

import { z } from "zod";

// 例: キャラ定義の最小スキーマ（将来拡張）
// 実装時は PROJECT_SPEC.md 13章のYAML定義に準拠させる
export const CharacterIdSchema = z.string().min(1);
export const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);

// 将来ここに CharacterSchema, PersonaSchema, WorldSchema, StateSchema 等を追加
export type Difficulty = z.infer<typeof DifficultySchema>;
