import { z } from "zod";
import { ITEMS_PER_PAGE } from "~/server/api/constants";
import { contentStatusFilterSchema } from "~/lib/content-status";
import { protectedProcedure } from "~/server/orpc/base";
import { queryMixedContentPage } from "~/server/mixed-content/projection";

const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("view"), viewId: z.number().int() }),
  z.object({ type: z.literal("feed"), feedId: z.number().int() }),
  z.object({ type: z.literal("tag"), tagId: z.number().int() }),
]);

const cursorSchema = z
  .object({
    sectionPlacement: z.number().nullable(),
    normalizedAt: z.coerce.date(),
    entityKind: z.enum(["bookmark", "feed-item"]),
    entityId: z.string(),
  })
  .nullable();

export const requestPage = protectedProcedure
  .input(
    z.object({
      scope: scopeSchema,
      contentStatus: contentStatusFilterSchema,
      cursor: cursorSchema.optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    return queryMixedContentPage({
      database: context.db,
      userId: context.user.id,
      scope: input.scope,
      contentStatus: input.contentStatus,
      cursor: input.cursor,
      limit: input.limit ?? ITEMS_PER_PAGE,
    });
  });
