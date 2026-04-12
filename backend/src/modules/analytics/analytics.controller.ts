import type { FastifyReply, FastifyRequest } from "fastify";
import { utils, write } from "xlsx";
import { ZodError } from "zod";
import { failure, success } from "../../utils/http-response";
import {
  dateRangeQuerySchema,
  exportQuerySchema,
  topStudentsQuerySchema,
} from "./analytics.schema";
import type { AnalyticsService } from "./analytics.service";

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];

  for (const row of rows) {
    const values = headers.map((header) => {
      const value = row[header];
      if (value === null || value === undefined) {
        return "";
      }
      const raw = String(value).replace(/"/g, "\"\"");
      return `"${raw}"`;
    });
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  getTopStudents = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = topStudentsQuerySchema.parse(request.query);
      const data = await this.service.getTopStudents(query.limit);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getScoresByCategory = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    let query: { from?: string; to?: string };
    try {
      query = dateRangeQuerySchema.parse(request.query);
    } catch (error) {
      this.handleError(reply, error);
      return;
    }

    try {
      const data = await this.service.getScoresByCategory(query.from, query.to);
      reply.status(200).send(success(data ?? []));
    } catch (e) {
      console.error(e);
      reply.status(200).send(success([]));
    }
  };

  getActivityStats = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = dateRangeQuerySchema.parse(request.query);
      const data = await this.service.getActivityStats(query.from, query.to);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  exportCsv = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = exportQuerySchema.parse(request.query);
      const rows = await this.getExportRows(query);
      const csv = toCsv(rows);

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", `attachment; filename="${query.type}.csv"`)
        .send(csv);
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  exportExcel = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = exportQuerySchema.parse(request.query);
      const rows = await this.getExportRows(query);

      const workbook = utils.book_new();
      const sheet = utils.json_to_sheet(rows);
      utils.book_append_sheet(workbook, sheet, "Analytics");
      const buffer = write(workbook, { type: "buffer", bookType: "xlsx" });

      reply
        .header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .header("Content-Disposition", `attachment; filename="${query.type}.xlsx"`)
        .send(buffer);
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  private async getExportRows(query: {
    type: "top-students" | "scores-by-category" | "activity-stats";
    from?: string;
    to?: string;
    limit: number;
  }): Promise<Array<Record<string, unknown>>> {
    if (query.type === "top-students") {
      const rows = await this.service.getTopStudents(query.limit);
      return rows.map((row) => ({ ...row }));
    }

    if (query.type === "scores-by-category") {
      const rows = await this.service.getScoresByCategory(query.from, query.to);
      return rows.map((row) => ({ ...row }));
    }

    const rows = await this.service.getActivityStats(query.from, query.to);
    return rows.map((row) => ({ ...row }));
  }

  private handleError(reply: FastifyReply, error: unknown): void {
    if (error instanceof ZodError) {
      reply.status(400).send(failure("Validation error", "VALIDATION_ERROR"));
      return;
    }

    reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR"));
  }
}
