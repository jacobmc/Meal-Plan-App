import { z } from "zod";

export const ProfileCreateSchema = z.object({
  displayName: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().min(0).max(99).optional(),
  userId: z.string().uuid().nullable().optional(),
});

export const ProfileUpdateSchema = ProfileCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type ProfileCreate = z.infer<typeof ProfileCreateSchema>;
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
