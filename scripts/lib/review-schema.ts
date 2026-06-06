import { z } from "zod";

export const severitySchema = z.enum(["critical", "warning", "suggestion"]);
export type Severity = z.infer<typeof severitySchema>;

export const inlineCommentSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  severity: severitySchema,
  body: z.string().min(1),
});
export type InlineComment = z.infer<typeof inlineCommentSchema>;

export const reviewResultSchema = z.object({
  summary: z.string().min(1),
  comments: z.array(inlineCommentSchema).default([]),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;
