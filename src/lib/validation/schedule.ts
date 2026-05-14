import { z } from "zod";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const Slot = z.enum(["breakfast", "lunch", "dinner", "snack"]);

const ScheduleEntryBase = z.object({
  date: IsoDate,
  slot: Slot,
  profileId: z.string().uuid().optional().nullable(),
  mealId: z.string().uuid().optional().nullable(),
  eatingOut: z.boolean().optional(),
  eatingOutCost: z.number().min(0).max(9999.99).optional().nullable(),
  eatingOutLabel: z.string().min(1).max(80).optional().nullable(),
  notes: z.string().min(1).max(500).optional().nullable(),
});

function refineMealXorEatout<T extends z.ZodTypeAny>(s: T): T {
  return s.superRefine((val, ctx) => {
    const mealSet = val.mealId != null;
    const eatOut = val.eatingOut === true;
    if (mealSet && eatOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cannot set both mealId and eatingOut=true",
        path: ["eatingOut"],
      });
    }
    if (!eatOut && (val.eatingOutCost != null || val.eatingOutLabel != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "eatingOutCost and eatingOutLabel require eatingOut=true",
        path: ["eatingOutCost"],
      });
    }
  }) as unknown as T;
}

export const ScheduleEntryCreateSchema = refineMealXorEatout(
  ScheduleEntryBase.superRefine((val, ctx) => {
    const mealSet = val.mealId != null;
    const eatOut = val.eatingOut === true;
    if (!mealSet && !eatOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either mealId or eatingOut=true is required",
        path: ["mealId"],
      });
    }
  }),
);

export const ScheduleEntryUpdateSchema = refineMealXorEatout(ScheduleEntryBase.partial());

export const CopyWeekSchema = z.object({
  from: IsoDate,
  to: IsoDate,
});

export type ScheduleEntryCreate = z.infer<typeof ScheduleEntryCreateSchema>;
export type ScheduleEntryUpdate = z.infer<typeof ScheduleEntryUpdateSchema>;
export type CopyWeekInput = z.infer<typeof CopyWeekSchema>;
